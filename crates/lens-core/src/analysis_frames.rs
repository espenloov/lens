use std::{collections::HashMap, io::Cursor};

use arrow_array::{Array, Float64Array, Int32Array, RecordBatch, StringArray, UInt64Array};
use arrow_ipc::reader::StreamReader;
use arrow_schema::{ArrowError, DataType, Schema};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AnalysisFrameError {
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

    #[error("Arrow numeric column `{name}` contains a non-finite value at index {index}")]
    NonFiniteValue { name: &'static str, index: usize },

    #[error("Arrow stream contains {actual} columns; expected exactly {expected}")]
    UnexpectedColumnCount { expected: usize, actual: usize },

    #[error("the Arrow stream contains more than u32::MAX distinct labels")]
    TooManyLabels,

    #[error("Arrow label `{label}` has conflicting order values")]
    ConflictingLabelOrder { label: String },
}

#[derive(Debug, Clone, PartialEq)]
pub struct CategoryData {
    categories: Vec<String>,
    values: Vec<f64>,
    observation_counts: Vec<u64>,
}

impl CategoryData {
    #[must_use]
    pub fn categories(&self) -> &[String] {
        &self.categories
    }

    #[must_use]
    pub fn values(&self) -> &[f64] {
        &self.values
    }

    #[must_use]
    pub fn observation_counts(&self) -> &[u64] {
        &self.observation_counts
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct HistogramData {
    bin_starts: Vec<f64>,
    bin_ends: Vec<f64>,
    series_indexes: Vec<u32>,
    series_names: Vec<String>,
    values: Vec<f64>,
    observation_counts: Vec<u64>,
}

impl HistogramData {
    #[must_use]
    pub fn bin_starts(&self) -> &[f64] {
        &self.bin_starts
    }

    #[must_use]
    pub fn bin_ends(&self) -> &[f64] {
        &self.bin_ends
    }

    #[must_use]
    pub fn series_indexes(&self) -> &[u32] {
        &self.series_indexes
    }

    #[must_use]
    pub fn series_names(&self) -> &[String] {
        &self.series_names
    }

    #[must_use]
    pub fn values(&self) -> &[f64] {
        &self.values
    }

    #[must_use]
    pub fn observation_counts(&self) -> &[u64] {
        &self.observation_counts
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MatrixData {
    x_indexes: Vec<u32>,
    x_labels: Vec<String>,
    y_indexes: Vec<u32>,
    y_labels: Vec<String>,
    values: Vec<f64>,
    observation_counts: Vec<u64>,
}

impl MatrixData {
    #[must_use]
    pub fn x_indexes(&self) -> &[u32] {
        &self.x_indexes
    }

    #[must_use]
    pub fn x_labels(&self) -> &[String] {
        &self.x_labels
    }

    #[must_use]
    pub fn y_indexes(&self) -> &[u32] {
        &self.y_indexes
    }

    #[must_use]
    pub fn y_labels(&self) -> &[String] {
        &self.y_labels
    }

    #[must_use]
    pub fn values(&self) -> &[f64] {
        &self.values
    }

    #[must_use]
    pub fn observation_counts(&self) -> &[u64] {
        &self.observation_counts
    }
}

fn typed_column<'a, T>(
    batch: &'a RecordBatch,
    name: &'static str,
    expected: DataType,
) -> Result<&'a T, AnalysisFrameError>
where
    T: 'static,
{
    let column = batch
        .column_by_name(name)
        .ok_or(AnalysisFrameError::MissingColumn { name })?;

    column
        .as_any()
        .downcast_ref::<T>()
        .ok_or_else(|| AnalysisFrameError::UnexpectedColumnType {
            name,
            expected,
            actual: column.data_type().clone(),
        })
}

fn require_no_nulls(column: &dyn Array, name: &'static str) -> Result<(), AnalysisFrameError> {
    let null_count = column.null_count();

    if null_count > 0 {
        return Err(AnalysisFrameError::NullValues { name, null_count });
    }

    Ok(())
}

fn require_finite(values: &Float64Array, name: &'static str) -> Result<(), AnalysisFrameError> {
    if let Some(index) = values.values().iter().position(|value| !value.is_finite()) {
        return Err(AnalysisFrameError::NonFiniteValue { name, index });
    }

    Ok(())
}

fn require_column_count(batch: &RecordBatch, expected: usize) -> Result<(), AnalysisFrameError> {
    let actual = batch.num_columns();

    if actual != expected {
        return Err(AnalysisFrameError::UnexpectedColumnCount { expected, actual });
    }

    Ok(())
}

fn validate_stream_schema(
    schema: &Schema,
    expected: &[(&'static str, DataType)],
) -> Result<(), AnalysisFrameError> {
    if schema.fields().len() != expected.len() {
        return Err(AnalysisFrameError::UnexpectedColumnCount {
            expected: expected.len(),
            actual: schema.fields().len(),
        });
    }

    for (name, data_type) in expected {
        let field = schema
            .field_with_name(name)
            .map_err(|_| AnalysisFrameError::MissingColumn { name })?;

        if field.data_type() != data_type {
            return Err(AnalysisFrameError::UnexpectedColumnType {
                name,
                expected: data_type.clone(),
                actual: field.data_type().clone(),
            });
        }
    }

    Ok(())
}

fn intern(
    value: &str,
    labels: &mut Vec<String>,
    lookup: &mut HashMap<String, u32>,
) -> Result<u32, AnalysisFrameError> {
    if let Some(index) = lookup.get(value) {
        return Ok(*index);
    }

    let index = u32::try_from(labels.len()).map_err(|_| AnalysisFrameError::TooManyLabels)?;
    let owned = value.to_owned();
    labels.push(owned.clone());
    lookup.insert(owned, index);
    Ok(index)
}

fn ordered_dictionary(
    orders: HashMap<String, i32>,
) -> Result<(Vec<String>, HashMap<String, u32>), AnalysisFrameError> {
    let mut ordered = orders.into_iter().collect::<Vec<_>>();
    ordered.sort_by(|(left_label, left_order), (right_label, right_order)| {
        left_order
            .cmp(right_order)
            .then_with(|| left_label.cmp(right_label))
    });
    let lookup = ordered
        .iter()
        .enumerate()
        .map(|(index, (label, _))| {
            u32::try_from(index)
                .map(|index| (label.clone(), index))
                .map_err(|_| AnalysisFrameError::TooManyLabels)
        })
        .collect::<Result<HashMap<_, _>, _>>()?;
    let labels = ordered.into_iter().map(|(label, _)| label).collect();

    Ok((labels, lookup))
}

/// Decodes the strict `categorical/v1` Arrow stream.
///
/// # Errors
///
/// Returns [`AnalysisFrameError`] when the IPC stream violates the physical contract.
pub fn decode_category_stream(bytes: &[u8]) -> Result<CategoryData, AnalysisFrameError> {
    let reader = StreamReader::try_new(Cursor::new(bytes), None)?;
    validate_stream_schema(
        reader.schema().as_ref(),
        &[
            ("category", DataType::Utf8),
            ("value", DataType::Float64),
            ("observation_count", DataType::UInt64),
        ],
    )?;
    let mut categories = Vec::new();
    let mut values = Vec::new();
    let mut observation_counts = Vec::new();

    for batch in reader {
        let batch = batch?;
        require_column_count(&batch, 3)?;
        let batch_categories = typed_column::<StringArray>(&batch, "category", DataType::Utf8)?;
        let batch_values = typed_column::<Float64Array>(&batch, "value", DataType::Float64)?;
        let batch_counts =
            typed_column::<UInt64Array>(&batch, "observation_count", DataType::UInt64)?;
        require_no_nulls(batch_categories, "category")?;
        require_no_nulls(batch_values, "value")?;
        require_no_nulls(batch_counts, "observation_count")?;
        require_finite(batch_values, "value")?;

        for row in 0..batch.num_rows() {
            categories.push(batch_categories.value(row).to_owned());
            values.push(batch_values.value(row));
            observation_counts.push(batch_counts.value(row));
        }
    }

    Ok(CategoryData {
        categories,
        values,
        observation_counts,
    })
}

/// Decodes the strict `histogram/v1` Arrow stream.
///
/// # Errors
///
/// Returns [`AnalysisFrameError`] when the IPC stream violates the physical contract.
pub fn decode_histogram_stream(bytes: &[u8]) -> Result<HistogramData, AnalysisFrameError> {
    let reader = StreamReader::try_new(Cursor::new(bytes), None)?;
    validate_stream_schema(
        reader.schema().as_ref(),
        &[
            ("bin_start", DataType::Float64),
            ("bin_end", DataType::Float64),
            ("series", DataType::Utf8),
            ("value", DataType::Float64),
            ("observation_count", DataType::UInt64),
        ],
    )?;
    let mut bin_starts = Vec::new();
    let mut bin_ends = Vec::new();
    let mut series_indexes = Vec::new();
    let mut series_names = Vec::new();
    let mut series_lookup = HashMap::new();
    let mut values = Vec::new();
    let mut observation_counts = Vec::new();

    for batch in reader {
        let batch = batch?;
        require_column_count(&batch, 5)?;
        let starts = typed_column::<Float64Array>(&batch, "bin_start", DataType::Float64)?;
        let ends = typed_column::<Float64Array>(&batch, "bin_end", DataType::Float64)?;
        let series = typed_column::<StringArray>(&batch, "series", DataType::Utf8)?;
        let batch_values = typed_column::<Float64Array>(&batch, "value", DataType::Float64)?;
        let counts = typed_column::<UInt64Array>(&batch, "observation_count", DataType::UInt64)?;

        for (column, name) in [
            (starts as &dyn Array, "bin_start"),
            (ends as &dyn Array, "bin_end"),
            (series as &dyn Array, "series"),
            (batch_values as &dyn Array, "value"),
            (counts as &dyn Array, "observation_count"),
        ] {
            require_no_nulls(column, name)?;
        }
        require_finite(starts, "bin_start")?;
        require_finite(ends, "bin_end")?;
        require_finite(batch_values, "value")?;

        for row in 0..batch.num_rows() {
            bin_starts.push(starts.value(row));
            bin_ends.push(ends.value(row));
            series_indexes.push(intern(
                series.value(row),
                &mut series_names,
                &mut series_lookup,
            )?);
            values.push(batch_values.value(row));
            observation_counts.push(counts.value(row));
        }
    }

    Ok(HistogramData {
        bin_starts,
        bin_ends,
        series_indexes,
        series_names,
        values,
        observation_counts,
    })
}

/// Decodes the strict `matrix/v1` sparse Arrow stream.
///
/// # Errors
///
/// Returns [`AnalysisFrameError`] when the IPC stream violates the physical contract.
pub fn decode_matrix_stream(bytes: &[u8]) -> Result<MatrixData, AnalysisFrameError> {
    let reader = StreamReader::try_new(Cursor::new(bytes), None)?;
    validate_stream_schema(
        reader.schema().as_ref(),
        &[
            ("x", DataType::Utf8),
            ("x_order", DataType::Int32),
            ("y", DataType::Utf8),
            ("y_order", DataType::Int32),
            ("value", DataType::Float64),
            ("observation_count", DataType::UInt64),
        ],
    )?;
    let mut rows = Vec::<(String, i32, String, i32, f64, u64)>::new();
    let mut x_orders = HashMap::<String, i32>::new();
    let mut y_orders = HashMap::<String, i32>::new();

    for batch in reader {
        let batch = batch?;
        require_column_count(&batch, 6)?;
        let x = typed_column::<StringArray>(&batch, "x", DataType::Utf8)?;
        let x_order = typed_column::<Int32Array>(&batch, "x_order", DataType::Int32)?;
        let y = typed_column::<StringArray>(&batch, "y", DataType::Utf8)?;
        let y_order = typed_column::<Int32Array>(&batch, "y_order", DataType::Int32)?;
        let batch_values = typed_column::<Float64Array>(&batch, "value", DataType::Float64)?;
        let counts = typed_column::<UInt64Array>(&batch, "observation_count", DataType::UInt64)?;

        for (column, name) in [
            (x as &dyn Array, "x"),
            (x_order as &dyn Array, "x_order"),
            (y as &dyn Array, "y"),
            (y_order as &dyn Array, "y_order"),
            (batch_values as &dyn Array, "value"),
            (counts as &dyn Array, "observation_count"),
        ] {
            require_no_nulls(column, name)?;
        }
        require_finite(batch_values, "value")?;

        for row in 0..batch.num_rows() {
            let x_label = x.value(row).to_owned();
            let x_position = x_order.value(row);
            let y_label = y.value(row).to_owned();
            let y_position = y_order.value(row);

            for (label, position, orders) in [
                (&x_label, x_position, &mut x_orders),
                (&y_label, y_position, &mut y_orders),
            ] {
                if orders
                    .insert(label.clone(), position)
                    .is_some_and(|existing| existing != position)
                {
                    return Err(AnalysisFrameError::ConflictingLabelOrder {
                        label: label.clone(),
                    });
                }
            }

            rows.push((
                x_label,
                x_position,
                y_label,
                y_position,
                batch_values.value(row),
                counts.value(row),
            ));
        }
    }

    let (x_labels, x_lookup) = ordered_dictionary(x_orders)?;
    let (y_labels, y_lookup) = ordered_dictionary(y_orders)?;
    let mut x_indexes = Vec::with_capacity(rows.len());
    let mut y_indexes = Vec::with_capacity(rows.len());
    let mut values = Vec::with_capacity(rows.len());
    let mut observation_counts = Vec::with_capacity(rows.len());

    for (x, _, y, _, value, count) in rows {
        x_indexes.push(x_lookup[&x]);
        y_indexes.push(y_lookup[&y]);
        values.push(value);
        observation_counts.push(count);
    }

    Ok(MatrixData {
        x_indexes,
        x_labels,
        y_indexes,
        y_labels,
        values,
        observation_counts,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow_array::{ArrayRef, Float64Array, Int32Array, RecordBatch, StringArray, UInt64Array};
    use arrow_ipc::writer::StreamWriter;
    use arrow_schema::{DataType, Field, Schema};

    use super::{
        AnalysisFrameError, decode_category_stream, decode_histogram_stream, decode_matrix_stream,
    };

    fn stream(fields: Vec<Field>, columns: Vec<ArrayRef>) -> Vec<u8> {
        let schema = Arc::new(Schema::new(fields));
        let batch = RecordBatch::try_new(Arc::clone(&schema), columns)
            .expect("test batch should match its schema");
        let mut bytes = Vec::new();
        let mut writer = StreamWriter::try_new(&mut bytes, &schema)
            .expect("test stream writer should initialize");
        writer.write(&batch).expect("test batch should serialize");
        writer.finish().expect("test stream should finish");
        drop(writer);
        bytes
    }

    fn schema_only(fields: Vec<Field>) -> Vec<u8> {
        let schema = Schema::new(fields);
        let mut bytes = Vec::new();
        let mut writer = StreamWriter::try_new(&mut bytes, &schema)
            .expect("test stream writer should initialize");
        writer.finish().expect("test stream should finish");
        drop(writer);
        bytes
    }

    #[test]
    fn decodes_the_strict_category_contract() {
        let bytes = stream(
            vec![
                Field::new("category", DataType::Utf8, false),
                Field::new("value", DataType::Float64, false),
                Field::new("observation_count", DataType::UInt64, false),
            ],
            vec![
                Arc::new(StringArray::from(vec!["Manchester", "Liverpool"])),
                Arc::new(Float64Array::from(vec![250_000.0, 210_000.0])),
                Arc::new(UInt64Array::from(vec![100, 80])),
            ],
        );
        let decoded = decode_category_stream(&bytes).expect("category fixture should decode");

        assert_eq!(decoded.categories(), &["Manchester", "Liverpool"]);
        assert_eq!(decoded.observation_counts(), &[100, 80]);
    }

    #[test]
    fn rejects_non_finite_category_values() {
        let bytes = stream(
            vec![
                Field::new("category", DataType::Utf8, false),
                Field::new("value", DataType::Float64, false),
                Field::new("observation_count", DataType::UInt64, false),
            ],
            vec![
                Arc::new(StringArray::from(vec!["Manchester"])),
                Arc::new(Float64Array::from(vec![f64::NAN])),
                Arc::new(UInt64Array::from(vec![1])),
            ],
        );

        assert!(matches!(
            decode_category_stream(&bytes),
            Err(AnalysisFrameError::NonFiniteValue { name: "value", .. })
        ));
    }

    #[test]
    fn rejects_a_wrong_schema_even_without_record_batches() {
        let bytes = schema_only(vec![Field::new("wrong", DataType::Utf8, false)]);

        assert!(matches!(
            decode_category_stream(&bytes),
            Err(AnalysisFrameError::UnexpectedColumnCount {
                expected: 3,
                actual: 1
            })
        ));
    }

    #[test]
    fn decodes_histograms_and_interns_series() {
        let bytes = stream(
            vec![
                Field::new("bin_start", DataType::Float64, false),
                Field::new("bin_end", DataType::Float64, false),
                Field::new("series", DataType::Utf8, false),
                Field::new("value", DataType::Float64, false),
                Field::new("observation_count", DataType::UInt64, false),
            ],
            vec![
                Arc::new(Float64Array::from(vec![0.0, 50_000.0])),
                Arc::new(Float64Array::from(vec![50_000.0, 100_000.0])),
                Arc::new(StringArray::from(vec!["Flat", "Flat"])),
                Arc::new(Float64Array::from(vec![10.0, 20.0])),
                Arc::new(UInt64Array::from(vec![10, 20])),
            ],
        );
        let decoded = decode_histogram_stream(&bytes).expect("histogram fixture should decode");

        assert_eq!(decoded.series_names(), &["Flat"]);
        assert_eq!(decoded.series_indexes(), &[0, 0]);
    }

    #[test]
    fn decodes_a_sparse_matrix_contract() {
        let bytes = stream(
            vec![
                Field::new("x", DataType::Utf8, false),
                Field::new("x_order", DataType::Int32, false),
                Field::new("y", DataType::Utf8, false),
                Field::new("y_order", DataType::Int32, false),
                Field::new("value", DataType::Float64, false),
                Field::new("observation_count", DataType::UInt64, false),
            ],
            vec![
                Arc::new(StringArray::from(vec!["2022", "2023"])),
                Arc::new(Int32Array::from(vec![2022, 2023])),
                Arc::new(StringArray::from(vec!["Flat", "Detached"])),
                Arc::new(Int32Array::from(vec![4, 1])),
                Arc::new(Float64Array::from(vec![200_000.0, 300_000.0])),
                Arc::new(UInt64Array::from(vec![50, 40])),
            ],
        );
        let decoded = decode_matrix_stream(&bytes).expect("matrix fixture should decode");

        assert_eq!(decoded.x_labels(), &["2022", "2023"]);
        assert_eq!(decoded.y_labels(), &["Detached", "Flat"]);
        assert_eq!(decoded.x_indexes(), &[0, 1]);
        assert_eq!(decoded.y_indexes(), &[1, 0]);
    }
}
