/* tslint:disable */
/* eslint-disable */

export class TimeSeriesAnalysis {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly maximum_value: number | undefined;
    readonly minimum_value: number | undefined;
    readonly row_count: number;
    readonly series_count: number;
}

/**
 * Decodes and analyzes a generic time-series Arrow IPC stream.
 *
 * # Errors
 *
 * Returns a JavaScript error value when the bytes violate the time-series
 * schema or an analysis count cannot fit inside a `u32`.
 */
export function analyze_time_series_arrow(bytes: Uint8Array): TimeSeriesAnalysis;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_timeseriesanalysis_free: (a: number, b: number) => void;
    readonly analyze_time_series_arrow: (a: number, b: number, c: number) => void;
    readonly timeseriesanalysis_maximum_value: (a: number, b: number) => void;
    readonly timeseriesanalysis_minimum_value: (a: number, b: number) => void;
    readonly timeseriesanalysis_row_count: (a: number) => number;
    readonly timeseriesanalysis_series_count: (a: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number) => number;
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
