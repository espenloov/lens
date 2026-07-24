export type TimeSeriesScale = {
  readonly fullMinimum: number;
  readonly fullMaximum: number;
  readonly focusMinimum: number;
  readonly focusMaximum: number;
  readonly clippedCount: number;
};

function quantile(sorted: readonly number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;

  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function calculateTimeSeriesScale(
  values: readonly number[],
  allowFocusedScale: boolean,
): TimeSeriesScale {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
  const fullMinimum = finite[0] ?? 0;
  const fullMaximum = finite.at(-1) ?? 1;

  if (!allowFocusedScale || finite.length < 8 || fullMinimum === fullMaximum) {
    return {
      fullMinimum,
      fullMaximum,
      focusMinimum: fullMinimum,
      focusMaximum: fullMaximum,
      clippedCount: 0,
    };
  }

  const lowerQuartile = quantile(finite, 0.25);
  const upperQuartile = quantile(finite, 0.75);
  const interquartileRange = upperQuartile - lowerQuartile;

  if (interquartileRange <= 0) {
    return {
      fullMinimum,
      fullMaximum,
      focusMinimum: fullMinimum,
      focusMaximum: fullMaximum,
      clippedCount: 0,
    };
  }

  const lowerFence = lowerQuartile - interquartileRange * 3;
  const upperFence = upperQuartile + interquartileRange * 3;
  const focusedValues = finite.filter(
    (value) => value >= lowerFence && value <= upperFence,
  );

  if (focusedValues.length < Math.max(4, finite.length * 0.6)) {
    return {
      fullMinimum,
      fullMaximum,
      focusMinimum: fullMinimum,
      focusMaximum: fullMaximum,
      clippedCount: 0,
    };
  }

  return {
    fullMinimum,
    fullMaximum,
    focusMinimum: focusedValues[0],
    focusMaximum: focusedValues.at(-1) ?? focusedValues[0],
    clippedCount: finite.length - focusedValues.length,
  };
}
