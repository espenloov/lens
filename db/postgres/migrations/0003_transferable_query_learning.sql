ALTER TABLE query_recipe_versions
    ADD COLUMN IF NOT EXISTS semantic_family_hash CHAR(64);

CREATE INDEX IF NOT EXISTS query_recipe_versions_semantic_family_idx
    ON query_recipe_versions (semantic_family_hash, analysis_signature)
    WHERE semantic_family_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS query_recipe_lookup_events
(
    id BIGSERIAL PRIMARY KEY,
    execution_signature CHAR(64) NOT NULL,
    semantic_family_hash CHAR(64),
    outcome TEXT NOT NULL CHECK (
        outcome IN ('exact_hit', 'exact_miss', 'prior_available')
    ),
    strategy TEXT CHECK (strategy IN ('baseline', 'prewhere')),
    prior_evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (
        prior_evidence_count >= 0
    ),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (outcome = 'exact_miss' AND strategy IS NULL) OR
        (outcome <> 'exact_miss' AND strategy IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS query_recipe_lookup_events_recorded_at_idx
    ON query_recipe_lookup_events (recorded_at DESC);

CREATE INDEX IF NOT EXISTS query_recipe_lookup_events_semantic_family_idx
    ON query_recipe_lookup_events (semantic_family_hash, recorded_at DESC)
    WHERE semantic_family_hash IS NOT NULL;
