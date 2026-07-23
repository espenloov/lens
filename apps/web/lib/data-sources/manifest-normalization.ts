type GeneratedDimensionValue = {
  readonly value: string | number | boolean;
  readonly label: string;
  readonly order: number;
  readonly code: number | null;
};

type GeneratedDimension = {
  readonly key: string;
  readonly label: string;
  readonly expression: string;
  readonly filterExpression: string;
  readonly orderExpression: string | null;
  readonly codeExpression: string | null;
  readonly kind: "categorical" | "ordinal" | "boolean";
  readonly compact: boolean;
  readonly geographyLevel: number | null;
  readonly values: readonly GeneratedDimensionValue[];
};

export function normalizeGeneratedDimension(dimension: GeneratedDimension) {
  const codes = dimension.values.flatMap(({ code }) =>
    code === null ? [] : [code],
  );
  const hasCompleteCodebook =
    dimension.compact &&
    dimension.codeExpression !== null &&
    dimension.values.length > 0 &&
    codes.length === dimension.values.length &&
    new Set(codes).size === codes.length;

  return {
    ...dimension,
    compact: hasCompleteCodebook,
    codeExpression: hasCompleteCodebook ? dimension.codeExpression : null,
    values: dimension.values.map(({ code, ...value }) =>
      hasCompleteCodebook && code !== null ? { ...value, code } : value,
    ),
  };
}
