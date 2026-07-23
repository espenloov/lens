import { describe, expect, it } from "vitest";

import type { AnalysisDataSource } from "../data-sources/contracts";
import {
  analyticalTableManifestSchema,
  deriveAnalyticalCapabilities,
} from "../data-sources/semantic";
import { BUILTIN_DATA_SOURCE } from "../data-sources/builtin";
import {
  buildPropertyAgentSystemPrompt,
  buildSemanticAgentSystemPrompt,
} from "./system-prompt";

describe("buildSemanticAgentSystemPrompt", () => {
  it("exposes semantic roles without leaking physical SQL", () => {
    const manifest = analyticalTableManifestSchema.parse({
      contract: "analytical_table/v1",
      identifier: null,
      time: {
        key: "occurred_at",
        label: "Occurred at",
        expression: "private_timestamp_column",
        storageType: "datetime",
        granularities: ["month"],
        timezone: "UTC",
      },
      measures: [
        {
          key: "revenue",
          label: "Revenue",
          expression: "private_amount_column",
          defaultAggregation: "sum",
          aggregations: ["sum", "average"],
          format: { kind: "currency", currency: "EUR" },
          resultScale: 2,
          supportsDistribution: true,
        },
      ],
      dimensions: [
        {
          key: "channel",
          label: "Channel",
          expression: "toString(private_channel_column)",
          filterExpression: "private_channel_column",
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
    const source: AnalysisDataSource = {
      slug: "commerce_events",
      displayName: "Commerce events",
      version: 7,
      contractVersion: "analytical_table/v1",
      database: "private_database",
      table: "private_table",
      mappingSql: "SELECT secret FROM private_database.private_table",
      dateFrom: "2024-01-01",
      dateTo: "2024-12-31",
      rowCount: 1_000,
      supportsPrewhere: false,
      queryArenaEligible: false,
      manifest,
      capabilities: deriveAnalyticalCapabilities(manifest),
      builtin: false,
    };
    const prompt = buildSemanticAgentSystemPrompt(source);

    expect(prompt).toContain("commerce_events");
    expect(prompt).toContain("Immutable version: 7");
    expect(prompt).toContain('"key":"revenue"');
    expect(prompt).toContain(
      "For a broad request to show, summarize, or understand the data",
    );
    expect(prompt).toContain(
      'measure "revenue", aggregation "sum", interval "month"',
    );
    expect(prompt).toContain(
      "call respondWithoutAnalysis with kind out_of_scope",
    );
    expect(prompt).not.toContain("private_amount_column");
    expect(prompt).not.toContain("private_timestamp_column");
    expect(prompt).not.toContain("private_channel_column");
    expect(prompt).not.toContain("private_database");
    expect(prompt).not.toContain("private_table");
  });

  it("chooses a useful overview interval for short datasets", () => {
    const manifest = analyticalTableManifestSchema.parse({
      contract: "analytical_table/v1",
      identifier: null,
      time: {
        key: "occurred_at",
        label: "Occurred at",
        expression: "occurred_at",
        storageType: "datetime",
        granularities: ["year", "quarter", "month"],
        timezone: "UTC",
      },
      measures: [
        {
          key: "amount",
          label: "Amount",
          expression: "amount",
          defaultAggregation: "sum",
          aggregations: ["sum"],
          format: { kind: "number", maximumFractionDigits: 0 },
          resultScale: 0,
          supportsDistribution: false,
        },
      ],
      dimensions: [],
      geography: null,
    });
    const source: AnalysisDataSource = {
      slug: "short_events",
      displayName: "Short events",
      version: 1,
      contractVersion: "analytical_table/v1",
      database: "default",
      table: "short_events",
      mappingSql: "SELECT occurred_at, amount FROM default.short_events",
      dateFrom: "2015-07-01",
      dateTo: "2015-09-30",
      rowCount: 1_000,
      supportsPrewhere: false,
      queryArenaEligible: true,
      manifest,
      capabilities: deriveAnalyticalCapabilities(manifest, {
        dateFrom: "2015-07-01",
        dateTo: "2015-09-30",
      }),
      builtin: false,
    };

    expect(buildSemanticAgentSystemPrompt(source)).toContain(
      'measure "amount", aggregation "sum", interval "month"',
    );
  });
});

describe("buildPropertyAgentSystemPrompt", () => {
  it("routes a broad dataset question to a useful overview", () => {
    const prompt = buildPropertyAgentSystemPrompt(BUILTIN_DATA_SOURCE);

    expect(prompt).toContain('"Show me what this data looks like"');
    expect(prompt).toContain(
      "Treat broad requests to show, summarize, or understand the dataset as this default overview",
    );
    expect(prompt).toContain(
      "call respondWithoutAnalysis with kind out_of_scope",
    );
  });
});
