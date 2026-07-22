use wasm_bindgen::prelude::*;

#[must_use]
pub const fn engine_name() -> &'static str {
    lens_core::ENGINE_NAME
}

/// Decode a `ClickHouse` Arrow IPC stream and return its total row count.
/// JavaScript will call this function with a `Uint8Array`. The generated
/// wasm-bindgen glue copies those bytes into WebAssembly linear memory and
/// passes Rust a borrowed byte slice:
///
/// JavaScript `Uint8Array` -> WASM memory -> `&[u8]`
/// The returned `u32` becomes a normal JavaScript number.
///
/// # Errors
///
/// Returns a JavaScript error value when the bytes are not a valid yearly-price
/// Arrow stream or when the row count cannot fit inside a `u32`.
#[wasm_bindgen]
pub fn yearly_price_row_count(bytes: &[u8]) -> Result<u32, JsValue> {
    let batches = lens_core::arrow_stream::decode_yearly_price_stream(bytes)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    let row_count = batches.iter().try_fold(0_u32, |total, batch| {
        let batch_length = u32::try_from(batch.len())
            .map_err(|_| JsValue::from_str("Arrow batch length does not fit inside u32"))?;

        total
            .checked_add(batch_length)
            .ok_or_else(|| JsValue::from_str("Arrow stream row count exceeds u32"))
    })?;

    Ok(row_count)
}

#[cfg(test)]
mod tests {
    use super::{engine_name, yearly_price_row_count};

    const CLICKHOUSE_STREAM: &[u8] =
        include_bytes!("../../lens-core/tests/fixtures/manchester-yearly.arrow");

    #[test]
    fn links_the_shared_engine() {
        assert_eq!(engine_name(), "lens-core");
    }

    #[test]
    fn counts_rows_through_the_wasm_boundary_function() {
        let row_count =
            yearly_price_row_count(CLICKHOUSE_STREAM).expect("ClickHouse fixture should decode");

        assert_eq!(row_count, 9);
    }
}
