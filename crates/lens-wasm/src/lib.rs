use wasm_bindgen::prelude::*;

use lens_core::analytics::Interval;

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
pub struct CategoryData {
    categories: Vec<String>,
    values: Vec<f64>,
    observation_counts: Vec<u64>,
}

#[wasm_bindgen]
pub struct HistogramData {
    bin_starts: Vec<f64>,
    bin_ends: Vec<f64>,
    series_indexes: Vec<u32>,
    series_names: Vec<String>,
    values: Vec<f64>,
    observation_counts: Vec<u64>,
}

#[wasm_bindgen]
pub struct MatrixData {
    x_indexes: Vec<u32>,
    x_labels: Vec<String>,
    y_indexes: Vec<u32>,
    y_labels: Vec<String>,
    values: Vec<f64>,
    observation_counts: Vec<u64>,
}

#[wasm_bindgen]
pub struct DerivedValues {
    values: Vec<f64>,
    validity: Vec<u8>,
}

#[wasm_bindgen]
pub struct AnomalyValues {
    expected: Vec<f64>,
    scores: Vec<f64>,
    validity: Vec<u8>,
    flags: Vec<u8>,
}

#[wasm_bindgen]
pub struct ExplorationWorkspace {
    inner: lens_core::exploration::ExplorationWorkspace,
}

#[wasm_bindgen]
pub struct ExplorationWindow {
    inner: lens_core::exploration::ExplorationWindow,
}

#[wasm_bindgen]
pub struct ExplorationDensityFrame {
    density_counts: Vec<u32>,
    daily_quartiles: Vec<f64>,
}

#[wasm_bindgen]
impl ExplorationDensityFrame {
    #[must_use]
    pub fn density_counts(&self) -> Vec<u32> {
        self.density_counts.clone()
    }

    #[must_use]
    pub fn daily_quartiles(&self) -> Vec<f64> {
        self.daily_quartiles.clone()
    }
}

#[wasm_bindgen]
impl ExplorationWindow {
    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn total_count(&self) -> u32 {
        self.inner.total_count()
    }

    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn average_value(&self) -> f64 {
        self.inner.average_value()
    }

    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn q1(&self) -> f64 {
        self.inner.q1()
    }

    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn median(&self) -> f64 {
        self.inner.median()
    }

    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn q3(&self) -> f64 {
        self.inner.q3()
    }

    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn estimated_outlier_count(&self) -> u32 {
        self.inner.estimated_outlier_count()
    }

    #[must_use]
    pub fn histogram_counts(&self) -> Vec<u32> {
        self.inner.histogram_counts().to_vec()
    }

    #[must_use]
    pub fn dimension_counts(&self, dimension: u32) -> Vec<u32> {
        usize::try_from(dimension)
            .ok()
            .and_then(|index| self.inner.dimension_counts(index))
            .map_or_else(Vec::new, <[u32]>::to_vec)
    }
}

#[wasm_bindgen]
impl ExplorationWorkspace {
    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn row_count(&self) -> u32 {
        u32::try_from(self.inner.row_count()).unwrap_or(u32::MAX)
    }

    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn day_count(&self) -> u32 {
        u32::try_from(self.inner.day_count()).unwrap_or(u32::MAX)
    }

    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn bin_count(&self) -> u32 {
        u32::try_from(self.inner.bin_count()).unwrap_or(u32::MAX)
    }

    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn index_bytes(&self) -> u32 {
        u32::try_from(self.inner.index_bytes()).unwrap_or(u32::MAX)
    }

    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn bucket_minimum(&self) -> f64 {
        self.inner.bucket_minimum()
    }

    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn bucket_width(&self) -> f64 {
        self.inner.bucket_width()
    }

    /// Returns the time-by-value density for the selected category codes.
    ///
    /// # Errors
    ///
    /// Returns a JavaScript error when a filter code is outside its codebook.
    pub fn density_counts(
        &self,
        dimension_0: i16,
        dimension_1: i16,
        dimension_2: i16,
    ) -> Result<Vec<u32>, JsValue> {
        self.inner
            .density_counts([dimension_0, dimension_1, dimension_2])
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    /// Returns estimated daily quartiles for the selected category codes.
    ///
    /// # Errors
    ///
    /// Returns a JavaScript error when a filter code is outside its codebook.
    pub fn daily_quartiles(
        &self,
        dimension_0: i16,
        dimension_1: i16,
        dimension_2: i16,
    ) -> Result<Vec<f64>, JsValue> {
        self.inner
            .daily_quartiles([dimension_0, dimension_1, dimension_2])
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    /// Returns density counts and estimated daily quartiles with one density pass.
    ///
    /// # Errors
    ///
    /// Returns a JavaScript error when a filter code is outside its codebook.
    pub fn density_frame(
        &self,
        dimension_0: i16,
        dimension_1: i16,
        dimension_2: i16,
    ) -> Result<ExplorationDensityFrame, JsValue> {
        let (density_counts, daily_quartiles) = self
            .inner
            .density_frame([dimension_0, dimension_1, dimension_2])
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        Ok(ExplorationDensityFrame {
            density_counts,
            daily_quartiles,
        })
    }

    /// Summarizes one inclusive local time window.
    ///
    /// # Errors
    ///
    /// Returns a JavaScript error when the window or filter codes are invalid.
    pub fn summarize(
        &self,
        start: u32,
        end: u32,
        dimension_0: i16,
        dimension_1: i16,
        dimension_2: i16,
    ) -> Result<ExplorationWindow, JsValue> {
        let start =
            usize::try_from(start).map_err(|_| JsValue::from_str("start index exceeds usize"))?;
        let end = usize::try_from(end).map_err(|_| JsValue::from_str("end index exceeds usize"))?;
        let inner = self
            .inner
            .summarize(start, end, [dimension_0, dimension_1, dimension_2])
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        Ok(ExplorationWindow { inner })
    }
}

/// Builds a persistent Rust exploration workspace from an `exploration/v1` Arrow stream.
///
/// # Errors
///
/// Returns a JavaScript error when the stream or bounded workspace configuration is invalid.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn build_exploration_workspace(
    bytes: &[u8],
    day_count: u32,
    bin_count: u32,
    bucket_minimum: f64,
    bucket_width: f64,
    cardinality_0: u8,
    cardinality_1: u8,
    cardinality_2: u8,
) -> Result<ExplorationWorkspace, JsValue> {
    let day_count =
        usize::try_from(day_count).map_err(|_| JsValue::from_str("day count exceeds usize"))?;
    let bin_count =
        usize::try_from(bin_count).map_err(|_| JsValue::from_str("bin count exceeds usize"))?;
    let inner = lens_core::exploration::build_workspace(
        bytes,
        day_count,
        bin_count,
        bucket_minimum,
        bucket_width,
        [
            usize::from(cardinality_0),
            usize::from(cardinality_1),
            usize::from(cardinality_2),
        ],
    )
    .map_err(|error| JsValue::from_str(&error.to_string()))?;
    Ok(ExplorationWorkspace { inner })
}

#[wasm_bindgen]
impl CategoryData {
    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn row_count(&self) -> u32 {
        u32::try_from(self.values.len()).unwrap_or(u32::MAX)
    }

    #[must_use]
    pub fn category(&self, index: u32) -> Option<String> {
        usize::try_from(index)
            .ok()
            .and_then(|index| self.categories.get(index))
            .cloned()
    }

    #[must_use]
    pub fn values(&self) -> Vec<f64> {
        self.values.clone()
    }

    #[must_use]
    pub fn observation_counts(&self) -> Vec<u64> {
        self.observation_counts.clone()
    }
}

#[wasm_bindgen]
impl HistogramData {
    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn row_count(&self) -> u32 {
        u32::try_from(self.values.len()).unwrap_or(u32::MAX)
    }

    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn series_count(&self) -> u32 {
        u32::try_from(self.series_names.len()).unwrap_or(u32::MAX)
    }

    #[must_use]
    pub fn bin_starts(&self) -> Vec<f64> {
        self.bin_starts.clone()
    }

    #[must_use]
    pub fn bin_ends(&self) -> Vec<f64> {
        self.bin_ends.clone()
    }

    #[must_use]
    pub fn series_indexes(&self) -> Vec<u32> {
        self.series_indexes.clone()
    }

    #[must_use]
    pub fn series_name(&self, index: u32) -> Option<String> {
        usize::try_from(index)
            .ok()
            .and_then(|index| self.series_names.get(index))
            .cloned()
    }

    #[must_use]
    pub fn values(&self) -> Vec<f64> {
        self.values.clone()
    }

    #[must_use]
    pub fn observation_counts(&self) -> Vec<u64> {
        self.observation_counts.clone()
    }
}

#[wasm_bindgen]
impl MatrixData {
    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn row_count(&self) -> u32 {
        u32::try_from(self.values.len()).unwrap_or(u32::MAX)
    }

    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn x_count(&self) -> u32 {
        u32::try_from(self.x_labels.len()).unwrap_or(u32::MAX)
    }

    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn y_count(&self) -> u32 {
        u32::try_from(self.y_labels.len()).unwrap_or(u32::MAX)
    }

    #[must_use]
    pub fn x_indexes(&self) -> Vec<u32> {
        self.x_indexes.clone()
    }

    #[must_use]
    pub fn x_label(&self, index: u32) -> Option<String> {
        usize::try_from(index)
            .ok()
            .and_then(|index| self.x_labels.get(index))
            .cloned()
    }

    #[must_use]
    pub fn y_indexes(&self) -> Vec<u32> {
        self.y_indexes.clone()
    }

    #[must_use]
    pub fn y_label(&self, index: u32) -> Option<String> {
        usize::try_from(index)
            .ok()
            .and_then(|index| self.y_labels.get(index))
            .cloned()
    }

    #[must_use]
    pub fn values(&self) -> Vec<f64> {
        self.values.clone()
    }

    #[must_use]
    pub fn observation_counts(&self) -> Vec<u64> {
        self.observation_counts.clone()
    }
}

#[wasm_bindgen]
impl DerivedValues {
    #[must_use]
    pub fn values(&self) -> Vec<f64> {
        self.values.clone()
    }

    #[must_use]
    pub fn validity(&self) -> Vec<u8> {
        self.validity.clone()
    }
}

#[wasm_bindgen]
impl AnomalyValues {
    #[must_use]
    pub fn expected(&self) -> Vec<f64> {
        self.expected.clone()
    }

    #[must_use]
    pub fn scores(&self) -> Vec<f64> {
        self.scores.clone()
    }

    #[must_use]
    pub fn validity(&self) -> Vec<u8> {
        self.validity.clone()
    }

    #[must_use]
    pub fn flags(&self) -> Vec<u8> {
        self.flags.clone()
    }
}

fn parse_interval(interval: &str) -> Result<Interval, JsValue> {
    match interval {
        "year" => Ok(Interval::Year),
        "quarter" => Ok(Interval::Quarter),
        "month" => Ok(Interval::Month),
        _ => Err(JsValue::from_str(
            "interval must be year, quarter, or month",
        )),
    }
}

/// Decodes a `categorical/v1` Arrow IPC stream.
///
/// # Errors
///
/// Returns a JavaScript error when the bytes violate the categorical contract.
#[wasm_bindgen]
pub fn decode_category_arrow(bytes: &[u8]) -> Result<CategoryData, JsValue> {
    let data = lens_core::analysis_frames::decode_category_stream(bytes)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    count_to_u32(data.values().len(), "row count")?;

    Ok(CategoryData {
        categories: data.categories().to_vec(),
        values: data.values().to_vec(),
        observation_counts: data.observation_counts().to_vec(),
    })
}

/// Decodes a `histogram/v1` Arrow IPC stream.
///
/// # Errors
///
/// Returns a JavaScript error when the bytes violate the histogram contract.
#[wasm_bindgen]
pub fn decode_histogram_arrow(bytes: &[u8]) -> Result<HistogramData, JsValue> {
    let data = lens_core::analysis_frames::decode_histogram_stream(bytes)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    count_to_u32(data.values().len(), "row count")?;
    count_to_u32(data.series_names().len(), "series count")?;

    Ok(HistogramData {
        bin_starts: data.bin_starts().to_vec(),
        bin_ends: data.bin_ends().to_vec(),
        series_indexes: data.series_indexes().to_vec(),
        series_names: data.series_names().to_vec(),
        values: data.values().to_vec(),
        observation_counts: data.observation_counts().to_vec(),
    })
}

/// Decodes a sparse `matrix/v1` Arrow IPC stream.
///
/// # Errors
///
/// Returns a JavaScript error when the bytes violate the matrix contract.
#[wasm_bindgen]
pub fn decode_matrix_arrow(bytes: &[u8]) -> Result<MatrixData, JsValue> {
    let data = lens_core::analysis_frames::decode_matrix_stream(bytes)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    count_to_u32(data.values().len(), "row count")?;
    count_to_u32(data.x_labels().len(), "x label count")?;
    count_to_u32(data.y_labels().len(), "y label count")?;

    Ok(MatrixData {
        x_indexes: data.x_indexes().to_vec(),
        x_labels: data.x_labels().to_vec(),
        y_indexes: data.y_indexes().to_vec(),
        y_labels: data.y_labels().to_vec(),
        values: data.values().to_vec(),
        observation_counts: data.observation_counts().to_vec(),
    })
}

/// Calculates adjacent period percentage changes over typed time-series columns.
///
/// # Errors
///
/// Returns a JavaScript error for invalid intervals, dates, or mismatched columns.
#[wasm_bindgen]
pub fn derive_period_changes(
    periods: &[i32],
    series_indexes: &[u32],
    values: &[f64],
    interval: &str,
) -> Result<DerivedValues, JsValue> {
    let result = lens_core::analytics::period_changes(
        periods,
        series_indexes,
        values,
        parse_interval(interval)?,
    )
    .map_err(|error| JsValue::from_str(&error.to_string()))?;

    Ok(DerivedValues {
        values: result.values().to_vec(),
        validity: result.validity().to_vec(),
    })
}

/// Calculates composition shares over typed time-series columns.
///
/// # Errors
///
/// Returns a JavaScript error when input columns have different lengths.
#[wasm_bindgen]
pub fn derive_composition_shares(
    periods: &[i32],
    values: &[f64],
) -> Result<DerivedValues, JsValue> {
    let result = lens_core::analytics::composition_shares(periods, values)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    Ok(DerivedValues {
        values: result.values().to_vec(),
        validity: result.validity().to_vec(),
    })
}

/// Calculates robust seasonal anomaly scores over typed time-series columns.
///
/// # Errors
///
/// Returns a JavaScript error for invalid intervals, dates, thresholds, or mismatched columns.
#[wasm_bindgen]
pub fn derive_anomaly_scores(
    periods: &[i32],
    series_indexes: &[u32],
    values: &[f64],
    observation_counts: &[u64],
    interval: &str,
    threshold: f64,
) -> Result<AnomalyValues, JsValue> {
    let result = lens_core::analytics::anomaly_scores(
        periods,
        series_indexes,
        values,
        observation_counts,
        parse_interval(interval)?,
        threshold,
    )
    .map_err(|error| JsValue::from_str(&error.to_string()))?;

    Ok(AnomalyValues {
        expected: result.expected().to_vec(),
        scores: result.scores().to_vec(),
        validity: result.validity().to_vec(),
        flags: result.flags().to_vec(),
    })
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
        decode_time_series_arrow, derive_anomaly_scores, derive_period_changes, engine_name,
        fingerprint_time_series_arrow, verify_time_series_arrow,
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
    fn exposes_derived_analytics_through_the_wasm_boundary() {
        let data =
            decode_time_series_arrow(MANCHESTER_YEARLY).expect("ClickHouse fixture should decode");
        let changes = derive_period_changes(
            &data.period_starts(),
            &data.series_indexes(),
            &data.values(),
            "year",
        )
        .expect("valid time series should derive changes");
        let anomalies = derive_anomaly_scores(
            &data.period_starts(),
            &data.series_indexes(),
            &data.values(),
            &data.observation_counts(),
            "year",
            3.5,
        )
        .expect("valid time series should derive anomaly scores");

        assert_eq!(
            changes
                .validity()
                .iter()
                .map(|valid| usize::from(*valid))
                .sum::<usize>(),
            8
        );
        assert_eq!(anomalies.validity().len(), data.row_count() as usize);
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
