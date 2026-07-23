import { err, ok, type Result } from "neverthrow";

import type {
  InspectedRelation,
} from "./contracts";
import { PROPERTY_TRANSACTION_MANIFEST } from "./property-manifest";
import type { AnalyticalTableManifest } from "./semantic";

const ALLOWED_FUNCTIONS = new Set([
  "assumenotnull",
  "coalesce",
  "if",
  "lower",
  "multiif",
  "tostring",
  "todate",
  "tofloat64",
  "touint8",
  "touint64",
  "touint64ornull",
  "trim",
  "upper",
]);

const ALLOWED_WORDS = new Set([
  "as",
  "and",
  "or",
  "not",
  "null",
  "true",
  "false",
]);

export type MappingPolicyError = {
  readonly type: "mapping_policy_error";
  readonly message: string;
};

export type ValidatedMapping = {
  readonly normalizedSql: string;
  readonly digestInput: string;
  readonly aliases: readonly string[];
};

function invalid(message: string): MappingPolicyError {
  return { type: "mapping_policy_error", message };
}

function splitProjectionList(input: string): Result<string[], MappingPolicyError> {
  const projections: string[] = [];
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let start = 0;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (quote !== null) {
      if (character === quote && input[index - 1] !== "\\") {
        quote = null;
      }
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth < 0) {
        return err(invalid("The mapping contains unbalanced parentheses"));
      }
    } else if (character === "," && depth === 0) {
      projections.push(input.slice(start, index).trim());
      start = index + 1;
    }
  }

  if (quote !== null || depth !== 0) {
    return err(invalid("The mapping contains an unfinished quote or parenthesis"));
  }

  projections.push(input.slice(start).trim());
  return ok(projections);
}

function stripStringLiterals(expression: string): string {
  return expression.replace(/'(?:''|[^'])*'/g, "''");
}

function expressionIdentifiers(expression: string): string[] {
  const withoutStrings = stripStringLiterals(expression);
  const identifiers =
    withoutStrings.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? [];

  return identifiers
    .map((identifier) => identifier.toLowerCase())
    .filter(
      (identifier) =>
        !ALLOWED_FUNCTIONS.has(identifier) && !ALLOWED_WORDS.has(identifier),
    );
}

function manifestProjectionAliases(
  manifest: AnalyticalTableManifest,
): string[] {
  const expressions = [
    ...(manifest.identifier === null ? [] : [manifest.identifier.expression]),
    ...(manifest.time === null ? [] : [manifest.time.expression]),
    ...manifest.measures.map((measure) => measure.expression),
    ...manifest.dimensions.flatMap((dimension) => [
      dimension.expression,
      dimension.filterExpression,
      ...(dimension.orderExpression === null
        ? []
        : [dimension.orderExpression]),
      ...(dimension.codeExpression === null ? [] : [dimension.codeExpression]),
    ]),
  ];

  return [...new Set(expressions.flatMap(expressionIdentifiers))];
}

export function validateMappingExpression(
  expression: string,
  relation: InspectedRelation,
): Result<void, MappingPolicyError> {
  const structure = splitProjectionList(expression);

  if (structure.isErr() || structure.value.length !== 1) {
    return err(
      structure.isErr()
        ? structure.error
        : invalid("The expression must contain one balanced SQL expression"),
    );
  }

  const sourceColumns = new Set(
    relation.columns.map((column) => column.name.toLowerCase()),
  );
  const withoutStrings = stripStringLiterals(expression);

  if (/["`;]|--|\/\*|\*\//.test(withoutStrings)) {
    return err(invalid("Quoted identifiers, comments, and statement separators are not allowed"));
  }

  const functionNames = [
    ...withoutStrings.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g),
  ].map((match) => match[1].toLowerCase());

  for (const functionName of functionNames) {
    if (!ALLOWED_FUNCTIONS.has(functionName)) {
      return err(invalid(`Function ${functionName} is not allowed in a mapping`));
    }
  }

  const identifiers = withoutStrings.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? [];

  for (const identifier of identifiers) {
    const normalized = identifier.toLowerCase();

    if (
      sourceColumns.has(normalized) ||
      ALLOWED_FUNCTIONS.has(normalized) ||
      ALLOWED_WORDS.has(normalized)
    ) {
      continue;
    }

    return err(invalid(`Unknown or unsupported identifier ${identifier}`));
  }

  return ok(undefined);
}

export function validateMappingSql(
  mappingSql: string,
  relation: InspectedRelation,
  manifest: AnalyticalTableManifest = PROPERTY_TRANSACTION_MANIFEST,
): Result<ValidatedMapping, MappingPolicyError> {
  const sql = mappingSql.trim();

  if (/;|--|\/\*|\*\//.test(sql)) {
    return err(invalid("Mappings must contain one comment-free SELECT statement"));
  }

  if (
    /\b(?:join|union|with|settings|format|into|outfile|array\s+join|prewhere|sample)\b/i.test(
      sql,
    )
  ) {
    return err(invalid("Joins, unions, subqueries, settings, and output clauses are not allowed"));
  }

  if ((sql.match(/\bselect\b/gi) ?? []).length !== 1) {
    return err(invalid("The mapping must contain exactly one SELECT"));
  }

  const match = sql.match(
    /^\s*SELECT\s+([\s\S]+)\s+FROM\s+`?([A-Za-z_][A-Za-z0-9_]*)`?\.`?([A-Za-z_][A-Za-z0-9_]*)`?\s*$/i,
  );

  if (match === null) {
    return err(invalid("Use SELECT … FROM database.table with the inspected relation"));
  }

  const [, projectionSql, database, table] = match;

  if (database !== relation.database || table !== relation.table) {
    return err(invalid("The mapping may read only from the relation that was inspected"));
  }

  const projections = splitProjectionList(projectionSql);

  if (projections.isErr()) {
    return err(projections.error);
  }

  const requiredColumns = manifestProjectionAliases(manifest);

  if (projections.value.length < requiredColumns.length) {
    return err(
      invalid(
        `The mapping must produce at least ${requiredColumns.length} manifest columns`,
      ),
    );
  }

  const expressions = new Map<string, string>();
  const projectionOrder: string[] = [];

  for (const projection of projections.value) {
    const aliasMatch = projection.match(
      /^([\s\S]+?)\s+AS\s+([a-z][a-z0-9]*(?:_[a-z0-9]+)*)$/i,
    );

    if (aliasMatch === null) {
      return err(
        invalid("Every projection needs an explicit semantic AS alias"),
      );
    }

    const expression = aliasMatch[1].trim();
    const alias = aliasMatch[2].toLowerCase();

    if (expressions.has(alias)) {
      return err(invalid(`Semantic column ${alias} is mapped more than once`));
    }

    const expressionResult = validateMappingExpression(expression, relation);

    if (expressionResult.isErr()) {
      return err(expressionResult.error);
    }

    expressions.set(alias, expression);
    projectionOrder.push(alias);
  }

  for (const required of requiredColumns) {
    if (!expressions.has(required)) {
      return err(invalid(`Semantic column ${required} is missing`));
    }
  }

  const mappedRelation: InspectedRelation = {
    database: relation.database,
    table: relation.table,
    engine: "Mapped",
    estimatedRows: relation.estimatedRows,
    columns: requiredColumns.map((name, index) => ({
      name,
      type: "Unknown",
      position: index + 1,
    })),
  };
  const manifestExpressions = [
    ...(manifest.identifier === null ? [] : [manifest.identifier.expression]),
    ...(manifest.time === null ? [] : [manifest.time.expression]),
    ...manifest.measures.map((measure) => measure.expression),
    ...manifest.dimensions.flatMap((dimension) => [
      dimension.expression,
      dimension.filterExpression,
      ...(dimension.orderExpression === null
        ? []
        : [dimension.orderExpression]),
      ...(dimension.codeExpression === null ? [] : [dimension.codeExpression]),
    ]),
  ];

  for (const expression of manifestExpressions) {
    const validated = validateMappingExpression(expression, mappedRelation);

    if (validated.isErr()) {
      return err(
        invalid(`The semantic manifest is unsafe: ${validated.error.message}`),
      );
    }
  }

  const normalizedProjections = projectionOrder.map(
    (alias) => `  ${expressions.get(alias)} AS ${alias}`,
  ).join(",\n");
  const normalizedSql = `SELECT\n${normalizedProjections}\nFROM \`${database}\`.\`${table}\``;

  return ok({
    normalizedSql,
    digestInput: `${relation.database}.${relation.table}\n${JSON.stringify(relation.columns)}\n${normalizedSql}`,
    aliases: projectionOrder,
  });
}
