CREATE TABLE IF NOT EXISTS physical_tuning_proposals
(
    id UUID PRIMARY KEY,
    state TEXT NOT NULL CHECK (
        state IN (
            'validated',
            'approved',
            'rejected',
            'applying',
            'applied',
            'failed',
            'rolled_back'
        )
    ),
    dataset_slug TEXT NOT NULL,
    dataset_version INTEGER NOT NULL CHECK (dataset_version > 0),
    source_database TEXT NOT NULL,
    source_table TEXT NOT NULL,
    analysis JSONB NOT NULL,
    template JSONB NOT NULL,
    physical_columns JSONB NOT NULL,
    evidence JSONB NOT NULL,
    validation JSONB NOT NULL,
    estimate JSONB NOT NULL,
    ddl JSONB NOT NULL,
    approved_by TEXT,
    rejection_reason TEXT,
    failure_message TEXT,
    rerace_run_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE physical_tuning_proposals
    ADD COLUMN IF NOT EXISTS estimate JSONB;

ALTER TABLE physical_tuning_proposals
    ADD COLUMN IF NOT EXISTS analysis JSONB;

ALTER TABLE physical_tuning_proposals
    ADD COLUMN IF NOT EXISTS rerace_run_id TEXT;

UPDATE physical_tuning_proposals
SET estimate = jsonb_build_object(
    'method', 'ordered_projection_heuristic_v1',
    'estimatedStorageBytes', NULL,
    'predictedSpeedup', jsonb_build_object('lower', 1.0, 'upper', 1.0),
    'confidence', 'low_until_reraced'
)
WHERE estimate IS NULL;

ALTER TABLE physical_tuning_proposals
    ALTER COLUMN estimate SET NOT NULL;

CREATE INDEX IF NOT EXISTS physical_tuning_proposals_dataset
    ON physical_tuning_proposals
        (dataset_slug, dataset_version, created_at DESC);

CREATE TABLE IF NOT EXISTS physical_tuning_events
(
    id BIGSERIAL PRIMARY KEY,
    proposal_id UUID NOT NULL
        REFERENCES physical_tuning_proposals(id) ON DELETE CASCADE,
    state TEXT NOT NULL,
    actor TEXT,
    detail TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS physical_tuning_events_proposal
    ON physical_tuning_events (proposal_id, created_at);
