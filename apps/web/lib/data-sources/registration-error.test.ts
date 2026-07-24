import { describe, expect, it } from "vitest";

import { registrationFailureMessage } from "./registration-error";

describe("registration failure messages", () => {
  it("extracts the useful issue from a structured validation error", () => {
    expect(
      registrationFailureMessage(
        {
          message: JSON.stringify([
            {
              code: "custom",
              message: "Compact dimensions require a code expression",
            },
          ]),
        },
        "generating_manifest",
      ),
    ).toBe("Compact dimensions require a code expression");
  });

  it("keeps a plain Trigger.dev error concise", () => {
    expect(
      registrationFailureMessage(
        { message: "ClickHouse query timed out" },
        "profiling",
      ),
    ).toBe("ClickHouse query timed out");
  });

  it("preserves the field path for structured validation errors", () => {
    expect(
      registrationFailureMessage(
        {
          message: JSON.stringify([
            {
              code: "too_small",
              path: ["time", "granularities"],
              message: "Expected at least one time granularity",
            },
          ]),
        },
        "generating_manifest",
      ),
    ).toBe(
      "time.granularities: Expected at least one time granularity",
    );
  });

  it("identifies the phase when Trigger.dev has no error message", () => {
    expect(
      registrationFailureMessage(undefined, "verifying_arrow"),
    ).toBe("Dataset validation failed during verifying arrow");
  });
});
