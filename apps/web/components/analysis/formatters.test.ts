import { describe, expect, it } from "vitest";

import {
  formatBytes,
  formatComputeDuration,
  formatDuration,
  formatPrice,
} from "./formatters";

describe("analysis formatters", () => {
  it("formats property values for a UK audience", () => {
    expect(formatPrice(270_667)).toBe("£270,667");
    expect(formatBytes(61_683_314)).toBe("61.7 MB");
    expect(formatDuration(299.301_773)).toBe("299 ms");
    expect(formatDuration(19_606)).toBe("19.6 s");
    expect(formatComputeDuration(0.004)).toBe("<0.01 ms");
    expect(formatComputeDuration(0.204)).toBe("0.20 ms");
  });
});
