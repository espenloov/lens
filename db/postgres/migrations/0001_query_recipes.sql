CREATE TABLE IF NOT EXISTS query_recipe_versions
(
    analysis_signature CHAR(64) NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    strategy TEXT NOT NULL CHECK (strategy IN ('baseline', 'prewhere')),
    fingerprint CHAR(64) NOT NULL,
    server_elapsed_ms DOUBLE PRECISION NOT NULL CHECK (server_elapsed_ms >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (analysis_signature, version)
);

CREATE TABLE IF NOT EXISTS active_query_recipes
(
    analysis_signature CHAR(64) PRIMARY KEY,
    version INTEGER NOT NULL,
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (analysis_signature, version)
        REFERENCES query_recipe_versions (analysis_signature, version)
);
