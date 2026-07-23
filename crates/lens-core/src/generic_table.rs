use std::{
    collections::{HashMap, HashSet},
    io::Cursor,
};

use arrow_array::{
    Array, Date32Array, Date64Array, Float32Array, Float64Array, Int8Array, Int16Array, Int32Array,
    Int64Array, LargeStringArray, RecordBatch, StringArray, TimestampMicrosecondArray,
    TimestampMillisecondArray, TimestampNanosecondArray, TimestampSecondArray, UInt8Array,
    UInt16Array, UInt32Array, UInt64Array,
};
use arrow_ipc::reader::StreamReader;
use arrow_schema::{ArrowError, DataType};
use thiserror::Error;

const MAXIMUM_ROWS: usize = 1_000_000;
const MAXIMUM_COLUMNS_PER_ROLE: usize = 16;
const MAXIMUM_BINS: usize = 512;
const MAXIMUM_EXACT_INTEGER: u64 = 1_u64 << 53;
const MILLIS_PER_DAY: i64 = 86_400_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemanticSchema {
    time_column: Option<String>,
    measure_columns: Vec<String>,
    dimension_columns: Vec<String>,
}

impl SemanticSchema {
    /// Creates semantic bindings for one generic analytical Arrow table.
    ///
    /// # Errors
    ///
    /// Returns [`GenericTableError`] when a name is invalid, duplicated across
    /// roles, no measure is bound, or a role exceeds its bounded column count.
    pub fn new(
        time_column: Option<String>,
        measure_columns: Vec<String>,
        dimension_columns: Vec<String>,
    ) -> Result<Self, GenericTableError> {
        if measure_columns.is_empty() {
            return Err(GenericTableError::MissingMeasureRole);
        }

        for (role, columns) in [
            ("measure", measure_columns.as_slice()),
            ("dimension", dimension_columns.as_slice()),
        ] {
            if columns.len() > MAXIMUM_COLUMNS_PER_ROLE {
                return Err(GenericTableError::TooManyRoleColumns {
                    role,
                    maximum: MAXIMUM_COLUMNS_PER_ROLE,
                    actual: columns.len(),
                });
            }
        }

        let mut names = HashSet::new();

        for name in time_column
            .iter()
            .chain(measure_columns.iter())
            .chain(dimension_columns.iter())
        {
            validate_role_name(name)?;

            if !names.insert(name.clone()) {
                return Err(GenericTableError::DuplicateRoleBinding { name: name.clone() });
            }
        }

        Ok(Self {
            time_column,
            measure_columns,
            dimension_columns,
        })
    }

    #[must_use]
    pub fn time_column(&self) -> Option<&str> {
        self.time_column.as_deref()
    }

    #[must_use]
    pub fn measure_columns(&self) -> &[String] {
        &self.measure_columns
    }

    #[must_use]
    pub fn dimension_columns(&self) -> &[String] {
        &self.dimension_columns
    }
}

#[derive(Debug, Error)]
pub enum GenericTableError {
    #[error("could not decode the Arrow IPC stream: {0}")]
    Ipc(#[from] ArrowError),

    #[error("at least one numeric measure role is required")]
    MissingMeasureRole,

    #[error("semantic role name `{name}` is invalid")]
    InvalidRoleName { name: String },

    #[error("Arrow column `{name}` is assigned to more than one semantic role")]
    DuplicateRoleBinding { name: String },

    #[error("semantic role `{role}` has {actual} columns; at most {maximum} are supported")]
    TooManyRoleColumns {
        role: &'static str,
        maximum: usize,
        actual: usize,
    },

    #[error("Arrow column `{name}` is missing")]
    MissingColumn { name: String },

    #[error("Arrow column `{name}` has unsupported type {actual:?} for role `{role}`")]
    UnsupportedColumnType {
        name: String,
        role: &'static str,
        actual: DataType,
    },

    #[error("Arrow column `{name}` contains {null_count} null values")]
    NullValues { name: String, null_count: usize },

    #[error("Arrow measure `{name}` contains a non-finite value at row {row}")]
    NonFiniteValue { name: String, row: usize },

    #[error("Arrow measure `{name}` contains integer {value} that cannot be represented exactly")]
    LossyInteger { name: String, value: String },

    #[error("Arrow time column `{name}` contains a value outside the millisecond range")]
    TimeOverflow { name: String },

    #[error("Arrow table contains {actual} rows; the safe maximum is {maximum}")]
    TooManyRows { maximum: usize, actual: usize },

    #[error("measure `{name}` is not bound")]
    UnknownMeasure { name: String },

    #[error("dimension `{name}` is not bound")]
    UnknownDimension { name: String },

    #[error("the operation requires a time role")]
    MissingTimeRole,

    #[error("the analytical table contains no rows")]
    EmptyTable,

    #[error("histogram bin count must be between 1 and {maximum}")]
    InvalidBinCount { maximum: usize },

    #[error("anomaly threshold must be finite and positive")]
    InvalidThreshold,

    #[error("the table contains more than u32::MAX distinct dimension values")]
    TooManyDimensionValues,
}

#[derive(Debug, Clone, PartialEq)]
struct NumericColumn {
    name: String,
    values: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq)]
struct DimensionColumn {
    name: String,
    indexes: Vec<u32>,
    labels: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AnalyticalTable {
    row_count: usize,
    times: Option<Vec<i64>>,
    measures: Vec<NumericColumn>,
    dimensions: Vec<DimensionColumn>,
}

impl AnalyticalTable {
    #[must_use]
    pub const fn row_count(&self) -> usize {
        self.row_count
    }

    #[must_use]
    pub const fn has_time(&self) -> bool {
        self.times.is_some()
    }

    pub fn measure_names(&self) -> impl Iterator<Item = &str> {
        self.measures.iter().map(|column| column.name.as_str())
    }

    pub fn dimension_names(&self) -> impl Iterator<Item = &str> {
        self.dimensions.iter().map(|column| column.name.as_str())
    }

    fn measure(&self, name: &str) -> Result<&NumericColumn, GenericTableError> {
        self.measures
            .iter()
            .find(|column| column.name == name)
            .ok_or_else(|| GenericTableError::UnknownMeasure {
                name: name.to_owned(),
            })
    }

    fn dimension(&self, name: &str) -> Result<&DimensionColumn, GenericTableError> {
        self.dimensions
            .iter()
            .find(|column| column.name == name)
            .ok_or_else(|| GenericTableError::UnknownDimension {
                name: name.to_owned(),
            })
    }

    /// Summarizes one bound numeric measure.
    ///
    /// # Errors
    ///
    /// Returns [`GenericTableError`] when the measure is unknown or the table
    /// is empty.
    pub fn summarize(&self, measure: &str) -> Result<NumericSummary, GenericTableError> {
        let values = &self.measure(measure)?.values;

        if values.is_empty() {
            return Err(GenericTableError::EmptyTable);
        }

        let mut minimum = values[0];
        let mut maximum = values[0];
        let mut mean = 0.0;
        let mut sum_of_squares = 0.0;

        for (index, value) in values.iter().copied().enumerate() {
            minimum = minimum.min(value);
            maximum = maximum.max(value);
            let count = usize_to_f64(index + 1);
            let delta = value - mean;
            mean += delta / count;
            sum_of_squares += delta * (value - mean);
        }

        let mut ordered = values.clone();
        ordered.sort_by(f64::total_cmp);

        Ok(NumericSummary {
            count: values.len(),
            minimum,
            maximum,
            mean,
            standard_deviation: (sum_of_squares / usize_to_f64(values.len())).sqrt(),
            q1: quantile(&ordered, 0.25),
            median: quantile(&ordered, 0.5),
            q3: quantile(&ordered, 0.75),
        })
    }

    /// Builds an equal-width distribution for one bound numeric measure.
    ///
    /// # Errors
    ///
    /// Returns [`GenericTableError`] for an unknown measure, empty table, or
    /// an unsafe bin count.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    pub fn distribution(
        &self,
        measure: &str,
        bin_count: usize,
    ) -> Result<Distribution, GenericTableError> {
        if bin_count == 0 || bin_count > MAXIMUM_BINS {
            return Err(GenericTableError::InvalidBinCount {
                maximum: MAXIMUM_BINS,
            });
        }

        let values = &self.measure(measure)?.values;

        if values.is_empty() {
            return Err(GenericTableError::EmptyTable);
        }

        let (minimum, maximum) = values
            .iter()
            .copied()
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(low, high), value| {
                (low.min(value), high.max(value))
            });

        if minimum.total_cmp(&maximum).is_eq() {
            return Ok(Distribution {
                bin_starts: vec![minimum],
                bin_ends: vec![maximum],
                counts: vec![u64::try_from(values.len()).unwrap_or(u64::MAX)],
            });
        }

        let width = (maximum - minimum) / usize_to_f64(bin_count);
        let mut counts = vec![0_u64; bin_count];

        for value in values {
            let scaled = ((*value - minimum) / width).floor();
            let index = if scaled >= usize_to_f64(bin_count) {
                bin_count - 1
            } else {
                scaled as usize
            };
            counts[index] += 1;
        }

        let mut bin_starts = Vec::with_capacity(bin_count);
        let mut bin_ends = Vec::with_capacity(bin_count);

        for index in 0..bin_count {
            bin_starts.push(minimum + usize_to_f64(index) * width);
            bin_ends.push(if index + 1 == bin_count {
                maximum
            } else {
                minimum + usize_to_f64(index + 1) * width
            });
        }

        Ok(Distribution {
            bin_starts,
            bin_ends,
            counts,
        })
    }

    /// Aggregates a numeric measure by a bound categorical dimension.
    ///
    /// # Errors
    ///
    /// Returns [`GenericTableError`] when either semantic binding is unknown.
    pub fn grouped_comparison(
        &self,
        measure: &str,
        dimension: &str,
        aggregation: Aggregation,
    ) -> Result<GroupComparison, GenericTableError> {
        let values = &self.measure(measure)?.values;
        let groups = self.dimension(dimension)?;

        if aggregation == Aggregation::Median {
            let mut grouped_samples = vec![Vec::new(); groups.labels.len()];

            for (row, value) in values.iter().copied().enumerate() {
                grouped_samples[groups.indexes[row] as usize].push(value);
            }

            let observation_counts = grouped_samples
                .iter()
                .map(|samples| u64::try_from(samples.len()).unwrap_or(u64::MAX))
                .collect();
            let grouped_values = grouped_samples
                .iter_mut()
                .map(|samples| {
                    samples.sort_by(f64::total_cmp);
                    quantile(samples, 0.5)
                })
                .collect();

            return Ok(GroupComparison {
                labels: groups.labels.clone(),
                values: grouped_values,
                observation_counts,
            });
        }

        let mut accumulators = vec![Accumulator::default(); groups.labels.len()];

        for (row, value) in values.iter().copied().enumerate() {
            accumulators[groups.indexes[row] as usize].push(value);
        }

        let grouped_values = accumulators
            .iter()
            .map(|accumulator| accumulator.value(aggregation))
            .collect();
        let observation_counts = accumulators
            .iter()
            .map(|accumulator| accumulator.count)
            .collect();

        Ok(GroupComparison {
            labels: groups.labels.clone(),
            values: grouped_values,
            observation_counts,
        })
    }

    /// Produces chronologically sorted columns for trend rendering or further
    /// local transforms.
    ///
    /// # Errors
    ///
    /// Returns [`GenericTableError`] when the time, measure, or optional
    /// dimension role is unavailable.
    pub fn trend_input(
        &self,
        measure: &str,
        dimension: Option<&str>,
    ) -> Result<TrendInput, GenericTableError> {
        let times = self
            .times
            .as_ref()
            .ok_or(GenericTableError::MissingTimeRole)?;
        let values = &self.measure(measure)?.values;
        let groups = dimension.map(|name| self.dimension(name)).transpose()?;
        let mut rows = (0..self.row_count).collect::<Vec<_>>();

        rows.sort_unstable_by(|left, right| {
            times[*left].cmp(&times[*right]).then_with(|| {
                groups
                    .map_or(0, |column| column.indexes[*left])
                    .cmp(&groups.map_or(0, |column| column.indexes[*right]))
            })
        });

        let mut sorted_times = Vec::with_capacity(self.row_count);
        let mut series_indexes = Vec::with_capacity(self.row_count);
        let mut sorted_values = Vec::with_capacity(self.row_count);

        for row in rows {
            sorted_times.push(times[row]);
            series_indexes.push(groups.map_or(0, |column| column.indexes[row]));
            sorted_values.push(values[row]);
        }

        Ok(TrendInput {
            epoch_milliseconds: sorted_times,
            series_indexes,
            series_names: groups.map_or_else(
                || vec!["All rows".to_owned()],
                |column| column.labels.clone(),
            ),
            values: sorted_values,
        })
    }

    /// Scores robust value anomalies independently within each optional group.
    ///
    /// # Errors
    ///
    /// Returns [`GenericTableError`] for unknown roles or a non-positive,
    /// non-finite threshold.
    pub fn robust_anomalies(
        &self,
        measure: &str,
        dimension: Option<&str>,
        threshold: f64,
    ) -> Result<RobustAnomalies, GenericTableError> {
        if !threshold.is_finite() || threshold <= 0.0 {
            return Err(GenericTableError::InvalidThreshold);
        }

        let values = &self.measure(measure)?.values;
        let groups = dimension.map(|name| self.dimension(name)).transpose()?;
        let group_count = groups.map_or(1, |column| column.labels.len());
        let mut rows_by_group = vec![Vec::new(); group_count];

        for row in 0..self.row_count {
            let group = groups.map_or(0, |column| column.indexes[row] as usize);
            rows_by_group[group].push(row);
        }

        let mut expected = vec![0.0; self.row_count];
        let mut scores = vec![0.0; self.row_count];
        let mut validity = vec![0_u8; self.row_count];
        let mut flags = vec![0_u8; self.row_count];

        for rows in rows_by_group {
            if rows.len() < 4 {
                continue;
            }

            let mut group_values = rows.iter().map(|row| values[*row]).collect::<Vec<_>>();
            group_values.sort_by(f64::total_cmp);
            let center = quantile(&group_values, 0.5);
            let mut deviations = group_values
                .iter()
                .map(|value| (*value - center).abs())
                .collect::<Vec<_>>();
            deviations.sort_by(f64::total_cmp);
            let mad = quantile(&deviations, 0.5);

            for row in rows {
                expected[row] = center;
                validity[row] = 1;
                let difference = values[row] - center;

                if mad > f64::EPSILON {
                    scores[row] = 0.674_489_75 * difference / mad;
                    flags[row] = u8::from(scores[row].abs() >= threshold);
                } else if difference.abs() > f64::EPSILON {
                    scores[row] = (threshold + 1.0).copysign(difference);
                    flags[row] = 1;
                }
            }
        }

        Ok(RobustAnomalies {
            expected,
            scores,
            validity,
            flags,
        })
    }

    /// Calculates a numerically stable Pearson correlation between two bound
    /// measures.
    ///
    /// # Errors
    ///
    /// Returns [`GenericTableError`] when either measure is unknown.
    pub fn correlation(
        &self,
        left_measure: &str,
        right_measure: &str,
    ) -> Result<Correlation, GenericTableError> {
        let left = &self.measure(left_measure)?.values;
        let right = &self.measure(right_measure)?.values;
        let mut mean_left = 0.0;
        let mut mean_right = 0.0;
        let mut left_moment = 0.0;
        let mut right_moment = 0.0;
        let mut co_moment = 0.0;

        for (index, (left_value, right_value)) in left.iter().zip(right.iter()).enumerate() {
            let count = usize_to_f64(index + 1);
            let left_delta = *left_value - mean_left;
            mean_left += left_delta / count;
            let right_delta = *right_value - mean_right;
            mean_right += right_delta / count;
            left_moment += left_delta * (*left_value - mean_left);
            right_moment += right_delta * (*right_value - mean_right);
            co_moment += left_delta * (*right_value - mean_right);
        }

        let coefficient =
            if left.len() < 2 || left_moment <= f64::EPSILON || right_moment <= f64::EPSILON {
                None
            } else {
                Some((co_moment / (left_moment * right_moment).sqrt()).clamp(-1.0, 1.0))
            };

        Ok(Correlation {
            pair_count: left.len(),
            coefficient,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct NumericSummary {
    count: usize,
    minimum: f64,
    maximum: f64,
    mean: f64,
    standard_deviation: f64,
    q1: f64,
    median: f64,
    q3: f64,
}

impl NumericSummary {
    #[must_use]
    pub const fn count(&self) -> usize {
        self.count
    }

    #[must_use]
    pub const fn minimum(&self) -> f64 {
        self.minimum
    }

    #[must_use]
    pub const fn maximum(&self) -> f64 {
        self.maximum
    }

    #[must_use]
    pub const fn mean(&self) -> f64 {
        self.mean
    }

    #[must_use]
    pub const fn standard_deviation(&self) -> f64 {
        self.standard_deviation
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
}

#[derive(Debug, Clone, PartialEq)]
pub struct Distribution {
    bin_starts: Vec<f64>,
    bin_ends: Vec<f64>,
    counts: Vec<u64>,
}

impl Distribution {
    #[must_use]
    pub fn bin_starts(&self) -> &[f64] {
        &self.bin_starts
    }

    #[must_use]
    pub fn bin_ends(&self) -> &[f64] {
        &self.bin_ends
    }

    #[must_use]
    pub fn counts(&self) -> &[u64] {
        &self.counts
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Aggregation {
    Count,
    Sum,
    Mean,
    Median,
    Minimum,
    Maximum,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GroupComparison {
    labels: Vec<String>,
    values: Vec<f64>,
    observation_counts: Vec<u64>,
}

impl GroupComparison {
    #[must_use]
    pub fn labels(&self) -> &[String] {
        &self.labels
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
pub struct TrendInput {
    epoch_milliseconds: Vec<i64>,
    series_indexes: Vec<u32>,
    series_names: Vec<String>,
    values: Vec<f64>,
}

impl TrendInput {
    #[must_use]
    pub fn epoch_milliseconds(&self) -> &[i64] {
        &self.epoch_milliseconds
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
}

#[derive(Debug, Clone, PartialEq)]
pub struct RobustAnomalies {
    expected: Vec<f64>,
    scores: Vec<f64>,
    validity: Vec<u8>,
    flags: Vec<u8>,
}

impl RobustAnomalies {
    #[must_use]
    pub fn expected(&self) -> &[f64] {
        &self.expected
    }

    #[must_use]
    pub fn scores(&self) -> &[f64] {
        &self.scores
    }

    #[must_use]
    pub fn validity(&self) -> &[u8] {
        &self.validity
    }

    #[must_use]
    pub fn flags(&self) -> &[u8] {
        &self.flags
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Correlation {
    pair_count: usize,
    coefficient: Option<f64>,
}

impl Correlation {
    #[must_use]
    pub const fn pair_count(&self) -> usize {
        self.pair_count
    }

    #[must_use]
    pub const fn coefficient(&self) -> Option<f64> {
        self.coefficient
    }
}

#[derive(Debug, Clone, Default)]
struct Accumulator {
    count: u64,
    sum: f64,
    compensation: f64,
    minimum: Option<f64>,
    maximum: Option<f64>,
}

impl Accumulator {
    fn push(&mut self, value: f64) {
        self.count += 1;
        let corrected = value - self.compensation;
        let next = self.sum + corrected;
        self.compensation = (next - self.sum) - corrected;
        self.sum = next;
        self.minimum = Some(self.minimum.map_or(value, |current| current.min(value)));
        self.maximum = Some(self.maximum.map_or(value, |current| current.max(value)));
    }

    #[allow(clippy::cast_precision_loss)]
    fn value(&self, aggregation: Aggregation) -> f64 {
        match aggregation {
            Aggregation::Count => self.count as f64,
            Aggregation::Sum => self.sum,
            Aggregation::Mean if self.count > 0 => self.sum / self.count as f64,
            Aggregation::Median => unreachable!("median uses grouped samples"),
            Aggregation::Minimum => self.minimum.unwrap_or(0.0),
            Aggregation::Maximum => self.maximum.unwrap_or(0.0),
            Aggregation::Mean => 0.0,
        }
    }
}

fn validate_role_name(name: &str) -> Result<(), GenericTableError> {
    let valid = !name.is_empty()
        && name.len() <= 128
        && name
            .chars()
            .all(|character| character == '_' || character.is_ascii_alphanumeric());

    if valid {
        Ok(())
    } else {
        Err(GenericTableError::InvalidRoleName {
            name: name.to_owned(),
        })
    }
}

fn require_column<'a>(
    batch: &'a RecordBatch,
    name: &str,
) -> Result<&'a dyn Array, GenericTableError> {
    batch
        .column_by_name(name)
        .map(AsRef::as_ref)
        .ok_or_else(|| GenericTableError::MissingColumn {
            name: name.to_owned(),
        })
}

fn require_no_nulls(column: &dyn Array, name: &str) -> Result<(), GenericTableError> {
    let null_count = column.null_count();

    if null_count == 0 {
        Ok(())
    } else {
        Err(GenericTableError::NullValues {
            name: name.to_owned(),
            null_count,
        })
    }
}

fn unsupported_type(name: &str, role: &'static str, actual: &DataType) -> GenericTableError {
    GenericTableError::UnsupportedColumnType {
        name: name.to_owned(),
        role,
        actual: actual.clone(),
    }
}

fn typed_array<'a, T: 'static>(
    column: &'a dyn Array,
    name: &str,
    role: &'static str,
) -> Result<&'a T, GenericTableError> {
    column
        .as_any()
        .downcast_ref::<T>()
        .ok_or_else(|| unsupported_type(name, role, column.data_type()))
}

#[allow(clippy::cast_precision_loss)]
fn append_numeric(
    column: &dyn Array,
    name: &str,
    target: &mut Vec<f64>,
) -> Result<(), GenericTableError> {
    require_no_nulls(column, name)?;
    let start = target.len();

    match column.data_type() {
        DataType::Float64 => target.extend(
            typed_array::<Float64Array>(column, name, "measure")?
                .values()
                .iter()
                .copied(),
        ),
        DataType::Float32 => target.extend(
            typed_array::<Float32Array>(column, name, "measure")?
                .values()
                .iter()
                .copied()
                .map(f64::from),
        ),
        DataType::Int8 => target.extend(
            typed_array::<Int8Array>(column, name, "measure")?
                .values()
                .iter()
                .copied()
                .map(f64::from),
        ),
        DataType::Int16 => target.extend(
            typed_array::<Int16Array>(column, name, "measure")?
                .values()
                .iter()
                .copied()
                .map(f64::from),
        ),
        DataType::Int32 => target.extend(
            typed_array::<Int32Array>(column, name, "measure")?
                .values()
                .iter()
                .copied()
                .map(f64::from),
        ),
        DataType::UInt8 => target.extend(
            typed_array::<UInt8Array>(column, name, "measure")?
                .values()
                .iter()
                .copied()
                .map(f64::from),
        ),
        DataType::UInt16 => target.extend(
            typed_array::<UInt16Array>(column, name, "measure")?
                .values()
                .iter()
                .copied()
                .map(f64::from),
        ),
        DataType::UInt32 => target.extend(
            typed_array::<UInt32Array>(column, name, "measure")?
                .values()
                .iter()
                .copied()
                .map(f64::from),
        ),
        DataType::Int64 => {
            for value in typed_array::<Int64Array>(column, name, "measure")?.values() {
                if value.unsigned_abs() > MAXIMUM_EXACT_INTEGER {
                    return Err(GenericTableError::LossyInteger {
                        name: name.to_owned(),
                        value: value.to_string(),
                    });
                }
                target.push(*value as f64);
            }
        }
        DataType::UInt64 => {
            for value in typed_array::<UInt64Array>(column, name, "measure")?.values() {
                if *value > MAXIMUM_EXACT_INTEGER {
                    return Err(GenericTableError::LossyInteger {
                        name: name.to_owned(),
                        value: value.to_string(),
                    });
                }
                target.push(*value as f64);
            }
        }
        actual => return Err(unsupported_type(name, "measure", actual)),
    }

    if let Some(offset) = target[start..].iter().position(|value| !value.is_finite()) {
        return Err(GenericTableError::NonFiniteValue {
            name: name.to_owned(),
            row: start + offset,
        });
    }

    Ok(())
}

fn append_time(
    column: &dyn Array,
    name: &str,
    target: &mut Vec<i64>,
) -> Result<(), GenericTableError> {
    require_no_nulls(column, name)?;

    match column.data_type() {
        DataType::Date32 => {
            for value in typed_array::<Date32Array>(column, name, "time")?.values() {
                target.push(
                    i64::from(*value)
                        .checked_mul(MILLIS_PER_DAY)
                        .ok_or_else(|| GenericTableError::TimeOverflow {
                            name: name.to_owned(),
                        })?,
                );
            }
        }
        DataType::Date64 => target.extend(
            typed_array::<Date64Array>(column, name, "time")?
                .values()
                .iter()
                .copied(),
        ),
        DataType::Timestamp(arrow_schema::TimeUnit::Second, _) => {
            for value in typed_array::<TimestampSecondArray>(column, name, "time")?.values() {
                target.push(value.checked_mul(1_000).ok_or_else(|| {
                    GenericTableError::TimeOverflow {
                        name: name.to_owned(),
                    }
                })?);
            }
        }
        DataType::Timestamp(arrow_schema::TimeUnit::Millisecond, _) => target.extend(
            typed_array::<TimestampMillisecondArray>(column, name, "time")?
                .values()
                .iter()
                .copied(),
        ),
        DataType::Timestamp(arrow_schema::TimeUnit::Microsecond, _) => target.extend(
            typed_array::<TimestampMicrosecondArray>(column, name, "time")?
                .values()
                .iter()
                .map(|value| value.div_euclid(1_000)),
        ),
        DataType::Timestamp(arrow_schema::TimeUnit::Nanosecond, _) => target.extend(
            typed_array::<TimestampNanosecondArray>(column, name, "time")?
                .values()
                .iter()
                .map(|value| value.div_euclid(1_000_000)),
        ),
        actual => return Err(unsupported_type(name, "time", actual)),
    }

    Ok(())
}

fn append_dimension(
    column: &dyn Array,
    name: &str,
    indexes: &mut Vec<u32>,
    labels: &mut Vec<String>,
    lookup: &mut HashMap<String, u32>,
) -> Result<(), GenericTableError> {
    require_no_nulls(column, name)?;

    match column.data_type() {
        DataType::Utf8 => {
            let strings = typed_array::<StringArray>(column, name, "dimension")?;

            for value in strings.iter().flatten() {
                indexes.push(intern_dimension(value, labels, lookup)?);
            }
        }
        DataType::LargeUtf8 => {
            let strings = typed_array::<LargeStringArray>(column, name, "dimension")?;

            for value in strings.iter().flatten() {
                indexes.push(intern_dimension(value, labels, lookup)?);
            }
        }
        actual => return Err(unsupported_type(name, "dimension", actual)),
    }

    Ok(())
}

fn intern_dimension(
    value: &str,
    labels: &mut Vec<String>,
    lookup: &mut HashMap<String, u32>,
) -> Result<u32, GenericTableError> {
    if let Some(index) = lookup.get(value) {
        return Ok(*index);
    }

    let index =
        u32::try_from(labels.len()).map_err(|_| GenericTableError::TooManyDimensionValues)?;
    let owned = value.to_owned();
    labels.push(owned.clone());
    lookup.insert(owned, index);
    Ok(index)
}

/// Decodes selected Arrow columns according to semantic analytical roles.
///
/// Physical column names are deliberately separate from their roles: any
/// compatible dataset can bind its own time, measure, and dimension columns
/// without introducing property-specific row types.
///
/// # Errors
///
/// Returns [`GenericTableError`] when the IPC stream is invalid, a semantic
/// binding is missing or has an incompatible type, values are unsafe, or the
/// one-million-row browser budget is exceeded.
pub fn decode_analytical_table(
    bytes: &[u8],
    schema: &SemanticSchema,
) -> Result<AnalyticalTable, GenericTableError> {
    let reader = StreamReader::try_new(Cursor::new(bytes), None)?;
    let arrow_schema = reader.schema();

    for (role, names) in [
        ("measure", schema.measure_columns()),
        ("dimension", schema.dimension_columns()),
    ] {
        for name in names {
            let field = arrow_schema
                .field_with_name(name)
                .map_err(|_| GenericTableError::MissingColumn { name: name.clone() })?;
            validate_physical_type(field.data_type(), role, name)?;
        }
    }

    if let Some(name) = schema.time_column() {
        let field =
            arrow_schema
                .field_with_name(name)
                .map_err(|_| GenericTableError::MissingColumn {
                    name: name.to_owned(),
                })?;
        validate_physical_type(field.data_type(), "time", name)?;
    }

    let mut times = schema.time_column().map(|_| Vec::new());
    let mut measures = schema
        .measure_columns()
        .iter()
        .map(|name| NumericColumn {
            name: name.clone(),
            values: Vec::new(),
        })
        .collect::<Vec<_>>();
    let mut dimensions = schema
        .dimension_columns()
        .iter()
        .map(|name| DimensionColumn {
            name: name.clone(),
            indexes: Vec::new(),
            labels: Vec::new(),
        })
        .collect::<Vec<_>>();
    let mut dimension_lookups = (0..dimensions.len())
        .map(|_| HashMap::<String, u32>::new())
        .collect::<Vec<_>>();
    let mut row_count = 0_usize;

    for batch in reader {
        let batch = batch?;
        row_count =
            row_count
                .checked_add(batch.num_rows())
                .ok_or(GenericTableError::TooManyRows {
                    maximum: MAXIMUM_ROWS,
                    actual: usize::MAX,
                })?;

        if row_count > MAXIMUM_ROWS {
            return Err(GenericTableError::TooManyRows {
                maximum: MAXIMUM_ROWS,
                actual: row_count,
            });
        }

        if let (Some(name), Some(target)) = (schema.time_column(), times.as_mut()) {
            append_time(require_column(&batch, name)?, name, target)?;
        }

        for measure in &mut measures {
            append_numeric(
                require_column(&batch, &measure.name)?,
                &measure.name,
                &mut measure.values,
            )?;
        }

        for (index, dimension) in dimensions.iter_mut().enumerate() {
            append_dimension(
                require_column(&batch, &dimension.name)?,
                &dimension.name,
                &mut dimension.indexes,
                &mut dimension.labels,
                &mut dimension_lookups[index],
            )?;
        }
    }

    Ok(AnalyticalTable {
        row_count,
        times,
        measures,
        dimensions,
    })
}

fn validate_physical_type(
    data_type: &DataType,
    role: &'static str,
    name: &str,
) -> Result<(), GenericTableError> {
    let valid = match role {
        "measure" => matches!(
            data_type,
            DataType::Float64
                | DataType::Float32
                | DataType::Int8
                | DataType::Int16
                | DataType::Int32
                | DataType::Int64
                | DataType::UInt8
                | DataType::UInt16
                | DataType::UInt32
                | DataType::UInt64
        ),
        "dimension" => matches!(data_type, DataType::Utf8 | DataType::LargeUtf8),
        "time" => matches!(
            data_type,
            DataType::Date32 | DataType::Date64 | DataType::Timestamp(_, _)
        ),
        _ => false,
    };

    if valid {
        Ok(())
    } else {
        Err(unsupported_type(name, role, data_type))
    }
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn quantile(sorted: &[f64], probability: f64) -> f64 {
    if sorted.len() == 1 {
        return sorted[0];
    }

    let position = probability * usize_to_f64(sorted.len() - 1);
    let lower = position.floor() as usize;
    let upper = position.ceil() as usize;
    let weight = position - usize_to_f64(lower);

    sorted[lower] + (sorted[upper] - sorted[lower]) * weight
}

#[allow(clippy::cast_precision_loss)]
fn usize_to_f64(value: usize) -> f64 {
    value as f64
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow_array::{ArrayRef, Date32Array, Float64Array, Int64Array, RecordBatch, StringArray};
    use arrow_ipc::writer::StreamWriter;
    use arrow_schema::{DataType, Field, Schema};

    use super::{Aggregation, GenericTableError, SemanticSchema, decode_analytical_table};

    fn fixture() -> Vec<u8> {
        let schema = Arc::new(Schema::new(vec![
            Field::new("when", DataType::Date32, false),
            Field::new("revenue", DataType::Float64, false),
            Field::new("cost", DataType::Int64, false),
            Field::new("segment", DataType::Utf8, false),
            Field::new("ignored", DataType::Utf8, false),
        ]));
        let batch = RecordBatch::try_new(
            Arc::clone(&schema),
            vec![
                Arc::new(Date32Array::from(vec![3, 1, 2, 4, 5, 6, 7, 8])) as ArrayRef,
                Arc::new(Float64Array::from(vec![
                    30.0, 10.0, 20.0, 40.0, 50.0, 60.0, 70.0, 800.0,
                ])),
                Arc::new(Int64Array::from(vec![3, 1, 2, 4, 5, 6, 7, 80])),
                Arc::new(StringArray::from(vec![
                    "B", "A", "A", "B", "A", "B", "A", "B",
                ])),
                Arc::new(StringArray::from(vec!["x"; 8])),
            ],
        )
        .expect("fixture columns should match");
        let mut bytes = Vec::new();
        let mut writer =
            StreamWriter::try_new(&mut bytes, &schema).expect("writer should initialize");
        writer.write(&batch).expect("fixture should serialize");
        writer.finish().expect("stream should finish");
        drop(writer);
        bytes
    }

    fn table() -> super::AnalyticalTable {
        let schema = SemanticSchema::new(
            Some("when".to_owned()),
            vec!["revenue".to_owned(), "cost".to_owned()],
            vec!["segment".to_owned()],
        )
        .expect("semantic schema should be valid");
        decode_analytical_table(&fixture(), &schema).expect("fixture should decode")
    }

    #[test]
    fn decodes_only_semantically_bound_columns() {
        let table = table();

        assert_eq!(table.row_count(), 8);
        assert!(table.has_time());
        assert_eq!(
            table.measure_names().collect::<Vec<_>>(),
            ["revenue", "cost"]
        );
        assert_eq!(table.dimension_names().collect::<Vec<_>>(), ["segment"]);
    }

    #[test]
    fn summarizes_and_builds_a_distribution() {
        let table = table();
        let summary = table.summarize("revenue").expect("summary should work");
        let distribution = table
            .distribution("revenue", 4)
            .expect("distribution should work");

        assert_eq!(summary.count(), 8);
        assert!((summary.minimum() - 10.0).abs() < f64::EPSILON);
        assert!((summary.maximum() - 800.0).abs() < f64::EPSILON);
        assert_eq!(distribution.counts().iter().sum::<u64>(), 8);
    }

    #[test]
    fn compares_groups_with_declared_aggregation() {
        let table = table();
        let comparison = table
            .grouped_comparison("revenue", "segment", Aggregation::Mean)
            .expect("group comparison should work");
        let medians = table
            .grouped_comparison("revenue", "segment", Aggregation::Median)
            .expect("group medians should work");

        assert_eq!(comparison.labels(), ["B", "A"]);
        assert_eq!(comparison.observation_counts(), &[4, 4]);
        assert!((comparison.values()[0] - 232.5).abs() < f64::EPSILON);
        assert!((comparison.values()[1] - 37.5).abs() < f64::EPSILON);
        assert!((medians.values()[0] - 50.0).abs() < f64::EPSILON);
        assert!((medians.values()[1] - 35.0).abs() < f64::EPSILON);
    }

    #[test]
    fn prepares_sorted_trend_columns() {
        let table = table();
        let trend = table
            .trend_input("revenue", Some("segment"))
            .expect("trend input should work");

        assert!(
            trend
                .epoch_milliseconds()
                .windows(2)
                .all(|window| window[0] <= window[1])
        );
        assert!((trend.values()[0] - 10.0).abs() < f64::EPSILON);
        assert_eq!(trend.series_names(), ["B", "A"]);
    }

    #[test]
    fn detects_robust_group_anomalies() {
        let table = table();
        let anomalies = table
            .robust_anomalies("revenue", Some("segment"), 3.5)
            .expect("anomaly scoring should work");

        assert_eq!(anomalies.validity().iter().sum::<u8>(), 8);
        assert_eq!(anomalies.flags()[7], 1);
    }

    #[test]
    fn calculates_two_measure_correlation() {
        let table = table();
        let correlation = table
            .correlation("revenue", "cost")
            .expect("correlation should work");

        assert_eq!(correlation.pair_count(), 8);
        assert!(correlation.coefficient().is_some_and(|value| value > 0.999));
    }

    #[test]
    fn rejects_duplicate_semantic_bindings() {
        assert!(matches!(
            SemanticSchema::new(Some("value".to_owned()), vec!["value".to_owned()], vec![]),
            Err(GenericTableError::DuplicateRoleBinding { .. })
        ));
    }

    #[test]
    fn rejects_lossy_integer_measures() {
        let schema = Arc::new(Schema::new(vec![Field::new(
            "value",
            DataType::Int64,
            false,
        )]));
        let batch = RecordBatch::try_new(
            Arc::clone(&schema),
            vec![Arc::new(Int64Array::from(vec![(1_i64 << 53) + 1]))],
        )
        .expect("fixture should match");
        let mut bytes = Vec::new();
        let mut writer =
            StreamWriter::try_new(&mut bytes, &schema).expect("writer should initialize");
        writer.write(&batch).expect("batch should serialize");
        writer.finish().expect("stream should finish");
        drop(writer);
        let roles =
            SemanticSchema::new(None, vec!["value".to_owned()], vec![]).expect("valid roles");

        assert!(matches!(
            decode_analytical_table(&bytes, &roles),
            Err(GenericTableError::LossyInteger { .. })
        ));
    }
}
