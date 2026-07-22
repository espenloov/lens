use wasm_bindgen::prelude::*;

#[must_use]
pub const fn engine_name() -> &'static str {
    lens_core::ENGINE_NAME
}

#[wasm_bindgen]
pub struct TimeSeriesData {
    period_starts: Vec<i32>,
    series_indexes: Vec<u32>,
    values: Vec<f64>,
    observation_counts: Vec<u64>,
    series_names: Vec<String>,
}

#[wasm_bindgen]
impl TimeSeriesData {
    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn row_count(&self) -> u32 {
        u32::try_from(self.period_starts.len()).unwrap_or(u32::MAX)
    }

    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn series_count(&self) -> u32 {
        u32::try_from(self.series_names.len()).unwrap_or(u32::MAX)
    }

    #[must_use]
    pub fn period_starts(&self) -> Vec<i32> {
        self.period_starts.clone()
    }

    #[must_use]
    pub fn series_indexes(&self) -> Vec<u32> {
        self.series_indexes.clone()
    }

    #[must_use]
    pub fn values(&self) -> Vec<f64> {
        self.values.clone()
    }

    #[must_use]
    pub fn observation_counts(&self) -> Vec<u64> {
        self.observation_counts.clone()
    }

    #[must_use]
    pub fn series_name(&self, index: u32) -> Option<String> {
        usize::try_from(index)
            .ok()
            .and_then(|index| self.series_names.get(index))
            .cloned()
    }
}

fn count_to_u32(value: usize, name: &str) -> Result<u32, JsValue> {
    u32::try_from(value).map_err(|_| JsValue::from_str(&format!("{name} exceeds u32")))
}

/// Decodes a generic time-series Arrow IPC stream into typed columns.
///
/// # Errors
///
/// Returns a JavaScript error value when the bytes violate the time-series
/// schema or a row count cannot fit inside a `u32`.
#[wasm_bindgen]
pub fn decode_time_series_arrow(bytes: &[u8]) -> Result<TimeSeriesData, JsValue> {
    let batches = lens_core::arrow_stream::decode_time_series_stream(bytes)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let data = lens_core::arrow_stream::collect_time_series(&batches)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    count_to_u32(data.len(), "row count")?;
    count_to_u32(data.series_names().len(), "series count")?;

    Ok(TimeSeriesData {
        period_starts: data.period_starts().to_vec(),
        series_indexes: data.series_indexes().to_vec(),
        values: data.values().to_vec(),
        observation_counts: data.observation_counts().to_vec(),
        series_names: data.series_names().to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use super::{decode_time_series_arrow, engine_name};

    const MANCHESTER_YEARLY: &[u8] =
        include_bytes!("../../lens-core/tests/fixtures/manchester-yearly-generic.arrow");
    const LEEDS_BRISTOL_MONTHLY: &[u8] =
        include_bytes!("../../lens-core/tests/fixtures/leeds-bristol-monthly-volume.arrow");

    #[test]
    fn links_the_shared_engine() {
        assert_eq!(engine_name(), "lens-core");
    }

    #[test]
    fn exposes_yearly_price_columns_through_the_wasm_boundary() {
        let data =
            decode_time_series_arrow(MANCHESTER_YEARLY).expect("ClickHouse fixture should decode");

        assert_eq!(data.row_count(), 9);
        assert_eq!(data.series_count(), 1);
        assert_eq!(data.period_starts().len(), 9);
        assert_eq!(data.values().len(), 9);
        assert_eq!(data.series_name(0).as_deref(), Some("MANCHESTER"));
    }

    #[test]
    fn exposes_multi_series_columns_through_the_wasm_boundary() {
        let data = decode_time_series_arrow(LEEDS_BRISTOL_MONTHLY)
            .expect("ClickHouse fixture should decode");

        assert_eq!(data.row_count(), 96);
        assert_eq!(data.series_count(), 2);
        assert_eq!(data.series_indexes().len(), 96);
        assert_eq!(data.observation_counts().len(), 96);
    }
}
