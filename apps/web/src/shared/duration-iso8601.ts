export function iso8601Duration(seconds: number): string | undefined {
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  let value = 'PT';
  if (hours) value += `${hours}H`;
  if (minutes) value += `${minutes}M`;
  if (remaining || (!hours && !minutes)) value += `${remaining}S`;
  return value;
}
