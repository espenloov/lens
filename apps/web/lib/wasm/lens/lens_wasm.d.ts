/* tslint:disable */
/* eslint-disable */

export class AnomalyValues {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    expected(): Float64Array;
    flags(): Uint8Array;
    scores(): Float64Array;
    validity(): Uint8Array;
}

export class CategoryData {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    category(index: number): string | undefined;
    observation_counts(): BigUint64Array;
    values(): Float64Array;
    readonly row_count: number;
}

export class DerivedValues {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    validity(): Uint8Array;
    values(): Float64Array;
}

export class ExplorationDensityFrame {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    daily_quartiles(): Float64Array;
    density_counts(): Uint32Array;
}

export class ExplorationWindow {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    dimension_counts(dimension: number): Uint32Array;
    histogram_counts(): Uint32Array;
    readonly average_value: number;
    readonly estimated_outlier_count: number;
    readonly median: number;
    readonly q1: number;
    readonly q3: number;
    readonly total_count: number;
}

export class ExplorationWorkspace {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Returns estimated daily quartiles for the selected category codes.
     *
     * # Errors
     *
     * Returns a JavaScript error when a filter code is outside its codebook.
     */
    daily_quartiles(dimension_0: number, dimension_1: number, dimension_2: number): Float64Array;
    /**
     * Returns the time-by-value density for the selected category codes.
     *
     * # Errors
     *
     * Returns a JavaScript error when a filter code is outside its codebook.
     */
    density_counts(dimension_0: number, dimension_1: number, dimension_2: number): Uint32Array;
    /**
     * Returns density counts and estimated daily quartiles with one density pass.
     *
     * # Errors
     *
     * Returns a JavaScript error when a filter code is outside its codebook.
     */
    density_frame(dimension_0: number, dimension_1: number, dimension_2: number): ExplorationDensityFrame;
    /**
     * Summarizes one inclusive local time window.
     *
     * # Errors
     *
     * Returns a JavaScript error when the window or filter codes are invalid.
     */
    summarize(start: number, end: number, dimension_0: number, dimension_1: number, dimension_2: number): ExplorationWindow;
    readonly bin_count: number;
    readonly bucket_minimum: number;
    readonly bucket_width: number;
    readonly day_count: number;
    readonly index_bytes: number;
    readonly row_count: number;
}

export class HistogramData {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    bin_ends(): Float64Array;
    bin_starts(): Float64Array;
    observation_counts(): BigUint64Array;
    series_indexes(): Uint32Array;
    series_name(index: number): string | undefined;
    values(): Float64Array;
    readonly row_count: number;
    readonly series_count: number;
}

export class MatrixData {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    observation_counts(): BigUint64Array;
    values(): Float64Array;
    x_indexes(): Uint32Array;
    x_label(index: number): string | undefined;
    y_indexes(): Uint32Array;
    y_label(index: number): string | undefined;
    readonly row_count: number;
    readonly x_count: number;
    readonly y_count: number;
}

export class TimeSeriesData {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    observation_counts(): BigUint64Array;
    period_starts(): Int32Array;
    series_indexes(): Uint32Array;
    series_name(index: number): string | undefined;
    values(): Float64Array;
    readonly row_count: number;
    readonly series_count: number;
}

export class TimeSeriesFingerprint {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly algorithm: string;
    readonly digest: string;
    readonly row_count: number;
}

export class TimeSeriesVerification {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly equivalent: boolean;
    readonly left_fingerprint: string;
    readonly left_row_count: number;
    readonly mismatch_reason: string | undefined;
    readonly right_fingerprint: string;
    readonly right_row_count: number;
}

/**
 * Builds a persistent Rust exploration workspace from an `exploration/v1` Arrow stream.
 *
 * # Errors
 *
 * Returns a JavaScript error when the stream or bounded workspace configuration is invalid.
 */
export function build_exploration_workspace(bytes: Uint8Array, day_count: number, bin_count: number, bucket_minimum: number, bucket_width: number, cardinality_0: number, cardinality_1: number, cardinality_2: number): ExplorationWorkspace;

/**
 * Decodes a `categorical/v1` Arrow IPC stream.
 *
 * # Errors
 *
 * Returns a JavaScript error when the bytes violate the categorical contract.
 */
export function decode_category_arrow(bytes: Uint8Array): CategoryData;

/**
 * Decodes a `histogram/v1` Arrow IPC stream.
 *
 * # Errors
 *
 * Returns a JavaScript error when the bytes violate the histogram contract.
 */
export function decode_histogram_arrow(bytes: Uint8Array): HistogramData;

/**
 * Decodes a sparse `matrix/v1` Arrow IPC stream.
 *
 * # Errors
 *
 * Returns a JavaScript error when the bytes violate the matrix contract.
 */
export function decode_matrix_arrow(bytes: Uint8Array): MatrixData;

/**
 * Decodes a generic time-series Arrow IPC stream into typed columns.
 *
 * # Errors
 *
 * Returns a JavaScript error value when the bytes violate the time-series
 * schema or a row count cannot fit inside a `u32`.
 */
export function decode_time_series_arrow(bytes: Uint8Array): TimeSeriesData;

/**
 * Calculates robust seasonal anomaly scores over typed time-series columns.
 *
 * # Errors
 *
 * Returns a JavaScript error for invalid intervals, dates, thresholds, or mismatched columns.
 */
export function derive_anomaly_scores(periods: Int32Array, series_indexes: Uint32Array, values: Float64Array, observation_counts: BigUint64Array, interval: string, threshold: number): AnomalyValues;

/**
 * Calculates composition shares over typed time-series columns.
 *
 * # Errors
 *
 * Returns a JavaScript error when input columns have different lengths.
 */
export function derive_composition_shares(periods: Int32Array, values: Float64Array): DerivedValues;

/**
 * Calculates adjacent period percentage changes over typed time-series columns.
 *
 * # Errors
 *
 * Returns a JavaScript error for invalid intervals, dates, or mismatched columns.
 */
export function derive_period_changes(periods: Int32Array, series_indexes: Uint32Array, values: Float64Array, interval: string): DerivedValues;

/**
 * Creates a stable fingerprint for one Arrow IPC time-series stream.
 *
 * # Errors
 *
 * Returns a JavaScript error value when the stream violates the time-series
 * schema, contains invalid values, or its row count cannot fit inside a `u32`.
 */
export function fingerprint_time_series_arrow(bytes: Uint8Array): TimeSeriesFingerprint;

/**
 * Verifies that two Arrow IPC streams contain the same time-series rows.
 *
 * # Errors
 *
 * Returns a JavaScript error value when either stream violates the time-series
 * schema, contains invalid values, or a row count cannot fit inside a `u32`.
 */
export function verify_time_series_arrow(left: Uint8Array, right: Uint8Array): TimeSeriesVerification;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_anomalyvalues_free: (a: number, b: number) => void;
    readonly __wbg_categorydata_free: (a: number, b: number) => void;
    readonly __wbg_derivedvalues_free: (a: number, b: number) => void;
    readonly __wbg_explorationdensityframe_free: (a: number, b: number) => void;
    readonly __wbg_explorationwindow_free: (a: number, b: number) => void;
    readonly __wbg_explorationworkspace_free: (a: number, b: number) => void;
    readonly __wbg_histogramdata_free: (a: number, b: number) => void;
    readonly __wbg_matrixdata_free: (a: number, b: number) => void;
    readonly __wbg_timeseriesdata_free: (a: number, b: number) => void;
    readonly __wbg_timeseriesfingerprint_free: (a: number, b: number) => void;
    readonly __wbg_timeseriesverification_free: (a: number, b: number) => void;
    readonly anomalyvalues_expected: (a: number, b: number) => void;
    readonly anomalyvalues_flags: (a: number, b: number) => void;
    readonly anomalyvalues_scores: (a: number, b: number) => void;
    readonly anomalyvalues_validity: (a: number, b: number) => void;
    readonly build_exploration_workspace: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly categorydata_category: (a: number, b: number, c: number) => void;
    readonly categorydata_observation_counts: (a: number, b: number) => void;
    readonly categorydata_row_count: (a: number) => number;
    readonly categorydata_values: (a: number, b: number) => void;
    readonly decode_category_arrow: (a: number, b: number, c: number) => void;
    readonly decode_histogram_arrow: (a: number, b: number, c: number) => void;
    readonly decode_matrix_arrow: (a: number, b: number, c: number) => void;
    readonly decode_time_series_arrow: (a: number, b: number, c: number) => void;
    readonly derive_anomaly_scores: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => void;
    readonly derive_composition_shares: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly derive_period_changes: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly derivedvalues_validity: (a: number, b: number) => void;
    readonly derivedvalues_values: (a: number, b: number) => void;
    readonly explorationdensityframe_daily_quartiles: (a: number, b: number) => void;
    readonly explorationdensityframe_density_counts: (a: number, b: number) => void;
    readonly explorationwindow_average_value: (a: number) => number;
    readonly explorationwindow_dimension_counts: (a: number, b: number, c: number) => void;
    readonly explorationwindow_estimated_outlier_count: (a: number) => number;
    readonly explorationwindow_histogram_counts: (a: number, b: number) => void;
    readonly explorationwindow_median: (a: number) => number;
    readonly explorationwindow_q1: (a: number) => number;
    readonly explorationwindow_q3: (a: number) => number;
    readonly explorationwindow_total_count: (a: number) => number;
    readonly explorationworkspace_bin_count: (a: number) => number;
    readonly explorationworkspace_daily_quartiles: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly explorationworkspace_day_count: (a: number) => number;
    readonly explorationworkspace_density_counts: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly explorationworkspace_density_frame: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly explorationworkspace_index_bytes: (a: number) => number;
    readonly explorationworkspace_row_count: (a: number) => number;
    readonly explorationworkspace_summarize: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly fingerprint_time_series_arrow: (a: number, b: number, c: number) => void;
    readonly histogramdata_bin_ends: (a: number, b: number) => void;
    readonly histogramdata_bin_starts: (a: number, b: number) => void;
    readonly histogramdata_observation_counts: (a: number, b: number) => void;
    readonly histogramdata_row_count: (a: number) => number;
    readonly histogramdata_series_count: (a: number) => number;
    readonly histogramdata_series_indexes: (a: number, b: number) => void;
    readonly histogramdata_series_name: (a: number, b: number, c: number) => void;
    readonly histogramdata_values: (a: number, b: number) => void;
    readonly matrixdata_observation_counts: (a: number, b: number) => void;
    readonly matrixdata_values: (a: number, b: number) => void;
    readonly matrixdata_x_count: (a: number) => number;
    readonly matrixdata_x_indexes: (a: number, b: number) => void;
    readonly matrixdata_x_label: (a: number, b: number, c: number) => void;
    readonly matrixdata_y_indexes: (a: number, b: number) => void;
    readonly matrixdata_y_label: (a: number, b: number, c: number) => void;
    readonly timeseriesdata_observation_counts: (a: number, b: number) => void;
    readonly timeseriesdata_period_starts: (a: number, b: number) => void;
    readonly timeseriesdata_row_count: (a: number) => number;
    readonly timeseriesdata_series_count: (a: number) => number;
    readonly timeseriesdata_series_indexes: (a: number, b: number) => void;
    readonly timeseriesdata_series_name: (a: number, b: number, c: number) => void;
    readonly timeseriesdata_values: (a: number, b: number) => void;
    readonly timeseriesfingerprint_algorithm: (a: number, b: number) => void;
    readonly timeseriesfingerprint_digest: (a: number, b: number) => void;
    readonly timeseriesverification_equivalent: (a: number) => number;
    readonly timeseriesverification_left_fingerprint: (a: number, b: number) => void;
    readonly timeseriesverification_left_row_count: (a: number) => number;
    readonly timeseriesverification_mismatch_reason: (a: number, b: number) => void;
    readonly timeseriesverification_right_fingerprint: (a: number, b: number) => void;
    readonly verify_time_series_arrow: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly matrixdata_row_count: (a: number) => number;
    readonly matrixdata_y_count: (a: number) => number;
    readonly explorationworkspace_bucket_minimum: (a: number) => number;
    readonly explorationworkspace_bucket_width: (a: number) => number;
    readonly timeseriesfingerprint_row_count: (a: number) => number;
    readonly timeseriesverification_right_row_count: (a: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
