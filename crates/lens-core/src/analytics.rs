use std::collections::HashMap;

use chrono::{Datelike, Duration, NaiveDate};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Interval {
    Year,
    Quarter,
    Month,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DerivedValues {
    values: Vec<f64>,
    validity: Vec<u8>,
}

impl DerivedValues {
    #[must_use]
    pub fn values(&self) -> &[f64] {
        &self.values
    }

    #[must_use]
    pub fn validity(&self) -> &[u8] {
        &self.validity
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AnomalyValues {
    expected: Vec<f64>,
    scores: Vec<f64>,
    validity: Vec<u8>,
    flags: Vec<u8>,
}

impl AnomalyValues {
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

#[derive(Debug, Error)]
pub enum AnalyticsError {
    #[error("analysis columns have different lengths")]
    LengthMismatch,

    #[error("period value {period} is outside the supported date range")]
    InvalidPeriod { period: i32 },

    #[error("anomaly threshold must be finite and positive")]
    InvalidThreshold,
}

fn validate_lengths(lengths: &[usize]) -> Result<usize, AnalyticsError> {
    let Some(first) = lengths.first().copied() else {
        return Ok(0);
    };

    if lengths.iter().any(|length| *length != first) {
        return Err(AnalyticsError::LengthMismatch);
    }

    Ok(first)
}

fn date_from_days(period: i32) -> Result<NaiveDate, AnalyticsError> {
    NaiveDate::from_ymd_opt(1970, 1, 1)
        .and_then(|epoch| epoch.checked_add_signed(Duration::days(i64::from(period))))
        .ok_or(AnalyticsError::InvalidPeriod { period })
}

fn period_key(period: i32, interval: Interval) -> Result<(i32, u32), AnalyticsError> {
    let date = date_from_days(period)?;
    let subperiod = match interval {
        Interval::Year => 1,
        Interval::Quarter => date.month0() / 3 + 1,
        Interval::Month => date.month(),
    };

    Ok((date.year(), subperiod))
}

fn previous_key((year, subperiod): (i32, u32), interval: Interval) -> (i32, u32) {
    match interval {
        Interval::Year => (year - 1, 1),
        Interval::Quarter | Interval::Month if subperiod > 1 => (year, subperiod - 1),
        Interval::Quarter => (year - 1, 4),
        Interval::Month => (year - 1, 12),
    }
}

fn seasonal_previous_key((year, subperiod): (i32, u32), interval: Interval) -> (i32, u32) {
    match interval {
        Interval::Month => (year - 1, subperiod),
        Interval::Year | Interval::Quarter => previous_key((year, subperiod), interval),
    }
}

fn median(values: &mut [f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }

    values.sort_by(f64::total_cmp);
    let middle = values.len() / 2;

    if values.len() % 2 == 0 {
        Some(f64::midpoint(values[middle - 1], values[middle]))
    } else {
        Some(values[middle])
    }
}

/// Calculates adjacent period-over-period percentage changes by series.
///
/// # Errors
///
/// Returns [`AnalyticsError`] when input columns have different lengths or a period is invalid.
pub fn period_changes(
    periods: &[i32],
    series_indexes: &[u32],
    values: &[f64],
    interval: Interval,
) -> Result<DerivedValues, AnalyticsError> {
    let row_count = validate_lengths(&[periods.len(), series_indexes.len(), values.len()])?;
    let mut lookup = HashMap::with_capacity(row_count);
    let mut keys = Vec::with_capacity(row_count);

    for row in 0..row_count {
        let key = period_key(periods[row], interval)?;
        lookup.insert((series_indexes[row], key), row);
        keys.push(key);
    }

    let mut derived = vec![0.0; row_count];
    let mut validity = vec![0; row_count];

    for row in 0..row_count {
        let previous = previous_key(keys[row], interval);
        let Some(previous_row) = lookup.get(&(series_indexes[row], previous)).copied() else {
            continue;
        };
        let denominator = values[previous_row];

        if denominator == 0.0 {
            continue;
        }

        derived[row] = ((values[row] - denominator) / denominator.abs()) * 100.0;
        validity[row] = 1;
    }

    Ok(DerivedValues {
        values: derived,
        validity,
    })
}

/// Normalizes additive values to percentages within each period.
///
/// # Errors
///
/// Returns [`AnalyticsError`] when input columns have different lengths.
pub fn composition_shares(
    periods: &[i32],
    values: &[f64],
) -> Result<DerivedValues, AnalyticsError> {
    let row_count = validate_lengths(&[periods.len(), values.len()])?;
    let mut totals = HashMap::<i32, f64>::new();

    for row in 0..row_count {
        *totals.entry(periods[row]).or_default() += values[row];
    }

    let mut shares = vec![0.0; row_count];
    let mut validity = vec![0; row_count];

    for row in 0..row_count {
        let total = totals[&periods[row]];

        if total > 0.0 {
            shares[row] = values[row] / total * 100.0;
            validity[row] = 1;
        }
    }

    Ok(DerivedValues {
        values: shares,
        validity,
    })
}

/// Scores robust seasonal changes using the median absolute deviation.
///
/// # Errors
///
/// Returns [`AnalyticsError`] when columns differ in length, a period is invalid, or the threshold
/// is not finite and positive.
pub fn anomaly_scores(
    periods: &[i32],
    series_indexes: &[u32],
    values: &[f64],
    observation_counts: &[u64],
    interval: Interval,
    threshold: f64,
) -> Result<AnomalyValues, AnalyticsError> {
    if !threshold.is_finite() || threshold <= 0.0 {
        return Err(AnalyticsError::InvalidThreshold);
    }

    let row_count = validate_lengths(&[
        periods.len(),
        series_indexes.len(),
        values.len(),
        observation_counts.len(),
    ])?;
    let mut lookup = HashMap::with_capacity(row_count);
    let mut keys = Vec::with_capacity(row_count);
    let mut rows_by_series = HashMap::<u32, Vec<usize>>::new();

    for row in 0..row_count {
        let key = period_key(periods[row], interval)?;
        lookup.insert((series_indexes[row], key), row);
        keys.push(key);
        rows_by_series
            .entry(series_indexes[row])
            .or_default()
            .push(row);
    }

    let mut expected = vec![0.0; row_count];
    let mut scores = vec![0.0; row_count];
    let mut validity = vec![0; row_count];
    let mut flags = vec![0; row_count];

    for rows in rows_by_series.values() {
        let mut changes = Vec::<(usize, f64, f64)>::new();

        for &row in rows {
            if observation_counts[row] < 30 {
                continue;
            }

            let previous = seasonal_previous_key(keys[row], interval);
            let Some(previous_row) = lookup.get(&(series_indexes[row], previous)).copied() else {
                continue;
            };

            if observation_counts[previous_row] < 30 || values[previous_row] == 0.0 {
                continue;
            }

            let change = (values[row] - values[previous_row]) / values[previous_row].abs();
            changes.push((row, change, values[previous_row]));
        }

        if changes.len() < 4 {
            continue;
        }

        let mut change_values = changes
            .iter()
            .map(|(_, change, _)| *change)
            .collect::<Vec<_>>();
        let Some(center) = median(&mut change_values) else {
            continue;
        };
        let mut deviations = changes
            .iter()
            .map(|(_, change, _)| (change - center).abs())
            .collect::<Vec<_>>();
        let Some(mad) = median(&mut deviations) else {
            continue;
        };

        for (row, change, previous_value) in changes {
            expected[row] = previous_value * (1.0 + center);
            validity[row] = 1;

            if mad > f64::EPSILON {
                scores[row] = 0.674_489_75 * (change - center) / mad;
                flags[row] = u8::from(scores[row].abs() >= threshold);
            } else if (change - center).abs() > f64::EPSILON {
                scores[row] = (threshold + 1.0).copysign(change - center);
                flags[row] = 1;
            }
        }
    }

    Ok(AnomalyValues {
        expected,
        scores,
        validity,
        flags,
    })
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDate;

    use super::{Interval, anomaly_scores, composition_shares, period_changes};

    fn day(year: i32, month: u32, day: u32) -> i32 {
        let epoch = NaiveDate::from_ymd_opt(1970, 1, 1).expect("epoch should exist");
        let date = NaiveDate::from_ymd_opt(year, month, day).expect("test date should exist");
        i32::try_from((date - epoch).num_days()).expect("test date should fit Date32")
    }

    #[test]
    fn calculates_only_adjacent_period_changes() {
        let result = period_changes(
            &[day(2020, 1, 1), day(2021, 1, 1), day(2023, 1, 1)],
            &[0, 0, 0],
            &[100.0, 125.0, 200.0],
            Interval::Year,
        )
        .expect("valid columns should calculate");

        assert_eq!(result.validity(), &[0, 1, 0]);
        assert!((result.values()[1] - 25.0).abs() < f64::EPSILON);
    }

    #[test]
    fn composition_sums_to_one_hundred_per_period() {
        let result = composition_shares(&[1, 1, 2, 2], &[1.0, 3.0, 2.0, 2.0])
            .expect("valid columns should calculate");

        assert_eq!(result.values(), &[25.0, 75.0, 50.0, 50.0]);
        assert!(result.validity().iter().all(|valid| *valid == 1));
    }

    #[test]
    fn robust_scores_flag_a_large_seasonal_change() {
        let periods = (2018..=2024)
            .map(|year| day(year, 1, 1))
            .collect::<Vec<_>>();
        let result = anomaly_scores(
            &periods,
            &[0, 0, 0, 0, 0, 0, 0],
            &[100.0, 105.0, 110.0, 116.0, 122.0, 128.0, 260.0],
            &[100; 7],
            Interval::Year,
            3.5,
        )
        .expect("valid columns should score");

        assert_eq!(result.flags().last(), Some(&1));
        assert_eq!(result.validity().last(), Some(&1));
    }

    #[test]
    fn zero_mad_fallback_flags_a_spike_after_stable_growth() {
        let periods = (2018..=2023)
            .map(|year| day(year, 1, 1))
            .collect::<Vec<_>>();
        let result = anomaly_scores(
            &periods,
            &[0, 0, 0, 0, 0, 0],
            &[100.0, 100.0, 100.0, 100.0, 100.0, 200.0],
            &[100; 6],
            Interval::Year,
            3.5,
        )
        .expect("valid columns should score");

        assert_eq!(result.flags().last(), Some(&1));
        assert!(result.scores().last().is_some_and(|score| *score > 3.5));
    }
}
