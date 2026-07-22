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

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_timeseriesdata_free: (a: number, b: number) => void;
    readonly __wbg_timeseriesfingerprint_free: (a: number, b: number) => void;
    readonly __wbg_timeseriesverification_free: (a: number, b: number) => void;
    readonly decode_time_series_arrow: (a: number, b: number, c: number) => void;
    readonly fingerprint_time_series_arrow: (a: number, b: number, c: number) => void;
    readonly timeseriesdata_observation_counts: (a: number, b: number) => void;
    readonly timeseriesdata_period_starts: (a: number, b: number) => void;
    readonly timeseriesdata_row_count: (a: number) => number;
    readonly timeseriesdata_series_count: (a: number) => number;
    readonly timeseriesdata_series_indexes: (a: number, b: number) => void;
    readonly timeseriesdata_series_name: (a: number, b: number, c: number) => void;
    readonly timeseriesdata_values: (a: number, b: number) => void;
    readonly timeseriesfingerprint_algorithm: (a: number, b: number) => void;
    readonly timeseriesfingerprint_digest: (a: number, b: number) => void;
    readonly timeseriesfingerprint_row_count: (a: number) => number;
    readonly timeseriesverification_equivalent: (a: number) => number;
    readonly timeseriesverification_left_fingerprint: (a: number, b: number) => void;
    readonly timeseriesverification_left_row_count: (a: number) => number;
    readonly timeseriesverification_mismatch_reason: (a: number, b: number) => void;
    readonly timeseriesverification_right_fingerprint: (a: number, b: number) => void;
    readonly timeseriesverification_right_row_count: (a: number) => number;
    readonly verify_time_series_arrow: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number) => void;
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
