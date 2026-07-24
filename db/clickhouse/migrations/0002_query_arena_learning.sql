ALTER TABLE query_arena_performance_history
    ADD COLUMN IF NOT EXISTS semantic_family_hash Nullable(FixedString(64))
    AFTER analysis_signature;

ALTER TABLE query_arena_performance_history
    ADD COLUMN IF NOT EXISTS dataset LowCardinality(String)
    DEFAULT ''
    AFTER semantic_family_hash;

ALTER TABLE query_arena_performance_history
    ADD COLUMN IF NOT EXISTS dataset_version UInt32
    DEFAULT 0
    AFTER dataset;
