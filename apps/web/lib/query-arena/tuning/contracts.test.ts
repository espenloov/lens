import { describe, expect, it } from "vitest";

import {
  createTuningProposalSchema,
  decideTuningProposalSchema,
} from "./contracts";

describe("physical tuning contracts", () => {
  it("accepts only the whitelisted projection template", () => {
    const proposal = createTuningProposalSchema.safeParse({
      analysis: {
        kind: "time_series",
        request: {
          shape: "time_series",
          dataset: "uk_price_paid",
          datasetVersion: 1,
          operation: "comparison",
          metric: "average_price",
          interval: "year",
          seriesBy: "town",
          transform: "value",
          anomalyThreshold: null,
          filters: {
            dateFrom: "2018-01-01",
            dateTo: "2018-12-31",
            location: {
              level: "town",
              values: ["Manchester", "Liverpool"],
            },
            propertyTypes: [],
            newBuild: null,
            tenure: [],
            minimumPrice: null,
            maximumPrice: null,
          },
        },
      },
      template: {
        kind: "free_form_ddl",
        ddl: "DROP TABLE default.pp_complete",
      },
    });

    expect(proposal.success).toBe(false);
  });

  it("requires an attributable human decision", () => {
    expect(
      decideTuningProposalSchema.safeParse({
        decision: "approve",
        approver: "",
      }).success,
    ).toBe(false);
    expect(
      decideTuningProposalSchema.safeParse({
        decision: "approve",
        approver: "Espen van Ingen",
      }).success,
    ).toBe(true);
  });
});
