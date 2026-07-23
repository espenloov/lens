import { afterEach, describe, expect, it } from "vitest";

import {
  authorizeDataSourceMutation,
  authorizeDataSourceRead,
  createDataSourceSessionCookie,
} from "./access";

const originalNodeEnv = process.env.NODE_ENV;
const originalToken = process.env.DATA_SOURCE_ADMIN_TOKEN;

afterEach(() => {
  Object.assign(process.env, {
    NODE_ENV: originalNodeEnv,
    DATA_SOURCE_ADMIN_TOKEN: originalToken,
  });
});

describe("data source access", () => {
  it("requires an explicit production configuration", () => {
    Object.assign(process.env, {
      NODE_ENV: "production",
      DATA_SOURCE_ADMIN_TOKEN: "",
    });
    const result = authorizeDataSourceMutation(
      new Request("https://lens.example/api/data-sources"),
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().status).toBe(503);
  });

  it("turns a valid bearer token into an HttpOnly read session", () => {
    Object.assign(process.env, {
      NODE_ENV: "production",
      DATA_SOURCE_ADMIN_TOKEN: "correct-horse",
    });
    const loginRequest = new Request(
      "https://lens.example/api/data-sources/session",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer correct-horse",
          Origin: "https://lens.example",
        },
      },
    );
    const session = createDataSourceSessionCookie(loginRequest);

    expect(session.isOk()).toBe(true);
    expect(session._unsafeUnwrap()).toContain("HttpOnly");

    const cookie = session._unsafeUnwrap().split(";")[0];
    const read = authorizeDataSourceRead(
      new Request("https://lens.example/api/data-sources", {
        headers: { Cookie: cookie },
      }),
    );

    expect(read.isOk()).toBe(true);
  });

  it("rejects cross-origin mutations", () => {
    Object.assign(process.env, {
      NODE_ENV: "development",
      DATA_SOURCE_ADMIN_TOKEN: "",
    });
    const result = authorizeDataSourceMutation(
      new Request("http://localhost:3000/api/data-sources", {
        method: "PATCH",
        headers: { Origin: "https://attacker.example" },
      }),
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().status).toBe(403);
  });
});
