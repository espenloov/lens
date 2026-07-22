use std::cmp::Ordering;

use sha2::{Digest, Sha256};

use crate::arrow_stream::{TimeSeriesArrowError, TimeSeriesBatch, decode_time_series_stream};

const FINGERPRINT_DOMAIN: &[u8] = b"lens.time-series.result.v1\0";
pub const TIME_SERIES_FINGERPRINT_ALGORITHM: &str = "sha256-v1";

#[derive(Debug, Clone, PartialEq, Eq)]
struct CanonicalRow {
    period_start: i32,
    series: String,
    value_bits: u64,
    observation_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimeSeriesFingerprint {
    digest: String,
    row_count: usize,
}

impl TimeSeriesFingerprint {
    #[must_use]
    pub fn digest(&self) -> &str {
        &self.digest
    }

    #[must_use]
    pub const fn row_count(&self) -> usize {
        self.row_count
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimeSeriesVerification {
    equivalent: bool,
    left: TimeSeriesFingerprint,
    right: TimeSeriesFingerprint,
    mismatch_reason: Option<&'static str>,
}

impl TimeSeriesVerification {
    #[must_use]
    pub const fn equivalent(&self) -> bool {
        self.equivalent
    }

    #[must_use]
    pub const fn left(&self) -> &TimeSeriesFingerprint {
        &self.left
    }

    #[must_use]
    pub const fn right(&self) -> &TimeSeriesFingerprint {
        &self.right
    }

    #[must_use]
    pub const fn mismatch_reason(&self) -> Option<&'static str> {
        self.mismatch_reason
    }
}

fn normalized_float_bits(value: f64) -> u64 {
    if value == 0.0 { 0 } else { value.to_bits() }
}

fn compare_rows(left: &CanonicalRow, right: &CanonicalRow) -> Ordering {
    left.period_start
        .cmp(&right.period_start)
        .then_with(|| left.series.as_bytes().cmp(right.series.as_bytes()))
        .then_with(|| f64::from_bits(left.value_bits).total_cmp(&f64::from_bits(right.value_bits)))
        .then_with(|| left.observation_count.cmp(&right.observation_count))
}

fn canonical_rows(batches: &[TimeSeriesBatch]) -> Vec<CanonicalRow> {
    let row_count = batches.iter().map(TimeSeriesBatch::len).sum();
    let mut rows = Vec::with_capacity(row_count);

    for batch in batches {
        for index in 0..batch.len() {
            rows.push(CanonicalRow {
                period_start: batch.period_starts()[index],
                series: batch.series().value(index).to_owned(),
                value_bits: normalized_float_bits(batch.values()[index]),
                observation_count: batch.observation_counts()[index],
            });
        }
    }

    rows.sort_unstable_by(compare_rows);
    rows
}

fn update_length(hasher: &mut Sha256, length: usize) {
    let length = u64::try_from(length).unwrap_or(u64::MAX);
    hasher.update(length.to_be_bytes());
}

fn fingerprint_rows(rows: &[CanonicalRow]) -> TimeSeriesFingerprint {
    let mut hasher = Sha256::new();
    hasher.update(FINGERPRINT_DOMAIN);
    update_length(&mut hasher, rows.len());

    for row in rows {
        hasher.update(row.period_start.to_be_bytes());
        update_length(&mut hasher, row.series.len());
        hasher.update(row.series.as_bytes());
        hasher.update(row.value_bits.to_be_bytes());
        hasher.update(row.observation_count.to_be_bytes());
    }

    TimeSeriesFingerprint {
        digest: format!("{:x}", hasher.finalize()),
        row_count: rows.len(),
    }
}

/// Creates a stable fingerprint for decoded time-series data.
///
/// Rows are treated as an unordered multiset. Record-batch boundaries and row
/// order do not affect the digest, duplicate rows remain significant, finite
/// floating-point values compare by exact bits, and signed zero is normalized.
#[must_use]
pub fn fingerprint_time_series(batches: &[TimeSeriesBatch]) -> TimeSeriesFingerprint {
    fingerprint_rows(&canonical_rows(batches))
}

/// Decodes an Arrow IPC stream and creates its stable result fingerprint.
///
/// # Errors
///
/// Returns [`TimeSeriesArrowError`] when the stream violates the supported
/// time-series schema or contains invalid values.
pub fn fingerprint_time_series_stream(
    bytes: &[u8],
) -> Result<TimeSeriesFingerprint, TimeSeriesArrowError> {
    let batches = decode_time_series_stream(bytes)?;
    Ok(fingerprint_time_series(&batches))
}

/// Compares two decoded time-series results as unordered row multisets.
#[must_use]
pub fn verify_time_series(
    left_batches: &[TimeSeriesBatch],
    right_batches: &[TimeSeriesBatch],
) -> TimeSeriesVerification {
    let left_rows = canonical_rows(left_batches);
    let right_rows = canonical_rows(right_batches);
    let equivalent = left_rows == right_rows;
    let mismatch_reason = if equivalent {
        None
    } else if left_rows.len() != right_rows.len() {
        Some("row_count")
    } else {
        Some("row_value")
    };

    TimeSeriesVerification {
        equivalent,
        left: fingerprint_rows(&left_rows),
        right: fingerprint_rows(&right_rows),
        mismatch_reason,
    }
}

/// Decodes and compares two Arrow IPC time-series streams.
///
/// # Errors
///
/// Returns [`TimeSeriesArrowError`] when either stream violates the supported
/// time-series schema or contains invalid values.
pub fn verify_time_series_streams(
    left: &[u8],
    right: &[u8],
) -> Result<TimeSeriesVerification, TimeSeriesArrowError> {
    let left_batches = decode_time_series_stream(left)?;
    let right_batches = decode_time_series_stream(right)?;
    Ok(verify_time_series(&left_batches, &right_batches))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow_array::{
        BooleanArray, Date32Array, Float32Array, Float64Array, RecordBatch, StringArray,
        UInt64Array,
    };
    use arrow_ipc::writer::StreamWriter;
    use arrow_schema::{DataType, Field, Schema};

    use super::{fingerprint_time_series_stream, verify_time_series_streams};

    const MANCHESTER_YEARLY: &[u8] =
        include_bytes!("../tests/fixtures/manchester-yearly-generic.arrow");
    const LEEDS_BRISTOL_MONTHLY: &[u8] =
        include_bytes!("../tests/fixtures/leeds-bristol-monthly-volume.arrow");

    #[derive(Clone, Copy)]
    struct Row<'a> {
        period_start: i32,
        series: &'a str,
        value: f64,
        observation_count: u64,
    }

    fn schema() -> Arc<Schema> {
        Arc::new(Schema::new(vec![
            Field::new("period_start", DataType::Date32, false),
            Field::new("series", DataType::Utf8, false),
            Field::new("value", DataType::Float64, false),
            Field::new("observation_count", DataType::UInt64, false),
        ]))
    }

    fn batch(rows: &[Row<'_>]) -> RecordBatch {
        RecordBatch::try_new(
            schema(),
            vec![
                Arc::new(Date32Array::from(
                    rows.iter().map(|row| row.period_start).collect::<Vec<_>>(),
                )),
                Arc::new(StringArray::from(
                    rows.iter().map(|row| row.series).collect::<Vec<_>>(),
                )),
                Arc::new(Float64Array::from(
                    rows.iter().map(|row| row.value).collect::<Vec<_>>(),
                )),
                Arc::new(UInt64Array::from(
                    rows.iter()
                        .map(|row| row.observation_count)
                        .collect::<Vec<_>>(),
                )),
            ],
        )
        .expect("test batch should be valid")
    }

    fn stream(batches: &[RecordBatch]) -> Vec<u8> {
        let mut bytes = Vec::new();
        let mut writer = StreamWriter::try_new(&mut bytes, &schema())
            .expect("test stream writer should initialize");
        for batch in batches {
            writer.write(batch).expect("test batch should encode");
        }
        writer.finish().expect("test stream should finish");
        drop(writer);
        bytes
    }

    fn stream_with_float32_value() -> Vec<u8> {
        let invalid_schema = Arc::new(Schema::new(vec![
            Field::new("period_start", DataType::Date32, false),
            Field::new("series", DataType::Utf8, false),
            Field::new("value", DataType::Float32, false),
            Field::new("observation_count", DataType::UInt64, false),
        ]));
        let invalid_batch = RecordBatch::try_new(
            Arc::clone(&invalid_schema),
            vec![
                Arc::new(Date32Array::from(vec![19_723])),
                Arc::new(StringArray::from(vec!["MANCHESTER"])),
                Arc::new(Float32Array::from(vec![250_000.0])),
                Arc::new(UInt64Array::from(vec![30])),
            ],
        )
        .expect("test batch should be valid");
        let mut bytes = Vec::new();
        let mut writer = StreamWriter::try_new(&mut bytes, &invalid_schema)
            .expect("test stream writer should initialize");
        writer
            .write(&invalid_batch)
            .expect("test batch should encode");
        writer.finish().expect("test stream should finish");
        drop(writer);
        bytes
    }

    fn stream_with_extra_column() -> Vec<u8> {
        let invalid_schema = Arc::new(Schema::new(vec![
            Field::new("period_start", DataType::Date32, false),
            Field::new("series", DataType::Utf8, false),
            Field::new("value", DataType::Float64, false),
            Field::new("observation_count", DataType::UInt64, false),
            Field::new("ignored", DataType::Boolean, false),
        ]));
        let invalid_batch = RecordBatch::try_new(
            Arc::clone(&invalid_schema),
            vec![
                Arc::new(Date32Array::from(vec![19_723])),
                Arc::new(StringArray::from(vec!["MANCHESTER"])),
                Arc::new(Float64Array::from(vec![250_000.0])),
                Arc::new(UInt64Array::from(vec![30])),
                Arc::new(BooleanArray::from(vec![true])),
            ],
        )
        .expect("test batch should be valid");
        let mut bytes = Vec::new();
        let mut writer = StreamWriter::try_new(&mut bytes, &invalid_schema)
            .expect("test stream writer should initialize");
        writer
            .write(&invalid_batch)
            .expect("test batch should encode");
        writer.finish().expect("test stream should finish");
        drop(writer);
        bytes
    }

    #[test]
    fn fingerprints_a_real_clickhouse_stream_stably() {
        let fingerprint = fingerprint_time_series_stream(MANCHESTER_YEARLY)
            .expect("ClickHouse fixture should fingerprint");

        assert_eq!(fingerprint.row_count(), 9);
        assert_eq!(fingerprint.digest().len(), 64);
        assert_eq!(
            fingerprint.digest(),
            "b4c37e16030fd3d068cd2bb4cad19f25a3fbbee3074d4fe7acda1e1519342bbb"
        );
    }

    #[test]
    fn ignores_row_order_and_record_batch_boundaries() {
        let first = Row {
            period_start: 19_723,
            series: "MANCHESTER",
            value: 250_000.0,
            observation_count: 30,
        };
        let second = Row {
            period_start: 19_754,
            series: "LIVERPOOL",
            value: 200_000.0,
            observation_count: 40,
        };
        let left = stream(&[batch(&[first, second])]);
        let right = stream(&[batch(&[second]), batch(&[first])]);
        let verification =
            verify_time_series_streams(&left, &right).expect("streams should verify");

        assert!(verification.equivalent());
        assert_eq!(verification.left(), verification.right());
        assert_eq!(verification.mismatch_reason(), None);
    }

    #[test]
    fn treats_signed_zero_as_the_same_analytic_value() {
        let positive = stream(&[batch(&[Row {
            period_start: 19_723,
            series: "MANCHESTER",
            value: 0.0,
            observation_count: 1,
        }])]);
        let negative = stream(&[batch(&[Row {
            period_start: 19_723,
            series: "MANCHESTER",
            value: -0.0,
            observation_count: 1,
        }])]);

        assert!(
            verify_time_series_streams(&positive, &negative)
                .expect("finite streams should verify")
                .equivalent()
        );
    }

    #[test]
    fn rejects_any_finite_value_difference() {
        let baseline = stream(&[batch(&[Row {
            period_start: 19_723,
            series: "MANCHESTER",
            value: 250_000.0,
            observation_count: 30,
        }])]);
        let changed = stream(&[batch(&[Row {
            period_start: 19_723,
            series: "MANCHESTER",
            value: f64::from_bits(250_000.0_f64.to_bits() + 1),
            observation_count: 30,
        }])]);
        let verification =
            verify_time_series_streams(&baseline, &changed).expect("finite streams should verify");

        assert!(!verification.equivalent());
        assert_eq!(verification.mismatch_reason(), Some("row_value"));
        assert_ne!(verification.left().digest(), verification.right().digest());
    }

    #[test]
    fn preserves_duplicate_rows_during_comparison() {
        let row = Row {
            period_start: 19_723,
            series: "MANCHESTER",
            value: 250_000.0,
            observation_count: 30,
        };
        let left = stream(&[batch(&[row])]);
        let right = stream(&[batch(&[row, row])]);
        let verification =
            verify_time_series_streams(&left, &right).expect("streams should verify");

        assert!(!verification.equivalent());
        assert_eq!(verification.mismatch_reason(), Some("row_count"));
        assert_eq!(verification.left().row_count(), 1);
        assert_eq!(verification.right().row_count(), 2);
    }

    #[test]
    fn rejects_non_finite_values() {
        let invalid = stream(&[batch(&[Row {
            period_start: 19_723,
            series: "MANCHESTER",
            value: f64::NAN,
            observation_count: 30,
        }])]);

        assert!(verify_time_series_streams(&invalid, &invalid).is_err());
    }

    #[test]
    fn rejects_a_schema_type_mismatch() {
        let invalid = stream_with_float32_value();

        assert!(verify_time_series_streams(MANCHESTER_YEARLY, &invalid).is_err());
    }

    #[test]
    fn rejects_an_extra_result_column() {
        let invalid = stream_with_extra_column();

        assert!(verify_time_series_streams(MANCHESTER_YEARLY, &invalid).is_err());
    }

    #[test]
    fn reports_different_real_results_as_unequal() {
        let verification = verify_time_series_streams(MANCHESTER_YEARLY, LEEDS_BRISTOL_MONTHLY)
            .expect("both fixtures should satisfy the contract");

        assert!(!verification.equivalent());
        assert_eq!(verification.mismatch_reason(), Some("row_count"));
    }
}
