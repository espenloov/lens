import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { fingerprintArrow } from "./node-verifier";

describe("fingerprintArrow", () => {
  it("runs the Rust verifier inside Node", () => {
    const bytes = readFileSync(
      path.resolve(
        process.cwd(),
        "../../crates/lens-core/tests/fixtures/manchester-yearly-generic.arrow",
      ),
    );
    const result = fingerprintArrow(bytes);

    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      expect(result.value).toEqual({
        algorithm: "sha256-v1",
        digest:
          "b4c37e16030fd3d068cd2bb4cad19f25a3fbbee3074d4fe7acda1e1519342bbb",
        rowCount: 9,
      });
    }
  });
});
