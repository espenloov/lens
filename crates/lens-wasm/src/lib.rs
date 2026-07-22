use wasm_bindgen::prelude::*;

#[must_use]
pub const fn engine_name() -> &'static str {
    lens_core::ENGINE_NAME
}

#[wasm_bindgen]
pub struct TimeSeriesAnalysis {
    row_count: u32,
    series_count: u32,
    minimum_value: Option<f64>,
    maximum_value: Option<f64>,
}

#[wasm_bindgen]
impl TimeSeriesAnalysis {
    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn row_count(&self) -> u32 {
        self.row_count
    }

    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn series_count(&self) -> u32 {
        self.series_count
    }

    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn minimum_value(&self) -> Option<f64> {
        self.minimum_value
    }

    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn maximum_value(&self) -> Option<f64> {
        self.maximum_value
    }
}

fn count_to_u32(value: usize, name: &str) -> Result<u32, JsValue> {
    u32::try_from(value).map_err(|_| JsValue::from_str(&format!("{name} exceeds u32")))
}

/// Decodes and analyzes a generic time-series Arrow IPC stream.
///
/// # Errors
///
/// Returns a JavaScript error value when the bytes violate the time-series
/// schema or an analysis count cannot fit inside a `u32`.
#[wasm_bindgen]
pub fn analyze_time_series_arrow(bytes: &[u8]) -> Result<TimeSeriesAnalysis, JsValue> {
    let batches = lens_core::arrow_stream::decode_time_series_stream(bytes)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let analysis = lens_core::arrow_stream::analyze_time_series(&batches);

    Ok(TimeSeriesAnalysis {
        row_count: count_to_u32(analysis.row_count(), "row count")?,
        series_count: count_to_u32(analysis.series_count(), "series count")?,
        minimum_value: analysis.minimum_value(),
        maximum_value: analysis.maximum_value(),
    })
}

#[cfg(test)]
mod tests {
    use super::{analyze_time_series_arrow, engine_name};

    const MANCHESTER_YEARLY: &[u8] =
        include_bytes!("../../lens-core/tests/fixtures/manchester-yearly-generic.arrow");
    const LEEDS_BRISTOL_MONTHLY: &[u8] =
        include_bytes!("../../lens-core/tests/fixtures/leeds-bristol-monthly-volume.arrow");

    #[test]
    fn links_the_shared_engine() {
        assert_eq!(engine_name(), "lens-core");
    }

    #[test]
    fn analyzes_yearly_prices_through_the_wasm_boundary() {
        let analysis =
            analyze_time_series_arrow(MANCHESTER_YEARLY).expect("ClickHouse fixture should decode");

        assert_eq!(analysis.row_count(), 9);
        assert_eq!(analysis.series_count(), 1);
        assert!(analysis.minimum_value().is_some());
        assert!(analysis.maximum_value().is_some());
    }

    #[test]
    fn analyzes_monthly_multi_series_through_the_wasm_boundary() {
        let analysis = analyze_time_series_arrow(LEEDS_BRISTOL_MONTHLY)
            .expect("ClickHouse fixture should decode");

        assert_eq!(analysis.row_count(), 96);
        assert_eq!(analysis.series_count(), 2);
    }
}
