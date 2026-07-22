CREATE TABLE IF NOT EXISTS query_arena_performance_history
(
    arena_id UUID,
    analysis_signature FixedString(64),
    strategy LowCardinality(String),
    query_id Nullable(String),
    round_trip_ms Nullable(Float64),
    server_elapsed_ms Nullable(Float64),
    rows_read Nullable(UInt64),
    bytes_read Nullable(UInt64),
    arrow_bytes Nullable(UInt64),
    fingerprint Nullable(FixedString(64)),
    row_count Nullable(UInt32),
    outcome LowCardinality(String),
    error_message Nullable(String),
    winner Bool,
    recorded_at DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(recorded_at)
ORDER BY (analysis_signature, strategy, recorded_at, arena_id)
TTL recorded_at + INTERVAL 180 DAY DELETE;
