use std::{
    collections::{HashMap, HashSet},
    io::Cursor,
};

use arrow_array::{Array, Date32Array, Float64Array, RecordBatch, StringArray, UInt64Array};
use arrow_ipc::reader::StreamReader;
use arrow_schema::{ArrowError, DataType, Schema};
use thiserror::Error;

#[derive(Debug, Clone)]
pub struct TimeSeriesBatch {
    period_starts: Date32Array,
    series: StringArray,
    values: Float64Array,
    observation_counts: UInt64Array,
}

impl TimeSeriesBatch {
    #[must_use]
    pub fn len(&self) -> usize {
        self.period_starts.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.period_starts.is_empty()
    }

    #[must_use]
    pub fn period_starts(&self) -> &[i32] {
        self.period_starts.values().as_ref()
    }

    #[must_use]
    pub const fn series(&self) -> &StringArray {
        &self.series
    }

    #[must_use]
    pub fn values(&self) -> &[f64] {
        self.values.values().as_ref()
    }

    #[must_use]
    pub fn observation_counts(&self) -> &[u64] {
        self.observation_counts.values().as_ref()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TimeSeriesAnalysis {
    row_count: usize,
    series_count: usize,
    minimum_value: Option<f64>,
    maximum_value: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TimeSeriesData {
    period_starts: Vec<i32>,
    series_indexes: Vec<u32>,
    values: Vec<f64>,
    observation_counts: Vec<u64>,
    series_names: Vec<String>,
}

impl TimeSeriesData {
    #[must_use]
    pub fn len(&self) -> usize {
        self.period_starts.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.period_starts.is_empty()
    }

    #[must_use]
    pub fn period_starts(&self) -> &[i32] {
        &self.period_starts
    }

    #[must_use]
    pub fn series_indexes(&self) -> &[u32] {
        &self.series_indexes
    }

    #[must_use]
    pub fn values(&self) -> &[f64] {
        &self.values
    }

    #[must_use]
    pub fn observation_counts(&self) -> &[u64] {
        &self.observation_counts
    }

    #[must_use]
    pub fn series_names(&self) -> &[String] {
        &self.series_names
    }
}

impl TimeSeriesAnalysis {
    #[must_use]
    pub const fn row_count(&self) -> usize {
        self.row_count
    }

    #[must_use]
    pub const fn series_count(&self) -> usize {
        self.series_count
    }

    #[must_use]
    pub const fn minimum_value(&self) -> Option<f64> {
        self.minimum_value
    }

    #[must_use]
    pub const fn maximum_value(&self) -> Option<f64> {
        self.maximum_value
    }
}

#[derive(Debug, Error)]
pub enum TimeSeriesArrowError {
    #[error("could not decode the Arrow IPC stream: {0}")]
    Ipc(#[from] ArrowError),

    #[error("Arrow column `{name}` is missing")]
    MissingColumn { name: &'static str },

    #[error("Arrow column `{name}` has type {actual:?}; expected {expected:?}")]
    UnexpectedColumnType {
        name: &'static str,
        expected: DataType,
        actual: DataType,
    },

    #[error("Arrow column `{name}` contains {null_count} null values")]
    NullValues {
        name: &'static str,
        null_count: usize,
    },

    #[error("Arrow column `value` contains a non-finite value at index {index}")]
    NonFiniteValue { index: usize },

    #[error("Arrow stream contains {actual} columns; expected exactly {expected}")]
    UnexpectedColumnCount { expected: usize, actual: usize },

    #[error("the time-series stream contains more than u32::MAX distinct series")]
    TooManySeries,
}

fn validate_schema(schema: &Schema) -> Result<(), TimeSeriesArrowError> {
    const EXPECTED_COLUMN_COUNT: usize = 4;

    if schema.fields().len() != EXPECTED_COLUMN_COUNT {
        return Err(TimeSeriesArrowError::UnexpectedColumnCount {
            expected: EXPECTED_COLUMN_COUNT,
            actual: schema.fields().len(),
        });
    }

    Ok(())
}

fn typed_column<'a, T>(
    batch: &'a RecordBatch,
    name: &'static str,
    expected: DataType,
) -> Result<&'a T, TimeSeriesArrowError>
where
    T: 'static,
{
    let column = batch
        .column_by_name(name)
        .ok_or(TimeSeriesArrowError::MissingColumn { name })?;

    column
        .as_any()
        .downcast_ref::<T>()
        .ok_or_else(|| TimeSeriesArrowError::UnexpectedColumnType {
            name,
            expected,
            actual: column.data_type().clone(),
        })
}

fn require_no_nulls(column: &dyn Array, name: &'static str) -> Result<(), TimeSeriesArrowError> {
    let null_count = column.null_count();

    if null_count > 0 {
        return Err(TimeSeriesArrowError::NullValues { name, null_count });
    }

    Ok(())
}

fn decode_batch(batch: &RecordBatch) -> Result<TimeSeriesBatch, TimeSeriesArrowError> {
    let period_starts =
        typed_column::<Date32Array>(batch, "period_start", DataType::Date32)?.clone();
    let series = typed_column::<StringArray>(batch, "series", DataType::Utf8)?.clone();
    let values = typed_column::<Float64Array>(batch, "value", DataType::Float64)?.clone();
    let observation_counts =
        typed_column::<UInt64Array>(batch, "observation_count", DataType::UInt64)?.clone();

    require_no_nulls(&period_starts, "period_start")?;
    require_no_nulls(&series, "series")?;
    require_no_nulls(&values, "value")?;
    require_no_nulls(&observation_counts, "observation_count")?;

    if let Some(index) = values.values().iter().position(|value| !value.is_finite()) {
        return Err(TimeSeriesArrowError::NonFiniteValue { index });
    }

    Ok(TimeSeriesBatch {
        period_starts,
        series,
        values,
        observation_counts,
    })
}

/// Decodes generic time-series batches from an Arrow IPC stream.
///
/// # Errors
///
/// Returns [`TimeSeriesArrowError`] when the IPC bytes or physical schema do
/// not satisfy the time-series contract.
pub fn decode_time_series_stream(
    bytes: &[u8],
) -> Result<Vec<TimeSeriesBatch>, TimeSeriesArrowError> {
    let reader = StreamReader::try_new(Cursor::new(bytes), None)?;
    validate_schema(reader.schema().as_ref())?;
    let mut batches = Vec::new();

    for batch in reader {
        batches.push(decode_batch(&batch?)?);
    }

    Ok(batches)
}

#[must_use]
pub fn analyze_time_series(batches: &[TimeSeriesBatch]) -> TimeSeriesAnalysis {
    let mut series = HashSet::new();
    let mut row_count = 0;
    let mut minimum_value = None::<f64>;
    let mut maximum_value = None::<f64>;

    for batch in batches {
        row_count += batch.len();

        for index in 0..batch.len() {
            series.insert(batch.series.value(index));

            let value = batch.values.value(index);
            minimum_value = Some(minimum_value.map_or(value, |current| current.min(value)));
            maximum_value = Some(maximum_value.map_or(value, |current| current.max(value)));
        }
    }

    TimeSeriesAnalysis {
        row_count,
        series_count: series.len(),
        minimum_value,
        maximum_value,
    }
}

/// Collects decoded Arrow batches into contiguous, browser-friendly columns.
///
/// # Errors
///
/// Returns [`TimeSeriesArrowError::TooManySeries`] when the number of distinct
/// series cannot be represented by the `u32` dictionary index column.
pub fn collect_time_series(
    batches: &[TimeSeriesBatch],
) -> Result<TimeSeriesData, TimeSeriesArrowError> {
    let row_count = batches.iter().map(TimeSeriesBatch::len).sum();
    let mut period_starts = Vec::with_capacity(row_count);
    let mut series_indexes = Vec::with_capacity(row_count);
    let mut values = Vec::with_capacity(row_count);
    let mut observation_counts = Vec::with_capacity(row_count);
    let mut series_names = Vec::<String>::new();
    let mut series_lookup = HashMap::<String, u32>::new();

    for batch in batches {
        for index in 0..batch.len() {
            let series_name = batch.series().value(index);
            let series_index = if let Some(existing) = series_lookup.get(series_name) {
                *existing
            } else {
                let next = u32::try_from(series_names.len())
                    .map_err(|_| TimeSeriesArrowError::TooManySeries)?;
                let owned = series_name.to_owned();
                series_names.push(owned.clone());
                series_lookup.insert(owned, next);
                next
            };

            period_starts.push(batch.period_starts()[index]);
            series_indexes.push(series_index);
            values.push(batch.values()[index]);
            observation_counts.push(batch.observation_counts()[index]);
        }
    }

    Ok(TimeSeriesData {
        period_starts,
        series_indexes,
        values,
        observation_counts,
        series_names,
    })
}

#[cfg(test)]
mod tests {
    use super::{analyze_time_series, collect_time_series, decode_time_series_stream};

    const MANCHESTER_YEARLY: &[u8] =
        include_bytes!("../tests/fixtures/manchester-yearly-generic.arrow");
    const LEEDS_BRISTOL_MONTHLY: &[u8] =
        include_bytes!("../tests/fixtures/leeds-bristol-monthly-volume.arrow");
    const OLD_SCHEMA: &[u8] = include_bytes!("../tests/fixtures/manchester-yearly.arrow");

    #[test]
    fn decodes_yearly_average_prices_from_clickhouse() {
        let batches = decode_time_series_stream(MANCHESTER_YEARLY)
            .expect("ClickHouse fixture should satisfy the time-series contract");
        let analysis = analyze_time_series(&batches);

        assert_eq!(analysis.row_count(), 9);
        assert_eq!(analysis.series_count(), 1);
        assert!(analysis.minimum_value().is_some());
        assert!(analysis.maximum_value().is_some());
        assert!(batches.iter().all(|batch| {
            (0..batch.len()).all(|index| batch.series().value(index) == "MANCHESTER")
        }));
    }

    #[test]
    fn decodes_monthly_multi_series_volume_from_clickhouse() {
        let batches = decode_time_series_stream(LEEDS_BRISTOL_MONTHLY)
            .expect("ClickHouse fixture should satisfy the time-series contract");
        let analysis = analyze_time_series(&batches);

        assert_eq!(analysis.row_count(), 96);
        assert_eq!(analysis.series_count(), 2);
        assert!(batches.iter().all(|batch| {
            batch
                .values()
                .iter()
                .zip(batch.observation_counts())
                .all(|(value, count)| {
                    u32::try_from(*count)
                        .is_ok_and(|count| (*value - f64::from(count)).abs() < f64::EPSILON)
                })
        }));
    }

    #[test]
    fn collects_arrow_batches_into_typed_columns() {
        let batches = decode_time_series_stream(LEEDS_BRISTOL_MONTHLY)
            .expect("ClickHouse fixture should satisfy the time-series contract");
        let data = collect_time_series(&batches).expect("fixture series should fit inside u32");

        assert_eq!(data.len(), 96);
        assert_eq!(data.period_starts().len(), data.len());
        assert_eq!(data.series_indexes().len(), data.len());
        assert_eq!(data.values().len(), data.len());
        assert_eq!(data.observation_counts().len(), data.len());
        assert_eq!(data.series_names(), ["BRISTOL", "LEEDS"]);
        assert!(data.series_indexes().iter().all(|index| *index < 2));
    }

    #[test]
    fn rejects_the_previous_specialized_schema() {
        let result = decode_time_series_stream(OLD_SCHEMA);

        assert!(result.is_err());
    }

    #[test]
    fn rejects_non_arrow_bytes() {
        let result = decode_time_series_stream(b"this is not Arrow");

        assert!(result.is_err());
    }
}
