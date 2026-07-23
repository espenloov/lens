import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";

import { createClient } from "@clickhouse/client";

const require = createRequire(import.meta.url);
const { build_exploration_workspace } = require(
  "../lib/wasm/lens-node/lens_wasm_node.js",
);

const requiredEnvironment = [
  "CLICKHOUSE_HOST",
  "CLICKHOUSE_USER",
  "CLICKHOUSE_PASSWORD",
  "CLICKHOUSE_DATABASE",
];

for (const key of requiredEnvironment) {
  if (!process.env[key]) {
    throw new Error(`${key} is required`);
  }
}

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
});
const trials = Number(process.env.BENCHMARK_TRIALS ?? "3");
const query = `
  SELECT
    toUInt16(dateDiff('day', toDate('2022-01-01'), date)) AS day_index,
    toFloat64(price) AS value,
    toUInt8(multiIf(
      type = 'detached', 0,
      type = 'semi-detached', 1,
      type = 'terraced', 2,
      type = 'flat', 3,
      4
    )) AS dimension_0,
    toUInt8(multiIf(
      duration = 'freehold', 0,
      duration = 'leasehold', 1,
      2
    )) AS dimension_1,
    toUInt8(if(is_new = 1, 1, 0)) AS dimension_2
  FROM pp_complete
  PREWHERE date >= toDate('2022-01-01')
    AND date <= toDate('2022-12-31')
  ORDER BY date
`;
const settings = {
  max_execution_time: 60,
  max_result_rows: "1000000",
  max_result_bytes: "536870912",
  max_memory_usage: "1073741824",
  result_overflow_mode: "throw",
  readonly: "1",
  use_query_cache: 0,
};

async function collect(format) {
  const startedAt = performance.now();
  const response = await client.exec({
    query: `${query}\nFORMAT ${format}`,
    clickhouse_settings: {
      ...settings,
      ...(format === "ArrowStream"
        ? {
            output_format_arrow_compression_method: "lz4_frame",
          }
        : {
            output_format_json_quote_64bit_integers: 0,
          }),
    },
  });
  const chunks = [];
  let byteLength = 0;

  for await (const chunk of response.stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(bytes);
    byteLength += bytes.byteLength;
  }

  return {
    bytes: Buffer.concat(chunks, byteLength),
    queryId: response.query_id,
    roundTripMs: performance.now() - startedAt,
    serverElapsedMs:
      response.summary?.elapsed_ns === undefined
        ? null
        : Number(response.summary.elapsed_ns) / 1_000_000,
    rowsRead:
      response.summary?.read_rows === undefined
        ? null
        : Number(response.summary.read_rows),
  };
}

function median(values) {
  if (values.length === 0) {
    return null;
  }

  return [...values].sort((left, right) => left - right)[
    Math.floor(values.length / 2)
  ];
}

function parseJsonRows(bytes) {
  const startedAt = performance.now();
  const lines = bytes.toString("utf8").trim().split("\n");
  let checksum = 0;

  for (const line of lines) {
    const row = JSON.parse(line);
    checksum +=
      row.day_index +
      row.value +
      row.dimension_0 +
      row.dimension_1 +
      row.dimension_2;
  }

  return {
    checksum,
    parseMs: performance.now() - startedAt,
    rowCount: lines.length,
  };
}

function buildRustIndex(bytes) {
  const startedAt = performance.now();
  const workspace = build_exploration_workspace(
    bytes,
    365,
    64,
    0,
    50_000,
    5,
    3,
    2,
  );

  try {
    return {
      indexBuildMs: performance.now() - startedAt,
      indexBytes: workspace.index_bytes,
      rowCount: workspace.row_count,
    };
  } finally {
    workspace.free();
  }
}

const arrowTrials = [];
const jsonTrials = [];

for (let index = 0; index < trials; index += 1) {
  const arrow = await collect("ArrowStream");
  const rust = buildRustIndex(arrow.bytes);
  const json = await collect("JSONEachRow");
  const parsed = parseJsonRows(json.bytes);

  if (rust.rowCount !== parsed.rowCount) {
    throw new Error(
      `Format row counts differ: Arrow ${rust.rowCount}, JSON ${parsed.rowCount}`,
    );
  }

  arrowTrials.push({
    applicationBytes: arrow.bytes.byteLength,
    gzipBytes: gzipSync(arrow.bytes).byteLength,
    indexBuildMs: rust.indexBuildMs,
    indexBytes: rust.indexBytes,
    queryId: arrow.queryId,
    roundTripMs: arrow.roundTripMs,
    serverElapsedMs: arrow.serverElapsedMs,
    rowsRead: arrow.rowsRead,
    rowCount: rust.rowCount,
  });
  jsonTrials.push({
    applicationBytes: json.bytes.byteLength,
    gzipBytes: gzipSync(json.bytes).byteLength,
    parseMs: parsed.parseMs,
    queryId: json.queryId,
    roundTripMs: json.roundTripMs,
    serverElapsedMs: json.serverElapsedMs,
    rowsRead: json.rowsRead,
  });
}

const arrowBytes = median(
  arrowTrials.map((trial) => trial.applicationBytes),
);
const jsonBytes = median(jsonTrials.map((trial) => trial.applicationBytes));
const arrowGzipBytes = median(arrowTrials.map((trial) => trial.gzipBytes));
const jsonGzipBytes = median(jsonTrials.map((trial) => trial.gzipBytes));
const result = {
  benchmark: "uk_price_paid_2022_exploration",
  generatedAt: new Date().toISOString(),
  rows: arrowTrials[0].rowCount,
  trials,
  arrow: {
    applicationBytes: arrowBytes,
    gzipBytes: arrowGzipBytes,
    roundTripMs: median(arrowTrials.map((trial) => trial.roundTripMs)),
    serverElapsedMs: median(
      arrowTrials
        .map((trial) => trial.serverElapsedMs)
        .filter((value) => value !== null),
    ),
    rustIndexBuildMs: median(
      arrowTrials.map((trial) => trial.indexBuildMs),
    ),
    rustIndexBytes: median(arrowTrials.map((trial) => trial.indexBytes)),
  },
  jsonEachRow: {
    applicationBytes: jsonBytes,
    gzipBytes: jsonGzipBytes,
    roundTripMs: median(jsonTrials.map((trial) => trial.roundTripMs)),
    serverElapsedMs: median(
      jsonTrials
        .map((trial) => trial.serverElapsedMs)
        .filter((value) => value !== null),
    ),
    parseMs: median(jsonTrials.map((trial) => trial.parseMs)),
  },
  ratios: {
    applicationPayloadReduction: jsonBytes / arrowBytes,
    gzipPayloadReduction: jsonGzipBytes / arrowGzipBytes,
  },
};

console.log(JSON.stringify(result, null, 2));
await client.close();
