use std::io::Cursor;

use arrow_array::{Array, RecordBatch, UInt16Array, UInt64Array};
use arrow_ipc::reader::StreamReader;
use arrow_schema::{ArrowError, DataType};
use thiserror::Error;

#[derive(Debug, Clone)]
pub struct YearlyPriceBatch {
    years: UInt16Array,
    average_prices: UInt64Array,
    transaction_counts: UInt64Array,
}

impl YearlyPriceBatch {
    #[must_use]
    pub fn len(&self) -> usize {
        self.years.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.years.is_empty()
    }

    #[must_use]
    pub fn years(&self) -> &[u16] {
        self.years.values().as_ref()
    }

    #[must_use]
    pub fn average_prices(&self) -> &[u64] {
        self.average_prices.values().as_ref()
    }

    #[must_use]
    pub fn transaction_counts(&self) -> &[u64] {
        self.transaction_counts.values().as_ref()
    }
}

#[derive(Debug, Error)]
pub enum YearlyPriceArrowError {
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
}

fn typed_column<'a, T>(
    batch: &'a RecordBatch,
    name: &'static str,
    expected: DataType,
) -> Result<&'a T, YearlyPriceArrowError>
where
    T: 'static,
{
    let column = batch
        .column_by_name(name)
        .ok_or(YearlyPriceArrowError::MissingColumn { name })?;

    column
        .as_any()
        .downcast_ref::<T>()
        .ok_or_else(|| YearlyPriceArrowError::UnexpectedColumnType {
            name,
            expected,
            actual: column.data_type().clone(),
        })
}

fn require_no_nulls(column: &dyn Array, name: &'static str) -> Result<(), YearlyPriceArrowError> {
    let null_count = column.null_count();

    if null_count > 0 {
        return Err(YearlyPriceArrowError::NullValues { name, null_count });
    }

    Ok(())
}

fn decode_batch(batch: &RecordBatch) -> Result<YearlyPriceBatch, YearlyPriceArrowError> {
    let years = typed_column::<UInt16Array>(batch, "year", DataType::UInt16)?.clone();

    let average_prices =
        typed_column::<UInt64Array>(batch, "average_price", DataType::UInt64)?.clone();

    let transaction_counts =
        typed_column::<UInt64Array>(batch, "transaction_count", DataType::UInt64)?.clone();

    require_no_nulls(&years, "year")?;
    require_no_nulls(&average_prices, "average_price")?;
    require_no_nulls(&transaction_counts, "transaction_count")?;

    Ok(YearlyPriceBatch {
        years,
        average_prices,
        transaction_counts,
    })
}

/// Decodes yearly property-price batches from an Arrow IPC stream.
///
/// # Errors
///
/// Returns [`YearlyPriceArrowError`] when the IPC bytes are invalid, a
/// required column is missing, a column has an unexpected type, or a required
/// value is null.
pub fn decode_yearly_price_stream(
    bytes: &[u8],
) -> Result<Vec<YearlyPriceBatch>, YearlyPriceArrowError> {
    let cursor = Cursor::new(bytes);

    let reader = StreamReader::try_new(cursor, None)?;

    let mut batches = Vec::new();

    for batch in reader {
        batches.push(decode_batch(&batch?)?);
    }

    Ok(batches)
}

#[cfg(test)]
mod tests {
    use super::decode_yearly_price_stream;
    const CLICKHOUSE_STREAM: &[u8] = include_bytes!("../tests/fixtures/manchester-yearly.arrow");

    #[test]
    fn decodes_the_real_clickhouse_arrow_stream() {
        let batches = decode_yearly_price_stream(CLICKHOUSE_STREAM)
            .expect("ClickHouse fixture should be valid Arrow IPC");

        assert_eq!(batches.len(), 1);

        let batch = &batches[0];

        assert_eq!(
            batch.years(),
            &[2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023]
        );

        assert_eq!(
            batch.average_prices(),
            &[
                196_044, 203_230, 252_443, 276_870, 247_844, 267_960, 301_672, 301_560, 270_667,
            ]
        );

        assert_eq!(
            batch.transaction_counts(),
            &[
                16_645, 18_460, 18_427, 18_291, 17_358, 15_872, 20_571, 16_500, 9_595,
            ]
        );
    }

    #[test]
    fn rejects_non_arrow_bytes() {
        let result = decode_yearly_price_stream(b"this is not Arrow");

        assert!(result.is_err());
    }
}
