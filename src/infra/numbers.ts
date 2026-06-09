export function clampNumber(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

export function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  return Math.floor(clampNumber(value, fallback, min, max));
}
