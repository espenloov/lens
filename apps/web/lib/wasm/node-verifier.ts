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
