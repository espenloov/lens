import { describe, expect, it } from "vitest";

import { BUILTIN_DATA_SOURCE } from "../../data-sources/builtin";

import { compileProjectionTemplate } from "./projection";

describe("ordered projection template", () => {
  it("compiles deterministic and reversible ClickHouse DDL", () => {
    const first = compileProjectionTemplate(BUILTIN_DATA_SOURCE, {
      kind: "ordered_projection_v1",
      timeKey: "date",
      dimensionKeys: ["property_type", "town"],
    });
    const second = compileProjectionTemplate(BUILTIN_DATA_SOURCE, {
      kind: "ordered_projection_v1",
      timeKey: "date",
      dimensionKeys: ["property_type", "town"],
    });

    expect(first.isOk()).toBe(true);
    expect(second).toEqual(first);

    if (first.isErr()) {
      throw new Error(first.error.message);
    }

    expect(first.value.physicalColumns).toEqual(["date", "type", "town"]);
    expect(first.value.ddl.add).toContain("ADD PROJECTION IF NOT EXISTS");
    expect(first.value.ddl.add).toContain(
      "ORDER BY (`date`, `type`, `town`)",
    );
    expect(first.value.ddl.rollback).toContain(
      "DROP PROJECTION IF EXISTS",
    );
  });

  it("does not compile arbitrary semantic expressions into DDL", () => {
    const source = {
      ...BUILTIN_DATA_SOURCE,
      manifest: {
        ...BUILTIN_DATA_SOURCE.manifest,
        time: {
          ...BUILTIN_DATA_SOURCE.manifest.time!,
          expression: "toDate(date)",
        },
      },
    };
    const compiled = compileProjectionTemplate(source, {
      kind: "ordered_projection_v1",
      timeKey: "date",
      dimensionKeys: ["town"],
    });

    expect(compiled.isErr()).toBe(true);
    expect(compiled._unsafeUnwrapErr().message).toContain(
      "not backed by one physical column",
    );
  });

  it("rejects semantic keys that are not in the manifest", () => {
    const compiled = compileProjectionTemplate(BUILTIN_DATA_SOURCE, {
      kind: "ordered_projection_v1",
      timeKey: "date",
      dimensionKeys: ["missing"],
    });

    expect(compiled.isErr()).toBe(true);
  });
});
