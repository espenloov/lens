import { describe, expect, it } from "vitest";

import {
  explorationDayCount,
  explorationDimensions,
} from "./exploration-adapter";
import { explorationRequestSchema } from "./execution";

const request = explorationRequestSchema.parse({
  shape: "exploration",
  operation: "exploration",
  valueField: "price",
  dimensions: ["tenure", "property_type"],
  bucketMinimum: 0,
  bucketWidth: 50_000,
  binCount: 64,
  rowLimit: 1_000_000,
  filters: {
    dateFrom: "2024-01-01",
    dateTo: "2024-01-31",
    location: null,
    propertyTypes: [],
    newBuild: null,
    tenure: [],
    minimumPrice: null,
    maximumPrice: null,
  },
});

describe("exploration adapter", () => {
  it("keeps dimension codebooks in requested slot order", () => {
    const dimensions = explorationDimensions(request);

    expect(dimensions[0].key).toBe("tenure");
    expect(dimensions[0].values).toHaveLength(3);
    expect(dimensions[1].key).toBe("property_type");
    expect(dimensions[1].values).toHaveLength(5);
    expect(dimensions[2].key).toBeNull();
    expect(dimensions[2].values).toHaveLength(1);
  });

  it("calculates an inclusive UTC day range", () => {
    expect(explorationDayCount(request)).toBe(31);
  });
});
