const gbpFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

const compactGbpFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  notation: "compact",
  maximumFractionDigits: 1,
});

const countFormatter = new Intl.NumberFormat("en-GB");

export function formatPrice(value: number): string {
  return gbpFormatter.format(value);
}

export function formatCompactPrice(value: number): string {
  return compactGbpFormatter.format(value);
}

export function formatCount(value: number): string {
  return countFormatter.format(value);
}

export function formatCompactCount(value: number): string {
  if (value < 1_000) {
    return formatCount(value);
  }

  const units = ["K", "M", "B", "T"] as const;
  let amount = value;
  let unitIndex = -1;

  do {
    amount /= 1_000;
    unitIndex += 1;
  } while (amount >= 1_000 && unitIndex < units.length - 1);

  return `${amount.toFixed(1).replace(/\.0$/, "")}${units[unitIndex]}`;
}

export function formatBytes(value: number): string {
  if (value < 1_000) {
    return `${value} B`;
  }

  const units = ["kB", "MB", "GB", "TB"] as const;
  let amount = value;
  let unitIndex = -1;

  do {
    amount /= 1_000;
    unitIndex += 1;
  } while (amount >= 1_000 && unitIndex < units.length - 1);

  const maximumFractionDigits = amount >= 100 ? 0 : 1;

  return `${amount.toFixed(maximumFractionDigits)} ${units[unitIndex]}`;
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) {
    return `${Math.round(milliseconds)} ms`;
  }

  return `${(milliseconds / 1_000).toFixed(1)} s`;
}

export function formatComputeDuration(milliseconds: number): string {
  if (milliseconds < 0.01) {
    return "<0.01 ms";
  }

  return `${milliseconds.toFixed(2)} ms`;
}
