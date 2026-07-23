import { createRequire } from "node:module";
import path from "node:path";

import { err, ok, type Result } from "neverthrow";

import type { QueryFingerprint } from "../query-arena/contracts";
import type * as LensNodeModule from "./lens-node/lens_wasm_node";

const require = createRequire(import.meta.url);

function getLensNodeModule(): typeof LensNodeModule {
  return require(
    path.join(
      process.cwd(),
      "lib",
      "wasm",
      "lens-node",
      "lens_wasm_node.js",
    ),
  ) as typeof LensNodeModule;
}

export type ArrowFingerprintError = {
  readonly type: "arrow_fingerprint_error";
  readonly message: string;
  readonly cause: unknown;
};

export type AnalyticalArrowVerification = {
  readonly rowCount: number;
};

export type AnalyticalArrowVerificationError = {
  readonly type: "analytical_arrow_verification_error";
  readonly message: string;
  readonly cause: unknown;
};

export function fingerprintArrow(
  bytes: Uint8Array,
): Result<QueryFingerprint, ArrowFingerprintError> {
  try {
    const fingerprint = getLensNodeModule().fingerprint_time_series_arrow(bytes);

    try {
      return ok({
        algorithm: "sha256-v1",
        digest: fingerprint.digest,
        rowCount: fingerprint.row_count,
      });
    } finally {
      fingerprint.free();
    }
  } catch (cause) {
    return err({
      type: "arrow_fingerprint_error",
      message:
        cause instanceof Error
          ? cause.message
          : "Rust could not fingerprint the Arrow result",
      cause,
    });
  }
}

export function verifyAnalyticalArrow(
  bytes: Uint8Array,
  roles: {
    readonly time: string | null;
    readonly measure: string;
    readonly dimension: string | null;
  },
): Result<AnalyticalArrowVerification, AnalyticalArrowVerificationError> {
  try {
    const table = getLensNodeModule().decode_analytical_table_arrow(
      bytes,
      roles.time,
      roles.measure,
      undefined,
      roles.dimension,
    );

    try {
      return ok({ rowCount: table.row_count });
    } finally {
      table.free();
    }
  } catch (cause) {
    return err({
      type: "analytical_arrow_verification_error",
      message:
        cause instanceof Error
          ? cause.message
          : "Rust could not verify the analytical Arrow result",
      cause,
    });
  }
}
