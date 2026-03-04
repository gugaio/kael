function parsePositiveInteger(raw: unknown, fallback: number): number {
  if (typeof raw !== "string") {
    return fallback;
  }
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function getEmailIngestAlertThresholds(): {
  duplicateSkipped: number;
  inFlightSkipped: number;
} {
  return {
    duplicateSkipped: parsePositiveInteger(import.meta.env.VITE_EMAIL_DUPLICATE_ALERT_THRESHOLD, 3),
    inFlightSkipped: parsePositiveInteger(import.meta.env.VITE_EMAIL_INFLIGHT_ALERT_THRESHOLD, 2),
  };
}
