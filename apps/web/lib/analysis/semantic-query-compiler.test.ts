import { describe, expect, it } from "vitest";

import {
  analyticalTableManifestSchema,
  type AnalyticalTableManifest,
} from "../data-sources/semantic";
import {
  compileSemanticAnalysisQuery,
  type AnalysisQuerySource,
} from "./query-compiler";
import {
  prepareSemanticAnalysis,
  semanticAnalysisPlanSchema,
  validateSemanticAnalysisPlan,
} from "./semantic-plan";

const TAXI_MANIFEST = analyticalTableManifestSchema.parse({
  contract: "analytical_table/v1",
  identifier: {
    key: "trip_id",
    label: "Trip",
    expression: "trip_id",
  },
  time: {
    key: "pickup_at",
    label: "Pickup time",
    expression: "pickup_at",
    storageType: "datetime",
    granularities: ["year", "month"],
    timezone: "America/New_York",
  },
  measures: [
    {
      key: "fare_amount",
      label: "Fare",
      expression: "fare_amount",
      defaultAggregation: "average",
      aggregations: ["average", "median", "sum"],
      format: {
        kind: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      },
      resultScale: 2,
      supportsDistribution: true,
    },
  ],
  dimensions: [
    {
      key: "pickup_borough",
      label: "Pickup borough",
      expression: "toString(pickup_borough)",
      filterExpression: "pickup_borough",
      orderExpression: null,
      codeExpression: null,
      kind: "categorical",
      compact: false,
      geographyLevel: null,
      values: [],
    },
  ],
  geography: null,
});

const TAXI_SOURCE: AnalysisQuerySource = {
  fromClause: "(SELECT * FROM mapped_taxi) AS mapped_source",
  supportsPrewhere: false,
  manifest: TAXI_MANIFEST,
};

function taxiPlan(input: Record<string, unknown>) {
  return semanticAnalysisPlanSchema.parse({
    version: 1,
    dataset: "nyc_taxi",
    datasetVersion: 3,
    title: "Taxi analysis",
    explanation: "A safe semantic analysis.",
    filters: {
      timeRange: {
        from: "2024-01-01",
        to: "2024-12-31",
      },
      dimensions: [],
      measures: [],
    },
    ...input,
  });
}

describe("generic semantic query compilation", () => {
  it("compiles a cross-domain trend from manifest roles", () => {
    const plan = taxiPlan({
      operation: "trend",
      metric: {
        kind: "measure",
        measure: "fare_amount",
        aggregation: "average",
      },
      interval: "month",
      splitBy: "pickup_borough",
      filters: {
        timeRange: {
          from: "2024-01-01",
          to: "2024-12-31",
        },
        dimensions: [
          {
            dimension: "pickup_borough",
            values: ["Manhattan", "Queens"],
          },
        ],
        measures: [],
      },
    });
    const compiled = compileSemanticAnalysisQuery(plan, TAXI_SOURCE);

    expect(compiled.shape).toBe("time_series");
    expect(compiled.query).toContain("toStartOfMonth(pickup_at)");
    expect(compiled.query).toContain(
      "pickup_at < addDays({semanticDateTo: Date}, 1)",
    );
    expect(compiled.query).toContain("avg(fare_amount)");
    expect(compiled.query).toContain("toString(pickup_borough)");
    expect(compiled.query).not.toContain("Manhattan");
    expect(compiled.queryParams.semanticDimension0).toEqual([
      "Manhattan",
      "Queens",
    ]);
  });

  it("races baseline and optimizer-driven filter pushdown generically", () => {
    const plan = taxiPlan({
      operation: "trend",
      metric: {
        kind: "measure",
        measure: "fare_amount",
        aggregation: "average",
      },
      interval: "month",
      splitBy: "pickup_borough",
    });
    const baseline = compileSemanticAnalysisQuery(
      plan,
      TAXI_SOURCE,
      "baseline",
    );
    const optimized = compileSemanticAnalysisQuery(
      plan,
      TAXI_SOURCE,
      "prewhere",
    );

    expect(baseline.query).toContain("WHERE");
    expect(optimized.query).toContain("WHERE");
    expect(baseline.settings.optimize_move_to_prewhere).toBe(0);
    expect(optimized.settings.optimize_move_to_prewhere).toBe(1);
  });

  it("compiles row-count ranking without a property price role", () => {
    const plan = taxiPlan({
      operation: "ranking",
      metric: { kind: "row_count" },
      rankBy: "pickup_borough",
      order: "descending",
      limit: 10,
    });
    const compiled = compileSemanticAnalysisQuery(plan, TAXI_SOURCE);

    expect(compiled.shape).toBe("categorical");
    expect(compiled.query).toContain("toFloat64(count()) AS value");
    expect(compiled.query).not.toContain("price");
    expect(compiled.queryParams.semanticLimit).toBe(10);
  });

  it("keeps an explicit negative histogram domain", () => {
    const plan = taxiPlan({
      operation: "distribution",
      measure: "fare_amount",
      splitBy: null,
      bucketMinimum: -100,
      bucketWidth: 10,
      maximumBins: 40,
    });
    const compiled = compileSemanticAnalysisQuery(plan, TAXI_SOURCE);

    expect(compiled.shape).toBe("histogram");
    expect(compiled.queryParams.semanticHistogramMinimum).toBe(-100);
  });

  it("fails closed for unknown roles and unavailable time", () => {
    const unknownMeasure = taxiPlan({
      operation: "trend",
      metric: {
        kind: "measure",
        measure: "total_amount",
        aggregation: "average",
      },
      interval: "month",
      splitBy: null,
    });
    const withoutTime: AnalyticalTableManifest =
      analyticalTableManifestSchema.parse({
        ...TAXI_MANIFEST,
        time: null,
      });

    expect(() =>
      compileSemanticAnalysisQuery(unknownMeasure, TAXI_SOURCE),
    ).toThrowError("Unknown measure total_amount");
    expect(
      validateSemanticAnalysisPlan(unknownMeasure, withoutTime).isErr(),
    ).toBe(true);
  });

  it.each([
    {
      operation: "trend",
      input: {
        operation: "trend",
        metric: {
          kind: "measure",
          measure: "fare_amount",
          aggregation: "average",
        },
        interval: "month",
        splitBy: null,
      },
      shape: "time_series",
    },
    {
      operation: "comparison",
      input: {
        operation: "comparison",
        metric: {
          kind: "measure",
          measure: "fare_amount",
          aggregation: "average",
        },
        compareBy: "pickup_borough",
        interval: null,
      },
      shape: "categorical",
    },
    {
      operation: "distribution",
      input: {
        operation: "distribution",
        measure: "fare_amount",
        splitBy: null,
        bucketMinimum: -25,
        bucketWidth: 5,
        maximumBins: 40,
      },
      shape: "histogram",
    },
  ])(
    "prepares and compiles a pinned taxi $operation request",
    ({ input, shape }) => {
      const plan = taxiPlan(input);
      const prepared = prepareSemanticAnalysis(plan, TAXI_MANIFEST, {
        dataset: "nyc_taxi",
        datasetVersion: 3,
      });

      expect(prepared.isOk()).toBe(true);

      const request = prepared._unsafeUnwrap();
      const compiled = compileSemanticAnalysisQuery(
        request.plan,
        TAXI_SOURCE,
      );

      expect(request.shape).toBe(shape);
      expect(compiled.shape).toBe(shape);
      expect(request.presentation.valueLabel.length).toBeGreaterThan(0);
    },
  );

  it("rejects a plan from another immutable dataset version", () => {
    const plan = taxiPlan({
      operation: "ranking",
      metric: { kind: "row_count" },
      rankBy: "pickup_borough",
      order: "descending",
      limit: 10,
    });
    const prepared = prepareSemanticAnalysis(plan, TAXI_MANIFEST, {
      dataset: "nyc_taxi",
      datasetVersion: 4,
    });

    expect(prepared.isErr()).toBe(true);
    expect(prepared._unsafeUnwrapErr().message).toContain(
      "nyc_taxi version 4",
    );
  });
});
