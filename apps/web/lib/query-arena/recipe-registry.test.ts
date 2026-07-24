import { beforeEach, describe, expect, it, vi } from "vitest";

const postgres = vi.hoisted(() => ({
  getPostgresClient: vi.fn(),
}));

vi.mock("@/lib/postgres/client", () => postgres);

import { getRecipeGuidance } from "./recipe-registry";

const identity = {
  executionSignature: "a".repeat(64),
  semanticFamilyHash: "b".repeat(64),
};

function mockSql(input: {
  readonly active?: readonly { readonly strategy: string }[];
  readonly priors?: readonly {
    readonly strategy: string;
    readonly evidence_count: number;
    readonly median_server_elapsed_ms: number;
  }[];
}) {
  const lookups: string[] = [];
  const sql = async (
    strings: TemplateStringsArray,
    ...values: readonly unknown[]
  ) => {
    const query = strings.join(" ");
    lookups.push(`${query} ${JSON.stringify(values)}`);

    if (query.includes("INSERT INTO query_recipe_lookup_events")) {
      return [];
    }

    if (query.includes("versions.semantic_family_hash")) {
      return input.priors ?? [];
    }

    return input.active ?? [];
  };

  postgres.getPostgresClient.mockReturnValue(sql);

  return lookups;
}

describe("getRecipeGuidance", () => {
  beforeEach(() => {
    postgres.getPostgresClient.mockReset();
  });

  it("returns an exact local winner as the active strategy", async () => {
    mockSql({
      active: [{ strategy: "prewhere" }],
      priors: [{ strategy: "baseline", evidence_count: 5, median_server_elapsed_ms: 80 }],
    });

    const result = await getRecipeGuidance(identity);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      source: "exact",
      activeStrategy: "prewhere",
      prior: null,
    });
  });

  it("returns cross-dataset knowledge only as an inactive prior", async () => {
    mockSql({
      priors: [
        {
          strategy: "prewhere",
          evidence_count: 7,
          median_server_elapsed_ms: 42,
        },
      ],
    });

    const result = await getRecipeGuidance(identity);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      source: "prior",
      activeStrategy: null,
      prior: {
        strategy: "prewhere",
        evidenceCount: 7,
        medianServerElapsedMs: 42,
      },
    });
  });

  it("does not silently turn a prior into an active recipe", async () => {
    const lookups = mockSql({
      priors: [
        {
          strategy: "baseline",
          evidence_count: 2,
          median_server_elapsed_ms: 120,
        },
      ],
    });

    const guidance = (await getRecipeGuidance(identity))._unsafeUnwrap();

    expect(guidance.activeStrategy).toBeNull();
    expect(lookups.some((query) => query.includes("prior_available"))).toBe(
      true,
    );
  });

  it("returns no guidance when neither exact nor transferable evidence exists", async () => {
    mockSql({});

    const result = await getRecipeGuidance(identity);

    expect(result._unsafeUnwrap()).toEqual({
      source: "none",
      activeStrategy: null,
      prior: null,
    });
  });

  it("can resolve Arena guidance without counting a second question lookup", async () => {
    const lookups = mockSql({
      active: [{ strategy: "prewhere" }],
    });

    const result = await getRecipeGuidance(identity, {
      recordLookup: false,
    });

    expect(result._unsafeUnwrap().activeStrategy).toBe("prewhere");
    expect(
      lookups.some((query) =>
        query.includes("INSERT INTO query_recipe_lookup_events"),
      ),
    ).toBe(false);
  });
});
