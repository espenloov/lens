import type { InspectedRelation } from "./contracts";
import {
  analyticalTableManifestSchema,
  type AnalyticalDimension,
  type AnalyticalMeasure,
  type AnalyticalTableManifest,
} from "./semantic";

type AnalyticalRole =
  | "coordinate"
  | "dimension"
  | "identifier"
  | "measure"
  | "time";

type InferredColumn = {
  readonly alias: string;
  readonly expression: string;
  readonly label: string;
  readonly role: AnalyticalRole;
  readonly sourceName: string;
  readonly sourceType: string;
};

const MEASURE_TERMS = new Set([
  "amount",
  "average",
  "balance",
  "bytes",
  "cost",
  "count",
  "distance",
  "duration",
  "fare",
  "latency",
  "length",
  "metric",
  "price",
  "quantity",
  "range",
  "rate",
  "revenue",
  "samples",
  "score",
  "signal",
  "size",
  "speed",
  "tax",
  "temperature",
  "tip",
  "toll",
  "total",
  "value",
  "volume",
  "weight",
]);

const ADDITIVE_TERMS = new Set([
  "amount",
  "bytes",
  "count",
  "quantity",
  "revenue",
  "samples",
  "sales",
  "total",
  "volume",
]);

const DIMENSION_TERMS = new Set([
  "area",
  "category",
  "changeable",
  "class",
  "code",
  "country",
  "district",
  "flag",
  "group",
  "level",
  "mcc",
  "mnc",
  "net",
  "network",
  "region",
  "state",
  "status",
  "type",
  "unit",
  "zone",
]);

const IDENTIFIER_TERMS = new Set([
  "cell",
  "event",
  "id",
  "key",
  "record",
  "transaction",
  "trip",
  "uuid",
]);

const GEOGRAPHY_RANK = new Map([
  ["country", 0],
  ["nation", 0],
  ["state", 1],
  ["province", 1],
  ["region", 1],
  ["county", 2],
  ["district", 3],
  ["borough", 4],
  ["city", 5],
  ["town", 5],
  ["locality", 6],
  ["neighbourhood", 7],
  ["neighborhood", 7],
]);

function semanticKey(value: string): string {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  const prefixed = /^[a-z]/.test(normalized)
    ? normalized
    : `field_${normalized}`;

  return prefixed.slice(0, 64);
}

function words(value: string): string[] {
  return semanticKey(value).split("_");
}

function label(value: string): string {
  return words(value)
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
}

function unwrapType(value: string): string {
  let type = value.trim();
  let previous = "";

  while (type !== previous) {
    previous = type;
    type = type
      .replace(/^(?:LowCardinality|Nullable)\((.*)\)$/i, "$1")
      .trim();
  }

  return type;
}

function isTemporal(type: string): boolean {
  return /^(?:Date|Date32|DateTime|DateTime64)(?:\(|$)/i.test(
    unwrapType(type),
  );
}

function isNumeric(type: string): boolean {
  return /^(?:U?Int(?:8|16|32|64|128|256)?|Float(?:32|64)|BFloat16|Decimal(?:32|64|128|256)?)(?:\(|$)/i.test(
    unwrapType(type),
  );
}

function isCategorical(type: string): boolean {
  return /^(?:String|FixedString|Enum(?:8|16)|Bool)(?:\(|$)/i.test(
    unwrapType(type),
  );
}

function isCoordinate(name: string): boolean {
  const key = semanticKey(name);
  return [
    "lat",
    "latitude",
    "lon",
    "lng",
    "longitude",
    "x_coordinate",
    "y_coordinate",
  ].includes(key);
}

function hasTerm(name: string, terms: ReadonlySet<string>): boolean {
  return words(name).some((word) => terms.has(word));
}

function isIdentifier(name: string): boolean {
  const key = semanticKey(name);
  return (
    IDENTIFIER_TERMS.has(key) ||
    key.endsWith("_id") ||
    key.startsWith("id_") ||
    key.endsWith("_uuid") ||
    key.endsWith("_key")
  );
}

function isDimensionName(name: string): boolean {
  const key = semanticKey(name);
  return (
    DIMENSION_TERMS.has(key) ||
    ["_category", "_class", "_code", "_flag", "_group", "_level", "_status", "_type"]
      .some((suffix) => key.endsWith(suffix)) ||
    /^is_|^has_|^can_/i.test(key)
  );
}

function timeScore(name: string): number {
  const key = semanticKey(name);

  if (["event_time", "observed_at", "timestamp", "datetime", "date"].includes(key)) {
    return 100;
  }

  if (key.endsWith("_at") || key.endsWith("_time") || key.endsWith("_date")) {
    return 80;
  }

  if (key.startsWith("created") || key.startsWith("occurred")) {
    return 70;
  }

  if (key.startsWith("updated")) {
    return 40;
  }

  return 20;
}

function inferRole(
  names: readonly string[],
  type: string,
  selectedTime: boolean,
): AnalyticalRole | null {
  if (names.some(isCoordinate)) {
    return "coordinate";
  }

  if (isTemporal(type)) {
    return selectedTime ? "time" : null;
  }

  if (names.some(isIdentifier)) {
    return "identifier";
  }

  if (isCategorical(type)) {
    return "dimension";
  }

  if (!isNumeric(type)) {
    return null;
  }

  if (names.some(isDimensionName)) {
    return "dimension";
  }

  if (names.some((name) => hasTerm(name, MEASURE_TERMS))) {
    return "measure";
  }

  return "measure";
}

function projectionExpression(
  sourceName: string,
  sourceType: string,
  role: AnalyticalRole,
): string {
  if (role === "measure" || role === "coordinate") {
    return `toFloat64(${sourceName})`;
  }

  if (role === "dimension" || role === "identifier") {
    return `toString(${sourceName})`;
  }

  return sourceName;
}

export function inferAnalyticalColumns(
  relation: InspectedRelation,
): readonly InferredColumn[] {
  const selectedTime =
    relation.columns
      .filter((column) => isTemporal(column.type))
      .sort(
        (left, right) =>
          timeScore(right.name) - timeScore(left.name) ||
          left.position - right.position,
      )[0]?.name ?? null;
  const inferred = relation.columns.flatMap((column) => {
    const role = inferRole(
      [column.name],
      column.type,
      column.name === selectedTime,
    );

    if (role === null) {
      return [];
    }

    return [
      {
        alias: semanticKey(column.name),
        expression: projectionExpression(column.name, column.type, role),
        label: label(column.name),
        role,
        sourceName: column.name,
        sourceType: column.type,
      } satisfies InferredColumn,
    ];
  });
  return limitColumns(inferred);
}

function limitColumns(
  columns: readonly InferredColumn[],
): readonly InferredColumn[] {
  const limits: Record<AnalyticalRole, number> = {
    coordinate: 0,
    dimension: 16,
    identifier: 1,
    measure: 12,
    time: 1,
  };
  const counts: Record<AnalyticalRole, number> = {
    coordinate: 0,
    dimension: 0,
    identifier: 0,
    measure: 0,
    time: 0,
  };

  return columns.filter((column) => {
    if (counts[column.role] >= limits[column.role]) {
      return false;
    }

    counts[column.role] += 1;
    return true;
  });
}

export function createMappingTemplate(relation: InspectedRelation): string {
  const projections = inferAnalyticalColumns(relation)
    .map(
      ({ expression, alias }) =>
        `  ${expression} AS ${alias}`,
    )
    .join(",\n");

  return `SELECT\n${projections}\nFROM ${relation.database}.${relation.table}`;
}

function splitProjections(value: string): string[] {
  const projections: string[] = [];
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (quote !== null) {
      if (character === quote && value[index - 1] !== "\\") {
        quote = null;
      }
    } else if (
      character === "'" ||
      character === '"' ||
      character === "`"
    ) {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      projections.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  projections.push(value.slice(start).trim());
  return projections.filter(Boolean);
}

function sourceColumnForExpression(
  relation: InspectedRelation,
  expression: string,
) {
  return relation.columns.find((column) =>
    new RegExp(`\\b${column.name}\\b`, "i").test(expression),
  );
}

function mappedAnalyticalColumns(
  relation: InspectedRelation,
  mappingSql: string,
): readonly InferredColumn[] {
  const select = mappingSql.match(
    /^\s*SELECT\s+([\s\S]+)\s+FROM\s+[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*\s*$/i,
  );

  if (select?.[1] === undefined) {
    return [];
  }

  const projections = splitProjections(select[1]).flatMap((projection) => {
    const match = projection.match(
      /^([\s\S]+?)\s+AS\s+([a-z][a-z0-9]*(?:_[a-z0-9]+)*)$/i,
    );

    if (match?.[1] === undefined || match[2] === undefined) {
      return [];
    }

    const source = sourceColumnForExpression(relation, match[1]);

    return source === undefined
      ? []
      : [
          {
            alias: match[2].toLowerCase(),
            expression: match[1].trim(),
            source,
          },
        ];
  });
  const selectedTime =
    projections
      .filter(({ source }) => isTemporal(source.type))
      .sort(
        (left, right) =>
          timeScore(right.alias) +
            timeScore(right.source.name) -
            timeScore(left.alias) -
            timeScore(left.source.name) ||
          left.source.position - right.source.position,
      )[0]?.alias ?? null;

  return limitColumns(
    projections.flatMap(({ alias, expression, source }) => {
      const role = inferRole(
        [alias, source.name],
        /^toDate\s*\(/i.test(expression) ? "Date" : source.type,
        alias === selectedTime,
      );

      if (role === null) {
        return [];
      }

      return [
        {
          alias,
          expression,
          label: label(alias),
          role,
          sourceName: source.name,
          sourceType: /^toDate\s*\(/i.test(expression)
            ? "Date"
            : source.type,
        } satisfies InferredColumn,
      ];
    }),
  );
}

function inferredMeasure(column: InferredColumn): AnalyticalMeasure {
  const additive = hasTerm(column.alias, ADDITIVE_TERMS);
  const aggregations = additive
    ? (["sum", "average", "median", "minimum", "maximum"] as const)
    : (["average", "median", "minimum", "maximum"] as const);

  return {
    key: column.alias,
    label: column.label,
    expression: column.alias,
    defaultAggregation: additive ? "sum" : "average",
    aggregations: [...aggregations],
    format: {
      kind: "number",
      maximumFractionDigits: 2,
    },
    resultScale: 2,
    supportsDistribution: true,
  };
}

function geographyRank(column: InferredColumn): number | null {
  if (column.alias.endsWith("_code")) {
    return null;
  }

  for (const word of words(column.alias)) {
    const rank = GEOGRAPHY_RANK.get(word);

    if (rank !== undefined) {
      return rank;
    }
  }

  return null;
}

function inferredDimensions(
  columns: readonly InferredColumn[],
): {
  readonly dimensions: AnalyticalDimension[];
  readonly geography: { readonly levels: string[] } | null;
} {
  const geographicColumns = columns
    .flatMap((column) => {
      const rank = geographyRank(column);
      return rank === null ? [] : [{ column, rank }];
    })
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.column.alias.localeCompare(right.column.alias),
    );
  const geographyLevels = geographicColumns.map(({ column }) => column.alias);
  const geographyIndexes = new Map(
    geographyLevels.map((key, index) => [key, index]),
  );

  return {
    dimensions: columns.map((column) => ({
      key: column.alias,
      label: column.label,
      expression: `toString(${column.alias})`,
      filterExpression: column.alias,
      orderExpression: null,
      codeExpression: null,
      kind:
        /^is_|^has_|^can_/i.test(column.alias) ||
        column.alias === "changeable"
          ? "boolean"
          : "categorical",
      compact: false,
      geographyLevel: geographyIndexes.get(column.alias) ?? null,
      values: [],
    })),
    geography:
      geographyLevels.length === 0 ? null : { levels: geographyLevels },
  };
}

export function inferAnalyticalManifest(
  relation: InspectedRelation,
  mappingSql: string,
): AnalyticalTableManifest {
  const columns = mappedAnalyticalColumns(relation, mappingSql);
  const identifier = columns.find((column) => column.role === "identifier");
  const time = columns.find((column) => column.role === "time");
  const measures = columns
    .filter((column) => column.role === "measure")
    .map(inferredMeasure);
  const dimensions = inferredDimensions(
    columns.filter((column) => column.role === "dimension"),
  );

  return analyticalTableManifestSchema.parse({
    contract: "analytical_table/v1",
    identifier:
      identifier === undefined
        ? null
        : {
            key: identifier.alias,
            label: identifier.label,
            expression: identifier.alias,
          },
    time:
      time === undefined
        ? null
        : {
            key: time.alias,
            label: time.label,
            expression: time.alias,
            storageType: /^DateTime/i.test(unwrapType(time.sourceType))
              ? "datetime"
              : "date",
            granularities: ["year", "quarter", "month"],
            timezone: null,
          },
    measures,
    dimensions: dimensions.dimensions,
    geography: dimensions.geography,
  });
}
