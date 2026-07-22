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
