/* tslint:disable */
/* eslint-disable */

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
 * Decodes a generic time-series Arrow IPC stream into typed columns.
 *
 * # Errors
 *
 * Returns a JavaScript error value when the bytes violate the time-series
 * schema or a row count cannot fit inside a `u32`.
 */
export function decode_time_series_arrow(bytes: Uint8Array): TimeSeriesData;

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
