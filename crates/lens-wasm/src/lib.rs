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
pub struct TimeSeriesVerification {
    equivalent: bool,
    left_fingerprint: String,
    right_fingerprint: String,
    left_row_count: u32,
    right_row_count: u32,
    mismatch_reason: Option<String>,
}

#[wasm_bindgen]
pub struct TimeSeriesFingerprint {
    algorithm: String,
    digest: String,
    row_count: u32,
}

#[wasm_bindgen]
impl TimeSeriesFingerprint {
    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn algorithm(&self) -> String {
        self.algorithm.clone()
    }

    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn digest(&self) -> String {
        self.digest.clone()
    }

    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn row_count(&self) -> u32 {
        self.row_count
    }
}

#[wasm_bindgen]
impl TimeSeriesVerification {
    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn equivalent(&self) -> bool {
        self.equivalent
    }

    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn left_fingerprint(&self) -> String {
        self.left_fingerprint.clone()
    }

    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn right_fingerprint(&self) -> String {
        self.right_fingerprint.clone()
    }

    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn left_row_count(&self) -> u32 {
        self.left_row_count
    }

    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn right_row_count(&self) -> u32 {
        self.right_row_count
    }

    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn mismatch_reason(&self) -> Option<String> {
        self.mismatch_reason.clone()
    }
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

/// Creates a stable fingerprint for one Arrow IPC time-series stream.
///
/// # Errors
///
/// Returns a JavaScript error value when the stream violates the time-series
/// schema, contains invalid values, or its row count cannot fit inside a `u32`.
#[wasm_bindgen]
pub fn fingerprint_time_series_arrow(bytes: &[u8]) -> Result<TimeSeriesFingerprint, JsValue> {
    let fingerprint = lens_core::verification::fingerprint_time_series_stream(bytes)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let row_count = count_to_u32(fingerprint.row_count(), "row count")?;

    Ok(TimeSeriesFingerprint {
        algorithm: lens_core::verification::TIME_SERIES_FINGERPRINT_ALGORITHM.to_owned(),
        digest: fingerprint.digest().to_owned(),
        row_count,
    })
}

/// Verifies that two Arrow IPC streams contain the same time-series rows.
///
/// # Errors
///
/// Returns a JavaScript error value when either stream violates the time-series
/// schema, contains invalid values, or a row count cannot fit inside a `u32`.
#[wasm_bindgen]
pub fn verify_time_series_arrow(
    left: &[u8],
    right: &[u8],
) -> Result<TimeSeriesVerification, JsValue> {
    let verification = lens_core::verification::verify_time_series_streams(left, right)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let left_row_count = count_to_u32(verification.left().row_count(), "left row count")?;
    let right_row_count = count_to_u32(verification.right().row_count(), "right row count")?;

    Ok(TimeSeriesVerification {
        equivalent: verification.equivalent(),
        left_fingerprint: verification.left().digest().to_owned(),
        right_fingerprint: verification.right().digest().to_owned(),
        left_row_count,
        right_row_count,
        mismatch_reason: verification.mismatch_reason().map(str::to_owned),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        decode_time_series_arrow, engine_name, fingerprint_time_series_arrow,
        verify_time_series_arrow,
    };

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

    #[test]
    fn exposes_exact_verification_through_the_wasm_boundary() {
        let verification = verify_time_series_arrow(MANCHESTER_YEARLY, MANCHESTER_YEARLY)
            .expect("identical ClickHouse fixtures should verify");

        assert!(verification.equivalent());
        assert_eq!(verification.left_row_count(), 9);
        assert_eq!(verification.right_row_count(), 9);
        assert_eq!(
            verification.left_fingerprint(),
            verification.right_fingerprint()
        );
        assert_eq!(verification.mismatch_reason(), None);
    }

    #[test]
    fn exposes_a_single_stream_fingerprint_through_the_wasm_boundary() {
        let fingerprint = fingerprint_time_series_arrow(MANCHESTER_YEARLY)
            .expect("ClickHouse fixture should fingerprint");

        assert_eq!(fingerprint.algorithm(), "sha256-v1");
        assert_eq!(fingerprint.row_count(), 9);
        assert_eq!(fingerprint.digest().len(), 64);
    }

    #[test]
    fn exposes_mismatches_through_the_wasm_boundary() {
        let verification = verify_time_series_arrow(MANCHESTER_YEARLY, LEEDS_BRISTOL_MONTHLY)
            .expect("both ClickHouse fixtures should decode");

        assert!(!verification.equivalent());
        assert_eq!(verification.left_row_count(), 9);
        assert_eq!(verification.right_row_count(), 96);
        assert_eq!(verification.mismatch_reason().as_deref(), Some("row_count"));
    }
}
