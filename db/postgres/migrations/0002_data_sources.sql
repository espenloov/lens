CREATE TABLE IF NOT EXISTS data_sources
(
    id UUID PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'),
    display_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT data_sources_reserved_slug_check CHECK (slug <> 'uk_price_paid')
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'data_sources_reserved_slug_check'
    ) THEN
        ALTER TABLE data_sources
            ADD CONSTRAINT data_sources_reserved_slug_check
            CHECK (slug <> 'uk_price_paid');
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS data_source_versions
(
    data_source_id UUID NOT NULL REFERENCES data_sources(id),
    version INTEGER NOT NULL CHECK (version > 0),
    contract_version TEXT NOT NULL CHECK (contract_version = 'analytical_table/v1'),
    source_database TEXT NOT NULL,
    source_table TEXT NOT NULL,
    mapping_sql TEXT NOT NULL,
    mapping_digest CHAR(64) NOT NULL,
    source_schema JSONB NOT NULL,
    semantic_manifest JSONB NOT NULL,
    compatibility_report JSONB NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'compatible', 'incompatible')),
    date_from DATE,
    date_to DATE,
    row_count BIGINT CHECK (row_count IS NULL OR row_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (data_source_id, version),
    UNIQUE (data_source_id, mapping_digest)
);

ALTER TABLE data_source_versions
    ADD COLUMN IF NOT EXISTS semantic_manifest JSONB;

UPDATE data_source_versions
SET semantic_manifest = $manifest$
{
  "contract": "analytical_table/v1",
  "identifier": null,
  "time": {
    "key": "date",
    "label": "Sale date",
    "expression": "date",
    "storageType": "date",
    "granularities": ["year", "quarter", "month"],
    "timezone": null
  },
  "measures": [
    {
      "key": "price",
      "label": "Sale price",
      "expression": "price",
      "defaultAggregation": "average",
      "aggregations": ["average", "median", "minimum", "maximum"],
      "format": {
        "kind": "currency",
        "currency": "GBP",
        "maximumFractionDigits": 0
      },
      "resultScale": 0,
      "supportsDistribution": true
    }
  ],
  "dimensions": [
    {
      "key": "town",
      "label": "Town",
      "expression": "toString(town)",
      "filterExpression": "town",
      "orderExpression": null,
      "codeExpression": null,
      "kind": "categorical",
      "compact": false,
      "geographyLevel": 2,
      "values": []
    },
    {
      "key": "district",
      "label": "District",
      "expression": "toString(district)",
      "filterExpression": "district",
      "orderExpression": null,
      "codeExpression": null,
      "kind": "categorical",
      "compact": false,
      "geographyLevel": 1,
      "values": []
    },
    {
      "key": "county",
      "label": "County",
      "expression": "toString(county)",
      "filterExpression": "county",
      "orderExpression": null,
      "codeExpression": null,
      "kind": "categorical",
      "compact": false,
      "geographyLevel": 0,
      "values": []
    },
    {
      "key": "property_type",
      "label": "Property type",
      "expression": "multiIf(type = 'detached', 'Detached', type = 'semi-detached', 'Semi-detached', type = 'terraced', 'Terraced', type = 'flat', 'Flat', 'Other')",
      "filterExpression": "type",
      "orderExpression": "multiIf(type = 'detached', 1, type = 'semi-detached', 2, type = 'terraced', 3, type = 'flat', 4, 5)",
      "codeExpression": "multiIf(type = 'detached', 0, type = 'semi-detached', 1, type = 'terraced', 2, type = 'flat', 3, 4)",
      "kind": "categorical",
      "compact": true,
      "geographyLevel": null,
      "values": [
        {"value": "detached", "label": "Detached", "order": 1, "code": 0},
        {"value": "semi-detached", "label": "Semi-detached", "order": 2, "code": 1},
        {"value": "terraced", "label": "Terraced", "order": 3, "code": 2},
        {"value": "flat", "label": "Flat", "order": 4, "code": 3},
        {"value": "other", "label": "Other", "order": 5, "code": 4}
      ]
    },
    {
      "key": "tenure",
      "label": "Tenure",
      "expression": "multiIf(duration = 'freehold', 'Freehold', duration = 'leasehold', 'Leasehold', 'Unknown')",
      "filterExpression": "duration",
      "orderExpression": "multiIf(duration = 'freehold', 1, duration = 'leasehold', 2, 3)",
      "codeExpression": "multiIf(duration = 'freehold', 0, duration = 'leasehold', 1, 2)",
      "kind": "categorical",
      "compact": true,
      "geographyLevel": null,
      "values": [
        {"value": "freehold", "label": "Freehold", "order": 1, "code": 0},
        {"value": "leasehold", "label": "Leasehold", "order": 2, "code": 1},
        {"value": "unknown", "label": "Unknown", "order": 3, "code": 2}
      ]
    },
    {
      "key": "new_build",
      "label": "Build status",
      "expression": "if(is_new = 1, 'New build', 'Existing')",
      "filterExpression": "is_new",
      "orderExpression": "if(is_new = 1, 1, 2)",
      "codeExpression": "if(is_new = 1, 1, 0)",
      "kind": "boolean",
      "compact": true,
      "geographyLevel": null,
      "values": [
        {"value": false, "label": "Existing", "order": 2, "code": 0},
        {"value": true, "label": "New build", "order": 1, "code": 1}
      ]
    }
  ],
  "geography": {
    "levels": ["county", "district", "town"]
  }
}
$manifest$::JSONB
WHERE semantic_manifest IS NULL;

ALTER TABLE data_source_versions
    ALTER COLUMN semantic_manifest SET NOT NULL;

DO $$
DECLARE
    check_name TEXT;
BEGIN
    FOR check_name IN
        SELECT constraint_name
        FROM information_schema.check_constraints
        WHERE constraint_schema = CURRENT_SCHEMA()
          AND constraint_name IN (
              SELECT constraint_name
              FROM information_schema.constraint_column_usage
              WHERE table_schema = CURRENT_SCHEMA()
                AND table_name = 'data_source_versions'
                AND column_name = 'contract_version'
          )
    LOOP
        EXECUTE format(
            'ALTER TABLE data_source_versions DROP CONSTRAINT %I',
            check_name
        );
    END LOOP;
END
$$;

UPDATE data_source_versions
SET contract_version = 'analytical_table/v1'
WHERE contract_version = 'property_transactions/v1';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'data_source_versions_contract_version_check'
    ) THEN
        ALTER TABLE data_source_versions
            ADD CONSTRAINT data_source_versions_contract_version_check
            CHECK (contract_version = 'analytical_table/v1');
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'data_source_versions_semantic_manifest_check'
    ) THEN
        ALTER TABLE data_source_versions
            ADD CONSTRAINT data_source_versions_semantic_manifest_check
            CHECK (
                semantic_manifest->>'contract' = 'analytical_table/v1'
            );
    END IF;
END
$$;

CREATE OR REPLACE FUNCTION prevent_semantic_manifest_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.semantic_manifest IS DISTINCT FROM NEW.semantic_manifest THEN
        RAISE EXCEPTION 'A versioned semantic manifest is immutable';
    END IF;

    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS data_source_versions_semantic_manifest_immutable
    ON data_source_versions;

CREATE TRIGGER data_source_versions_semantic_manifest_immutable
BEFORE UPDATE OF semantic_manifest ON data_source_versions
FOR EACH ROW
EXECUTE FUNCTION prevent_semantic_manifest_update();

CREATE TABLE IF NOT EXISTS active_data_source_versions
(
    data_source_id UUID PRIMARY KEY REFERENCES data_sources(id),
    version INTEGER NOT NULL,
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (data_source_id, version)
        REFERENCES data_source_versions(data_source_id, version)
);

CREATE TABLE IF NOT EXISTS workspace_data_source_selections
(
    workspace_key TEXT PRIMARY KEY,
    data_source_id UUID NOT NULL REFERENCES data_sources(id),
    version INTEGER NOT NULL,
    selected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (data_source_id, version)
        REFERENCES data_source_versions(data_source_id, version)
);

CREATE TABLE IF NOT EXISTS data_source_performance_profiles
(
    data_source_id UUID NOT NULL,
    version INTEGER NOT NULL,
    validation_ms DOUBLE PRECISION NOT NULL CHECK (validation_ms >= 0),
    clickhouse_elapsed_ms DOUBLE PRECISION,
    rows_read BIGINT CHECK (rows_read IS NULL OR rows_read >= 0),
    bytes_read BIGINT CHECK (bytes_read IS NULL OR bytes_read >= 0),
    arrow_bytes BIGINT NOT NULL CHECK (arrow_bytes >= 0),
    rust_verified BOOLEAN NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (data_source_id, version),
    FOREIGN KEY (data_source_id, version)
        REFERENCES data_source_versions(data_source_id, version)
);
