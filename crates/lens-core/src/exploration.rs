use std::io::Cursor;

use arrow_array::{Array, Float64Array, RecordBatch, UInt8Array, UInt16Array};
use arrow_ipc::reader::StreamReader;
use arrow_schema::{ArrowError, DataType, Schema};
use thiserror::Error;

pub const MAX_SOURCE_ROWS: usize = 1_000_000;
const MAX_INDEX_CELLS: usize = 2_000_000;

#[derive(Debug, Error)]
pub enum ExplorationError {
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
    #[error("Arrow stream contains {actual} columns; expected exactly {expected}")]
    UnexpectedColumnCount { expected: usize, actual: usize },
    #[error("exploration value at row {row} is not finite or non-negative")]
    InvalidValue { row: usize },
    #[error("day index {day} at row {row} is outside the workspace")]
    InvalidDay { row: usize, day: u16 },
    #[error("dimension {dimension} code {code} at row {row} is outside the codebook")]
    InvalidDimensionCode {
        row: usize,
        dimension: usize,
        code: u8,
    },
    #[error("the exploration contains more than {MAX_SOURCE_ROWS} source rows")]
    TooManyRows,
    #[error("the exploration workspace configuration is invalid")]
    InvalidConfiguration,
    #[error("the exploration index would exceed its bounded allocation")]
    IndexTooLarge,
    #[error("the requested window or category filter is invalid")]
    InvalidWindow,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ExplorationWindow {
    total_count: u32,
    average_value: f64,
    q1: f64,
    median: f64,
    q3: f64,
    estimated_outlier_count: u32,
    histogram_counts: Vec<u32>,
    dimension_counts: [Vec<u32>; 3],
}

impl ExplorationWindow {
    #[must_use]
    pub const fn total_count(&self) -> u32 {
        self.total_count
    }
    #[must_use]
    pub const fn average_value(&self) -> f64 {
        self.average_value
    }
    #[must_use]
    pub const fn q1(&self) -> f64 {
        self.q1
    }
    #[must_use]
    pub const fn median(&self) -> f64 {
        self.median
    }
    #[must_use]
    pub const fn q3(&self) -> f64 {
        self.q3
    }
    #[must_use]
    pub const fn estimated_outlier_count(&self) -> u32 {
        self.estimated_outlier_count
    }
    #[must_use]
    pub fn histogram_counts(&self) -> &[u32] {
        &self.histogram_counts
    }
    #[must_use]
    pub fn dimension_counts(&self, dimension: usize) -> Option<&[u32]> {
        self.dimension_counts.get(dimension).map(Vec::as_slice)
    }
}

#[derive(Debug, Clone)]
pub struct ExplorationWorkspace {
    row_count: usize,
    day_count: usize,
    bin_count: usize,
    bucket_minimum: f64,
    bucket_width: f64,
    cardinalities: [usize; 3],
    bin_midpoints: Vec<f64>,
    prefix_counts: Vec<u32>,
    prefix_sums: Vec<f64>,
}

impl ExplorationWorkspace {
    #[must_use]
    pub const fn row_count(&self) -> usize {
        self.row_count
    }
    #[must_use]
    pub const fn day_count(&self) -> usize {
        self.day_count
    }
    #[must_use]
    pub const fn bin_count(&self) -> usize {
        self.bin_count
    }
    #[must_use]
    pub const fn bucket_minimum(&self) -> f64 {
        self.bucket_minimum
    }
    #[must_use]
    pub const fn bucket_width(&self) -> f64 {
        self.bucket_width
    }
    #[must_use]
    pub const fn cardinalities(&self) -> [usize; 3] {
        self.cardinalities
    }

    #[must_use]
    pub fn index_bytes(&self) -> usize {
        self.prefix_counts.len() * size_of::<u32>()
            + self.prefix_sums.len() * size_of::<f64>()
            + self.bin_midpoints.len() * size_of::<f64>()
    }

    fn combination_count(&self) -> usize {
        self.cardinalities.iter().product()
    }

    fn stride(&self) -> usize {
        self.combination_count() * self.bin_count
    }

    fn combination_codes(&self, combination: usize) -> [usize; 3] {
        let dimension_0 = combination % self.cardinalities[0];
        let remainder = combination / self.cardinalities[0];
        let dimension_1 = remainder % self.cardinalities[1];
        let dimension_2 = remainder / self.cardinalities[1];
        [dimension_0, dimension_1, dimension_2]
    }

    fn validate_filters(&self, filters: [i16; 3]) -> Result<(), ExplorationError> {
        if filters.iter().enumerate().any(|(dimension, filter)| {
            *filter < -1
                || (*filter >= 0
                    && usize::try_from(*filter)
                        .map_or(true, |value| value >= self.cardinalities[dimension]))
        }) {
            return Err(ExplorationError::InvalidWindow);
        }
        Ok(())
    }

    fn matches_filters(&self, combination: usize, filters: [i16; 3]) -> bool {
        self.combination_codes(combination)
            .iter()
            .zip(filters)
            .all(|(code, filter)| filter < 0 || usize::try_from(filter) == Ok(*code))
    }

    fn difference(&self, start: usize, end: usize, cell: usize) -> (u32, f64) {
        let stride = self.stride();
        let before = start * stride + cell;
        let after = (end + 1) * stride + cell;
        (
            self.prefix_counts[after] - self.prefix_counts[before],
            self.prefix_sums[after] - self.prefix_sums[before],
        )
    }

    fn estimate_quantile(
        &self,
        histogram: &[u32],
        numerator: u32,
        denominator: u32,
    ) -> Option<f64> {
        let total = histogram.iter().sum::<u32>();
        if total == 0 {
            return None;
        }
        let target = (total - 1) * numerator / denominator;
        let mut cumulative = 0_u32;
        for (bin, count) in histogram.iter().enumerate() {
            cumulative += *count;
            if cumulative > target {
                return self.bin_midpoints.get(bin).copied();
            }
        }
        self.bin_midpoints.last().copied()
    }

    /// Produces a density matrix for a category-filtered workspace.
    ///
    /// # Errors
    ///
    /// Returns [`ExplorationError`] when a category filter is outside its codebook.
    pub fn density_counts(&self, filters: [i16; 3]) -> Result<Vec<u32>, ExplorationError> {
        self.validate_filters(filters)?;
        let mut density = vec![0_u32; self.day_count * self.bin_count];
        for day in 0..self.day_count {
            for combination in 0..self.combination_count() {
                if !self.matches_filters(combination, filters) {
                    continue;
                }
                for bin in 0..self.bin_count {
                    let cell = combination * self.bin_count + bin;
                    density[day * self.bin_count + bin] += self.difference(day, day, cell).0;
                }
            }
        }
        Ok(density)
    }

    /// Estimates daily quartiles from the local value histogram.
    ///
    /// # Errors
    ///
    /// Returns [`ExplorationError`] when a category filter is outside its codebook.
    pub fn daily_quartiles(&self, filters: [i16; 3]) -> Result<Vec<f64>, ExplorationError> {
        let density = self.density_counts(filters)?;
        Ok(self.quartiles_from_density(&density))
    }

    fn quartiles_from_density(&self, density: &[u32]) -> Vec<f64> {
        let mut quartiles = Vec::with_capacity(self.day_count * 3);
        for day in 0..self.day_count {
            let histogram = &density[day * self.bin_count..(day + 1) * self.bin_count];
            quartiles.push(self.estimate_quantile(histogram, 1, 4).unwrap_or(f64::NAN));
            quartiles.push(self.estimate_quantile(histogram, 1, 2).unwrap_or(f64::NAN));
            quartiles.push(self.estimate_quantile(histogram, 3, 4).unwrap_or(f64::NAN));
        }
        quartiles
    }

    /// Produces density counts and daily quartiles with one local density pass.
    ///
    /// # Errors
    ///
    /// Returns [`ExplorationError`] when a category filter is outside its codebook.
    pub fn density_frame(
        &self,
        filters: [i16; 3],
    ) -> Result<(Vec<u32>, Vec<f64>), ExplorationError> {
        let density = self.density_counts(filters)?;
        let quartiles = self.quartiles_from_density(&density);
        Ok((density, quartiles))
    }

    /// Calculates a selected-window summary from time-prefix indexes.
    ///
    /// # Errors
    ///
    /// Returns [`ExplorationError`] when the window or category filters are invalid.
    pub fn summarize(
        &self,
        start: usize,
        end: usize,
        filters: [i16; 3],
    ) -> Result<ExplorationWindow, ExplorationError> {
        if start > end || end >= self.day_count {
            return Err(ExplorationError::InvalidWindow);
        }
        self.validate_filters(filters)?;
        let mut histogram_counts = vec![0_u32; self.bin_count];
        let mut dimension_counts = self.cardinalities.map(|count| vec![0_u32; count]);
        let mut total_count = 0_u32;
        let mut total_sum = 0.0;
        for combination in 0..self.combination_count() {
            if !self.matches_filters(combination, filters) {
                continue;
            }
            let codes = self.combination_codes(combination);
            for (bin, histogram_count) in histogram_counts.iter_mut().enumerate() {
                let cell = combination * self.bin_count + bin;
                let (count, sum) = self.difference(start, end, cell);
                *histogram_count += count;
                total_count += count;
                total_sum += sum;
                for dimension in 0..3 {
                    dimension_counts[dimension][codes[dimension]] += count;
                }
            }
        }
        let q1 = self
            .estimate_quantile(&histogram_counts, 1, 4)
            .unwrap_or(0.0);
        let median = self
            .estimate_quantile(&histogram_counts, 1, 2)
            .unwrap_or(0.0);
        let q3 = self
            .estimate_quantile(&histogram_counts, 3, 4)
            .unwrap_or(0.0);
        let interquartile_range = q3 - q1;
        let lower_fence = q1 - 1.5 * interquartile_range;
        let upper_fence = q3 + 1.5 * interquartile_range;
        let estimated_outlier_count = histogram_counts
            .iter()
            .enumerate()
            .filter(|(bin, _)| {
                let midpoint = self.bin_midpoints[*bin];
                midpoint < lower_fence || midpoint > upper_fence
            })
            .map(|(_, count)| *count)
            .sum();
        Ok(ExplorationWindow {
            total_count,
            average_value: if total_count == 0 {
                0.0
            } else {
                total_sum / f64::from(total_count)
            },
            q1,
            median,
            q3,
            estimated_outlier_count,
            histogram_counts,
            dimension_counts,
        })
    }
}

fn validate_schema(schema: &Schema) -> Result<(), ExplorationError> {
    let expected = [
        ("day_index", DataType::UInt16),
        ("value", DataType::Float64),
        ("dimension_0", DataType::UInt8),
        ("dimension_1", DataType::UInt8),
        ("dimension_2", DataType::UInt8),
    ];
    if schema.fields().len() != expected.len() {
        return Err(ExplorationError::UnexpectedColumnCount {
            expected: expected.len(),
            actual: schema.fields().len(),
        });
    }
    for (name, data_type) in expected {
        let field = schema
            .field_with_name(name)
            .map_err(|_| ExplorationError::MissingColumn { name })?;
        if field.data_type() != &data_type {
            return Err(ExplorationError::UnexpectedColumnType {
                name,
                expected: data_type,
                actual: field.data_type().clone(),
            });
        }
    }
    Ok(())
}

fn typed_column<'a, T>(
    batch: &'a RecordBatch,
    name: &'static str,
    expected: DataType,
) -> Result<&'a T, ExplorationError>
where
    T: 'static,
{
    let column = batch
        .column_by_name(name)
        .ok_or(ExplorationError::MissingColumn { name })?;
    if column.null_count() > 0 {
        return Err(ExplorationError::NullValues {
            name,
            null_count: column.null_count(),
        });
    }
    column
        .as_any()
        .downcast_ref::<T>()
        .ok_or_else(|| ExplorationError::UnexpectedColumnType {
            name,
            expected,
            actual: column.data_type().clone(),
        })
}

fn validate_configuration(
    day_count: usize,
    bin_count: usize,
    bucket_minimum: f64,
    bucket_width: f64,
    cardinalities: [usize; 3],
) -> Result<usize, ExplorationError> {
    if day_count == 0
        || day_count > 366
        || bin_count == 0
        || bin_count > 96
        || !bucket_minimum.is_finite()
        || bucket_minimum < 0.0
        || !bucket_width.is_finite()
        || bucket_width <= 0.0
        || cardinalities.contains(&0)
    {
        return Err(ExplorationError::InvalidConfiguration);
    }
    let combinations = cardinalities
        .into_iter()
        .try_fold(1_usize, usize::checked_mul)
        .ok_or(ExplorationError::IndexTooLarge)?;
    let stride = combinations
        .checked_mul(bin_count)
        .ok_or(ExplorationError::IndexTooLarge)?;
    let cells = (day_count + 1)
        .checked_mul(stride)
        .ok_or(ExplorationError::IndexTooLarge)?;
    if cells > MAX_INDEX_CELLS {
        return Err(ExplorationError::IndexTooLarge);
    }
    Ok(stride)
}

/// Builds a bounded local exploration workspace from an `exploration/v1` Arrow stream.
///
/// # Errors
///
/// Returns [`ExplorationError`] for invalid schemas, rows, codebooks, or allocations.
pub fn build_workspace(
    bytes: &[u8],
    day_count: usize,
    bin_count: usize,
    bucket_minimum: f64,
    bucket_width: f64,
    cardinalities: [usize; 3],
) -> Result<ExplorationWorkspace, ExplorationError> {
    let stride = validate_configuration(
        day_count,
        bin_count,
        bucket_minimum,
        bucket_width,
        cardinalities,
    )?;
    let mut reader = StreamReader::try_new(Cursor::new(bytes), None)?;
    validate_schema(reader.schema().as_ref())?;
    let mut prefix_counts = vec![0_u32; (day_count + 1) * stride];
    let mut prefix_sums = vec![0.0; (day_count + 1) * stride];
    let mut bin_midpoints = Vec::with_capacity(bin_count);
    let mut midpoint = bucket_minimum + bucket_width / 2.0;
    let mut upper_bounds = Vec::with_capacity(bin_count.saturating_sub(1));
    let mut upper_bound = bucket_minimum + bucket_width;

    for bin in 0..bin_count {
        bin_midpoints.push(midpoint);
        midpoint += bucket_width;

        if bin + 1 < bin_count {
            upper_bounds.push(upper_bound);
            upper_bound += bucket_width;
        }
    }

    let mut row_count = 0_usize;
    for batch in &mut reader {
        let batch = batch?;
        if batch.num_columns() != 5 {
            return Err(ExplorationError::UnexpectedColumnCount {
                expected: 5,
                actual: batch.num_columns(),
            });
        }
        let days = typed_column::<UInt16Array>(&batch, "day_index", DataType::UInt16)?;
        let values = typed_column::<Float64Array>(&batch, "value", DataType::Float64)?;
        let dimensions = [
            typed_column::<UInt8Array>(&batch, "dimension_0", DataType::UInt8)?,
            typed_column::<UInt8Array>(&batch, "dimension_1", DataType::UInt8)?,
            typed_column::<UInt8Array>(&batch, "dimension_2", DataType::UInt8)?,
        ];
        if row_count + batch.num_rows() > MAX_SOURCE_ROWS {
            return Err(ExplorationError::TooManyRows);
        }
        for row in 0..batch.num_rows() {
            let source_row = row_count + row;
            let day = usize::from(days.value(row));
            let value = values.value(row);
            if day >= day_count {
                return Err(ExplorationError::InvalidDay {
                    row: source_row,
                    day: days.value(row),
                });
            }
            if !value.is_finite() || value < 0.0 {
                return Err(ExplorationError::InvalidValue { row: source_row });
            }
            let mut codes = [0_usize; 3];
            for dimension in 0..3 {
                let code = dimensions[dimension].value(row);
                codes[dimension] = usize::from(code);
                if codes[dimension] >= cardinalities[dimension] {
                    return Err(ExplorationError::InvalidDimensionCode {
                        row: source_row,
                        dimension,
                        code,
                    });
                }
            }
            let combination =
                codes[0] + cardinalities[0] * (codes[1] + cardinalities[1] * codes[2]);
            let bin = upper_bounds.partition_point(|upper| value >= *upper);
            let cell = (day + 1) * stride + combination * bin_count + bin;
            prefix_counts[cell] += 1;
            prefix_sums[cell] += value;
        }
        row_count += batch.num_rows();
    }
    for day in 1..=day_count {
        for cell in 0..stride {
            let current = day * stride + cell;
            let previous = (day - 1) * stride + cell;
            prefix_counts[current] += prefix_counts[previous];
            prefix_sums[current] += prefix_sums[previous];
        }
    }
    Ok(ExplorationWorkspace {
        row_count,
        day_count,
        bin_count,
        bucket_minimum,
        bucket_width,
        cardinalities,
        bin_midpoints,
        prefix_counts,
        prefix_sums,
    })
}

#[cfg(test)]
mod tests {
    use super::{ExplorationError, build_workspace};
    use arrow_array::{ArrayRef, Float64Array, RecordBatch, UInt8Array, UInt16Array};
    use arrow_ipc::writer::StreamWriter;
    use arrow_schema::{DataType, Field, Schema};
    use std::{io::Cursor, sync::Arc};

    fn fixture(dimension_0: Vec<u8>) -> Vec<u8> {
        fixture_with(
            vec![0, 0, 1, 2, 2],
            vec![100.0, 200.0, 150.0, 250.0, 350.0],
            dimension_0,
        )
    }

    fn fixture_with(days: Vec<u16>, values: Vec<f64>, dimension_0: Vec<u8>) -> Vec<u8> {
        let schema = Arc::new(Schema::new(vec![
            Field::new("day_index", DataType::UInt16, false),
            Field::new("value", DataType::Float64, false),
            Field::new("dimension_0", DataType::UInt8, false),
            Field::new("dimension_1", DataType::UInt8, false),
            Field::new("dimension_2", DataType::UInt8, false),
        ]));
        let columns: Vec<ArrayRef> = vec![
            Arc::new(UInt16Array::from(days)),
            Arc::new(Float64Array::from(values)),
            Arc::new(UInt8Array::from(dimension_0)),
            Arc::new(UInt8Array::from(vec![0, 1, 0, 1, 0])),
            Arc::new(UInt8Array::from(vec![0, 0, 0, 0, 0])),
        ];
        let batch = RecordBatch::try_new(Arc::clone(&schema), columns).expect("valid fixture");
        let mut output = Cursor::new(Vec::new());
        {
            let mut writer = StreamWriter::try_new(&mut output, schema.as_ref()).expect("writer");
            writer.write(&batch).expect("write fixture");
            writer.finish().expect("finish fixture");
        }
        output.into_inner()
    }

    #[test]
    fn prefix_windows_match_expected_rows() {
        let workspace = build_workspace(&fixture(vec![0, 1, 0, 1, 0]), 3, 4, 0.0, 100.0, [2, 2, 1])
            .expect("valid workspace");
        let full = workspace
            .summarize(0, 2, [-1, -1, -1])
            .expect("valid full window");
        let first_category = workspace
            .summarize(0, 2, [0, -1, -1])
            .expect("valid category window");
        let first_day = workspace
            .summarize(0, 0, [-1, -1, -1])
            .expect("valid first day");
        assert_eq!(workspace.row_count(), 5);
        assert_eq!(full.total_count(), 5);
        assert_eq!(full.histogram_counts(), &[0, 2, 2, 1]);
        assert_eq!(first_category.total_count(), 3);
        assert_eq!(first_day.total_count(), 2);
        assert!((full.average_value() - 210.0).abs() < f64::EPSILON);
    }

    #[test]
    fn density_totals_equal_the_source_rows() {
        let workspace = build_workspace(&fixture(vec![0, 1, 0, 1, 0]), 3, 4, 0.0, 100.0, [2, 2, 1])
            .expect("valid workspace");
        let density = workspace
            .density_counts([-1, -1, -1])
            .expect("valid density");
        assert_eq!(density.iter().sum::<u32>(), 5);
        assert_eq!(
            workspace
                .daily_quartiles([-1, -1, -1])
                .expect("quartiles")
                .len(),
            9
        );
    }

    #[test]
    fn rejects_unknown_dimension_codes() {
        let result = build_workspace(&fixture(vec![0, 1, 2, 1, 0]), 3, 4, 0.0, 100.0, [2, 2, 1]);
        assert!(matches!(
            result,
            Err(ExplorationError::InvalidDimensionCode {
                dimension: 0,
                code: 2,
                ..
            })
        ));
    }

    #[test]
    fn marks_empty_days_without_inventing_zero_quartiles() {
        let workspace = build_workspace(&fixture(vec![0, 1, 0, 1, 0]), 4, 4, 0.0, 100.0, [2, 2, 1])
            .expect("valid workspace");
        let quartiles = workspace
            .daily_quartiles([-1, -1, -1])
            .expect("valid quartiles");

        assert!(quartiles[9..12].iter().all(|value| value.is_nan()));
    }

    #[test]
    fn rejects_invalid_windows_and_allocations() {
        let bytes = fixture(vec![0, 1, 0, 1, 0]);
        let workspace =
            build_workspace(&bytes, 3, 4, 0.0, 100.0, [2, 2, 1]).expect("valid workspace");

        assert!(matches!(
            workspace.summarize(2, 1, [-1, -1, -1]),
            Err(ExplorationError::InvalidWindow)
        ));
        assert!(matches!(
            build_workspace(&bytes, 0, 4, 0.0, 100.0, [2, 2, 1]),
            Err(ExplorationError::InvalidConfiguration)
        ));
    }

    #[test]
    fn rejects_non_finite_values_and_out_of_range_days() {
        let non_finite = fixture_with(
            vec![0, 0, 1, 2, 2],
            vec![100.0, f64::NAN, 150.0, 250.0, 350.0],
            vec![0, 1, 0, 1, 0],
        );
        let invalid_day = fixture_with(
            vec![0, 0, 1, 3, 2],
            vec![100.0, 200.0, 150.0, 250.0, 350.0],
            vec![0, 1, 0, 1, 0],
        );

        assert!(matches!(
            build_workspace(&non_finite, 3, 4, 0.0, 100.0, [2, 2, 1]),
            Err(ExplorationError::InvalidValue { row: 1 })
        ));
        assert!(matches!(
            build_workspace(&invalid_day, 3, 4, 0.0, 100.0, [2, 2, 1]),
            Err(ExplorationError::InvalidDay { row: 3, day: 3 })
        ));
    }
}
