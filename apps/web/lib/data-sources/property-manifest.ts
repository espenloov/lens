import {
  analyticalTableManifestSchema,
  type AnalyticalTableManifest,
} from "./semantic";

export const PROPERTY_TRANSACTION_MANIFEST: AnalyticalTableManifest =
  analyticalTableManifestSchema.parse({
    contract: "analytical_table/v1",
    identifier: null,
    time: {
      key: "date",
      label: "Sale date",
      expression: "date",
      storageType: "date",
      granularities: ["year", "quarter", "month"],
      timezone: null,
    },
    measures: [
      {
        key: "price",
        label: "Sale price",
        expression: "price",
        defaultAggregation: "average",
        aggregations: ["average", "median", "minimum", "maximum"],
        format: {
          kind: "currency",
          currency: "GBP",
          maximumFractionDigits: 0,
        },
        resultScale: 0,
        supportsDistribution: true,
      },
    ],
    dimensions: [
      {
        key: "town",
        label: "Town",
        expression: "toString(town)",
        filterExpression: "town",
        orderExpression: null,
        codeExpression: null,
        kind: "categorical",
        compact: false,
        geographyLevel: 2,
        values: [],
      },
      {
        key: "district",
        label: "District",
        expression: "toString(district)",
        filterExpression: "district",
        orderExpression: null,
        codeExpression: null,
        kind: "categorical",
        compact: false,
        geographyLevel: 1,
        values: [],
      },
      {
        key: "county",
        label: "County",
        expression: "toString(county)",
        filterExpression: "county",
        orderExpression: null,
        codeExpression: null,
        kind: "categorical",
        compact: false,
        geographyLevel: 0,
        values: [],
      },
      {
        key: "property_type",
        label: "Property type",
        expression: `multiIf(
          type = 'detached', 'Detached',
          type = 'semi-detached', 'Semi-detached',
          type = 'terraced', 'Terraced',
          type = 'flat', 'Flat',
          'Other'
        )`,
        filterExpression: "type",
        orderExpression: `multiIf(
          type = 'detached', 1,
          type = 'semi-detached', 2,
          type = 'terraced', 3,
          type = 'flat', 4,
          5
        )`,
        codeExpression: `multiIf(
          type = 'detached', 0,
          type = 'semi-detached', 1,
          type = 'terraced', 2,
          type = 'flat', 3,
          4
        )`,
        kind: "categorical",
        compact: true,
        geographyLevel: null,
        values: [
          { value: "detached", label: "Detached", order: 1, code: 0 },
          {
            value: "semi-detached",
            label: "Semi-detached",
            order: 2,
            code: 1,
          },
          { value: "terraced", label: "Terraced", order: 3, code: 2 },
          { value: "flat", label: "Flat", order: 4, code: 3 },
          { value: "other", label: "Other", order: 5, code: 4 },
        ],
      },
      {
        key: "tenure",
        label: "Tenure",
        expression: `multiIf(
          duration = 'freehold', 'Freehold',
          duration = 'leasehold', 'Leasehold',
          'Unknown'
        )`,
        filterExpression: "duration",
        orderExpression: `multiIf(
          duration = 'freehold', 1,
          duration = 'leasehold', 2,
          3
        )`,
        codeExpression: `multiIf(
          duration = 'freehold', 0,
          duration = 'leasehold', 1,
          2
        )`,
        kind: "categorical",
        compact: true,
        geographyLevel: null,
        values: [
          { value: "freehold", label: "Freehold", order: 1, code: 0 },
          { value: "leasehold", label: "Leasehold", order: 2, code: 1 },
          { value: "unknown", label: "Unknown", order: 3, code: 2 },
        ],
      },
      {
        key: "new_build",
        label: "Build status",
        expression: "if(is_new = 1, 'New build', 'Existing')",
        filterExpression: "is_new",
        orderExpression: "if(is_new = 1, 1, 2)",
        codeExpression: "if(is_new = 1, 1, 0)",
        kind: "boolean",
        compact: true,
        geographyLevel: null,
        values: [
          { value: false, label: "Existing", order: 2, code: 0 },
          { value: true, label: "New build", order: 1, code: 1 },
        ],
      },
    ],
    geography: {
      levels: ["county", "district", "town"],
    },
  });
