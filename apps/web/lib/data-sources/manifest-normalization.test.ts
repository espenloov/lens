import { describe, expect, it } from "vitest";

import { normalizeGeneratedDimension } from "./manifest-normalization";

const dimension = {
  key: "payment_type",
  label: "Payment type",
  expression: "payment_type",
  filterExpression: "payment_type",
  orderExpression: null,
  kind: "categorical" as const,
  geographyLevel: null,
};

describe("generated manifest normalization", () => {
  it("safely downgrades an incomplete compact dimension", () => {
    const normalized = normalizeGeneratedDimension({
      ...dimension,
      codeExpression: null,
      compact: true,
      values: [
        { value: "Cash", label: "Cash", order: 1, code: null },
      ],
    });

    expect(normalized.compact).toBe(false);
    expect(normalized.codeExpression).toBeNull();
    expect(normalized.values).toEqual([
      { value: "Cash", label: "Cash", order: 1 },
    ]);
  });

  it("keeps a complete compact codebook", () => {
    const normalized = normalizeGeneratedDimension({
      ...dimension,
      codeExpression: "toUInt8(payment_type)",
      compact: true,
      values: [
        { value: "Cash", label: "Cash", order: 1, code: 1 },
        { value: "Card", label: "Card", order: 2, code: 2 },
      ],
    });

    expect(normalized.compact).toBe(true);
    expect(normalized.codeExpression).toBe("toUInt8(payment_type)");
    expect(normalized.values).toEqual([
      { value: "Cash", label: "Cash", order: 1, code: 1 },
      { value: "Card", label: "Card", order: 2, code: 2 },
    ]);
  });

  it("rejects duplicate compact codes", () => {
    const normalized = normalizeGeneratedDimension({
      ...dimension,
      codeExpression: "toUInt8(payment_type)",
      compact: true,
      values: [
        { value: "Cash", label: "Cash", order: 1, code: 1 },
        { value: "Card", label: "Card", order: 2, code: 1 },
      ],
    });

    expect(normalized.compact).toBe(false);
    expect(normalized.codeExpression).toBeNull();
  });
});
