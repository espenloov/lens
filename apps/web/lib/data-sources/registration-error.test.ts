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

  it("identifies the phase when Trigger.dev has no error message", () => {
    expect(
      registrationFailureMessage(undefined, "verifying_arrow"),
    ).toBe("Dataset validation failed during verifying arrow");
  });
});
