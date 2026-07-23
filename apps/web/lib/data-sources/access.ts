import { createHash, timingSafeEqual } from "node:crypto";

import { err, ok, type Result } from "neverthrow";

export type DataSourceAccessError = {
  readonly type: "data_source_access_error";
  readonly message: string;
  readonly status: 401 | 403 | 503;
};

function denied(
  message: string,
  status: DataSourceAccessError["status"],
): DataSourceAccessError {
  return {
    type: "data_source_access_error",
    message,
    status,
  };
}

function tokensMatch(expected: string, received: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);

  return (
    expectedBytes.byteLength === receivedBytes.byteLength &&
    timingSafeEqual(expectedBytes, receivedBytes)
  );
}

function expectedAdminToken(): Result<string | null, DataSourceAccessError> {
  const expectedToken = process.env.DATA_SOURCE_ADMIN_TOKEN?.trim();

  if (expectedToken === undefined || expectedToken.length === 0) {
    return process.env.NODE_ENV === "production"
      ? err(
          denied(
            "DATA_SOURCE_ADMIN_TOKEN is required in production",
            503,
          ),
        )
      : ok(null);
  }

  return ok(expectedToken);
}

function sessionValue(token: string): string {
  return createHash("sha256").update(`lens:data-sources:${token}`).digest("hex");
}

function cookieValue(request: Request): string {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(
    /(?:^|;\s*)lens_data_source_admin=([a-f0-9]{64})(?:;|$)/,
  );
  return match?.[1] ?? "";
}

function hasSession(request: Request, expectedToken: string): boolean {
  return tokensMatch(sessionValue(expectedToken), cookieValue(request));
}

export function authorizeDataSourceRead(
  request: Request,
): Result<void, DataSourceAccessError> {
  const expected = expectedAdminToken();

  if (expected.isErr()) {
    return err(expected.error);
  }

  if (expected.value === null || hasSession(request, expected.value)) {
    return ok(undefined);
  }

  return err(denied("Unlock the registered dataset workspace first", 401));
}

export function authorizeDataSourceMutation(
  request: Request,
): Result<void, DataSourceAccessError> {
  const origin = request.headers.get("origin");
  const requestOrigin = new URL(request.url).origin;

  if (origin !== null && origin !== requestOrigin) {
    return err(denied("Cross-origin data source changes are not allowed", 403));
  }

  const expected = expectedAdminToken();

  if (expected.isErr()) {
    return err(expected.error);
  }

  if (expected.value === null || hasSession(request, expected.value)) {
    return ok(undefined);
  }

  const authorization = request.headers.get("authorization");
  const receivedToken = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  return tokensMatch(expected.value, receivedToken)
    ? ok(undefined)
    : err(denied("A valid data source admin token is required", 401));
}

export function createDataSourceSessionCookie(
  request: Request,
): Result<string, DataSourceAccessError> {
  const access = authorizeDataSourceMutation(request);

  if (access.isErr()) {
    return err(access.error);
  }

  const expected = expectedAdminToken();

  if (expected.isErr()) {
    return err(expected.error);
  }

  const value = expected.value === null ? "local" : sessionValue(expected.value);

  return ok(
    `lens_data_source_admin=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=14400${
      process.env.NODE_ENV === "production" ? "; Secure" : ""
    }`,
  );
}
