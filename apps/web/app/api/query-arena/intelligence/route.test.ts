import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDataSourceSessionCookie } from "../../../../lib/data-sources/access";

const mocks = vi.hoisted(() => ({
  intelligence: vi.fn(),
}));

vi.mock("../../../../lib/query-arena/intelligence", () => ({
  getSystemIntelligence: mocks.intelligence,
}));

import { GET } from "./route";

const originalNodeEnv = process.env.NODE_ENV;
const originalToken = process.env.DATA_SOURCE_ADMIN_TOKEN;

function authenticatedRequest(): Request {
  const login = new Request(
    "https://lens.example/api/data-sources/session",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer intelligence-secret",
        Origin: "https://lens.example",
      },
    },
  );
  const session = createDataSourceSessionCookie(login)._unsafeUnwrap();

  return new Request("https://lens.example/api/query-arena/intelligence", {
    headers: { Cookie: session.split(";")[0]! },
  });
}

beforeEach(() => {
  Object.assign(process.env, {
    NODE_ENV: "production",
    DATA_SOURCE_ADMIN_TOKEN: "intelligence-secret",
  });
  mocks.intelligence.mockReset();
  mocks.intelligence.mockResolvedValue({
    available: true,
    clickHouseAvailable: true,
    registryAvailable: true,
    verifiedRaces: 12,
    recipeActivations: 4,
    semanticFamilies: 3,
    exactHits: 5,
    priorSuggestions: 2,
    exactHitRate: 0.5,
    baselineP50Ms: 200,
    baselineP95Ms: 500,
    winnerP50Ms: 100,
    winnerP95Ms: 150,
    accumulatedServerMsSaved: 1_000,
  });
});

afterEach(() => {
  Object.assign(process.env, {
    NODE_ENV: originalNodeEnv,
    DATA_SOURCE_ADMIN_TOKEN: originalToken,
  });
});

describe("GET /api/query-arena/intelligence", () => {
  it("requires the authenticated dataset session", async () => {
    const response = await GET(
      new Request("https://lens.example/api/query-arena/intelligence"),
    );

    expect(response.status).toBe(401);
    expect(mocks.intelligence).not.toHaveBeenCalled();
  });

  it("returns only the measured intelligence snapshot", async () => {
    const response = await GET(authenticatedRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      verifiedRaces: 12,
      recipeActivations: 4,
      baselineP95Ms: 500,
      winnerP95Ms: 150,
    });
    expect(mocks.intelligence).toHaveBeenCalledOnce();
  });
});
