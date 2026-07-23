import type {
  AnalysisDataSource,
  DataSourceProfile,
  DataSourceSummary,
} from "./contracts";
import { PROPERTY_TRANSACTION_MANIFEST } from "./property-manifest";
import { deriveAnalyticalCapabilities } from "./semantic";

const BUILTIN_CAPABILITIES = deriveAnalyticalCapabilities(
  PROPERTY_TRANSACTION_MANIFEST,
  {
    dateFrom: "1995-01-01",
    dateTo: "2024-01-31",
  },
);

export const BUILTIN_DATA_SOURCE: AnalysisDataSource = {
  slug: "uk_price_paid",
  displayName: "UK Price Paid",
  version: 1,
  contractVersion: "analytical_table/v1",
  database: "default",
  table: "pp_complete",
  mappingSql: null,
  dateFrom: "1995-01-01",
  dateTo: "2024-01-31",
  rowCount: 28_919_900,
  supportsPrewhere: true,
  queryArenaEligible: true,
  manifest: PROPERTY_TRANSACTION_MANIFEST,
  capabilities: {
    ...BUILTIN_CAPABILITIES,
    operations: {
      ...BUILTIN_CAPABILITIES.operations,
      heatmap: true,
      exploration: true,
    },
  },
  builtin: true,
};

export function toDataSourceSummary(
  source: AnalysisDataSource,
  selected: boolean,
): DataSourceSummary {
  return {
    slug: source.slug,
    displayName: source.displayName,
    version: source.version,
    contractVersion: source.contractVersion,
    status: "compatible",
    database: source.database,
    table: source.table,
    dateFrom: source.dateFrom,
    dateTo: source.dateTo,
    rowCount: source.rowCount,
    supportsPrewhere: source.supportsPrewhere,
    queryArenaEligible: source.queryArenaEligible,
    capabilities: source.capabilities,
    selected,
    builtin: source.builtin,
  };
}

export function toDataSourceProfile(
  source: AnalysisDataSource,
): DataSourceProfile {
  return {
    time:
      source.manifest.time === null
        ? null
        : {
            key: source.manifest.time.key,
            label: source.manifest.time.label,
            storageType: source.manifest.time.storageType,
            granularities: source.manifest.time.granularities,
          },
    measures: source.manifest.measures.map((measure) => ({
      key: measure.key,
      label: measure.label,
      aggregations: measure.aggregations,
      format: measure.format.kind,
    })),
    dimensions: source.manifest.dimensions.map((dimension) => ({
      key: dimension.key,
      label: dimension.label,
      kind: dimension.kind,
      knownValues: dimension.values.length,
    })),
  };
}
