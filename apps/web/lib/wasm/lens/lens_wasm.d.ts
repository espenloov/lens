/* tslint:disable */
/* eslint-disable */

/**
 * Decode a `ClickHouse` Arrow IPC stream and return its total row count.
 * JavaScript will call this function with a `Uint8Array`. The generated
 * wasm-bindgen glue copies those bytes into WebAssembly linear memory and
 * passes Rust a borrowed byte slice:
 *
 * JavaScript `Uint8Array` -> WASM memory -> `&[u8]`
 * The returned `u32` becomes a normal JavaScript number.
 *
 * # Errors
 *
 * Returns a JavaScript error value when the bytes are not a valid yearly-price
 * Arrow stream or when the row count cannot fit inside a `u32`.
 */
export function yearly_price_row_count(bytes: Uint8Array): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly yearly_price_row_count: (a: number, b: number, c: number) => void;
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
