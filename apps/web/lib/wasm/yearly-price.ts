"use client";

import { ResultAsync } from "neverthrow";

import initializeWasm, { yearly_price_row_count } from "./lens/lens_wasm";

export type YearlyPriceWasmError = {
  readonly kind: "yearly-price-wasm";
  readonly message: string;
  readonly cause: unknown;
};

let initialization: Promise<void> | undefined;

function initializeYearlyPriceWasm(): Promise<void> {
  if (!initialization) {
    initialization = initializeWasm()
      .then(() => undefined)
      .catch((cause: unknown) => {
        initialization = undefined;
        throw cause;
      });
  }

  return initialization;
}

function describeError(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }

  return String(cause);
}

export function countYearlyPriceRows(
  bytes: Uint8Array,
): ResultAsync<number, YearlyPriceWasmError> {
  return ResultAsync.fromPromise(
    initializeYearlyPriceWasm().then(() => yearly_price_row_count(bytes)),
    (cause): YearlyPriceWasmError => ({
      kind: "yearly-price-wasm",
      message: describeError(cause),
      cause,
    }),
  );
}
