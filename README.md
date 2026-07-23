<p align="center">
  <img src="apps/web/public/lens_logo.png" alt="Lens" width="128" />
</p>

<h1 align="center">Lens</h1>

<p align="center">
  Ask a question. Explore millions of rows. Receive an interactive dashboard.
</p>

<p align="center">
  <img src="apps/web/public/clickhouse-yellow-badge.svg" alt="ClickHouse" height="38" />
  &nbsp;&nbsp;&nbsp;
  <img src="apps/web/public/triggerdotdev_logo.jpeg" alt="Trigger.dev" height="38" />
  &nbsp;&nbsp;&nbsp;
  <img src="apps/web/public/rust_logo.webp" alt="Rust" height="38" />
  &nbsp;&nbsp;&nbsp;
  <img src="apps/web/public/wasm_logo.png" alt="WebAssembly" height="38" />
  &nbsp;&nbsp;&nbsp;
  <img src="apps/web/public/PostgreSQL-Logo.png" alt="PostgreSQL" height="38" />
</p>

## Meet Lens

Most data tools give you a query box or a collection of charts. Lens starts with
the question you actually care about.

Ask how prices changed, where anomalies appeared, which categories behaved
differently, or what a million raw records look like. Lens understands the
request, finds the right data, and assembles a dashboard around the answer.

The first complete experiences use property transactions from England and Wales
and New York City taxi journeys. The analysis engine itself is driven by data
source manifests, so the same language, performance system, and visual building
blocks can work with newly registered analytical tables.

> Show the average sale price in Manchester by year from 2015 to 2023.

> Compare monthly taxi fares by payment type across the full history.

> Load every property sale from 2022 so I can reshape the distribution locally.

## From question to dashboard

An OpenAI agent turns the question into a validated analysis plan. PostgreSQL
is checked for a proven query recipe. ClickHouse scans and aggregates the
source data. Arrow carries the result as compact columnar buffers. Rust checks
or reshapes those columns, both on the server and inside the browser through
WebAssembly. Trigger.dev coordinates the durable work behind the answer.

The result is not a text response with a chart attached. It is a dashboard
whose layout and interactions reflect the question.

> **Excalidraw space: the answer journey**
>
> This space is reserved for the architecture canvas that follows one question
> through OpenAI, PostgreSQL, ClickHouse, Arrow, Rust, WebAssembly, and the
> dashboard.

<!-- Replace the note above with docs/diagrams/answer_journey.svg -->

## The Query Arena

Lens learns how to answer repeated analytical questions faster.

For a supported time series analysis, Lens creates a stable fingerprint from
the meaning of the request. Before ClickHouse runs the query, PostgreSQL is
asked whether a verified winning recipe already exists. When there is no
winner yet, Lens starts safely with the baseline recipe.

Trigger.dev then runs a background race between valid query strategies. Every
candidate is measured several times. Rust fingerprints the Arrow output and
will only accept a winner when the results are exactly identical. ClickHouse
keeps the performance history, while PostgreSQL remembers the active recipe
for the next matching question.

In a live New York City Taxi analysis, filter pushdown won by **1.10×**. Rust
verified the result, PostgreSQL remembered it, and the Performance view made
the complete race visible.

> **Excalidraw space: the learning loop**
>
> This space is reserved for the canvas showing how an answer becomes a
> benchmark, how Rust protects correctness, and how PostgreSQL turns the winner
> into the next query recipe.

<!-- Replace the note above with docs/diagrams/query_arena_learning_loop.svg -->

## Why Arrow and Rust matter

Traditional analytics applications often turn every row into JSON, allocate a
JavaScript object for it, and then rebuild the same information for a chart.
Lens keeps the result columnar.

For the property exploration test, ClickHouse returned every recorded sale
from 2022 with price, property type, tenure, and new build status. Rust turned
those columns into a local exploration index that can update distributions,
percentiles, and density views without another network request.

The benchmark alternates the same ClickHouse query between `ArrowStream` and
`JSONEachRow` for three trials and reports the median.

| Measurement | Arrow IPC with Rust | JSONEachRow |
| :--- | ---: | ---: |
| Transactions | 993,644 | 993,644 |
| Payload received by the application | 4.73 MB | 80.17 MB |
| ClickHouse to client round trip | 499 ms | 2,082 ms |
| Local work | 36.2 ms to build the index | 242.7 ms to parse JSON |
| Interactive local index | 8.43 MB | Not built |

The Arrow representation was **16.9× smaller** at the application boundary and
completed the round trip **4.2× faster**. Rust built the complete interactive
index **6.7× faster** than JavaScript parsed the JSON objects alone.

This comparison is intentionally transparent. HTTP compression narrows the
estimated transfer difference to 1.13× because JSON compresses well. The JSON
measurement also stops after parsing. It does not build an equivalent index
for filtering, histograms, percentiles, and density calculations.

You can reproduce it against the configured ClickHouse service.

```bash
pnpm benchmark:formats
```

## The technology behind Lens

<p>
  <img src="apps/web/public/clickhouse-yellow-badge.svg" alt="ClickHouse" height="30" />
</p>

ClickHouse handles the high volume analytical scans, aggregations, Arrow output,
and performance history.

<p>
  <img src="apps/web/public/triggerdotdev_logo.jpeg" alt="Trigger.dev" height="30" />
</p>

Trigger.dev coordinates agent work, data source registration, and the durable
Query Arena races.

<p>
  <img src="apps/web/public/rust_logo.webp" alt="Rust" height="30" />
  &nbsp;&nbsp;
  <img src="apps/web/public/wasm_logo.png" alt="WebAssembly" height="30" />
</p>

Rust provides exact Arrow verification and high performance analysis kernels.
WebAssembly brings the same engine into the browser for instant local
exploration.

<p>
  <img src="apps/web/public/PostgreSQL-Logo.png" alt="PostgreSQL" height="30" />
</p>

PostgreSQL stores the current operational state, registered data sources, and
the verified recipe selected for each analysis fingerprint.

## Run Lens locally

Install the workspace dependencies.

```bash
pnpm install
```

Create the local environment file and add your ClickHouse, OpenAI, Trigger.dev,
and PostgreSQL credentials.

```bash
cp apps/web/.env.example apps/web/.env.local
```

Start PostgreSQL. A fresh volume applies the migrations automatically.

```bash
docker compose up -d postgres
```

Build the Rust WebAssembly packages.

```bash
pnpm build:wasm
```

Run the web application and Trigger.dev worker in separate terminals.

```bash
pnpm dev:web
```

```bash
pnpm dev:trigger
```

For an existing PostgreSQL volume, apply the data source registry migration
once.

```bash
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U lens -d lens < db/postgres/migrations/0002_data_sources.sql
```

## Verify the project

```bash
pnpm --dir apps/web test
pnpm lint:web
pnpm build:web
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

## License

Lens is available under the Apache License 2.0. See [LICENSE](LICENSE).
