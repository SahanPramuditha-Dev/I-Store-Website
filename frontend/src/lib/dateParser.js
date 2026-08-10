export function parseUtcIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const raw = String(value).trim();
  const isoWithoutTimezone = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?$/.test(raw);
  const normalized = isoWithoutTimezone ? `${raw}Z` : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseLocalDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const raw = String(value).trim();
  const localIsoDate = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(raw) ? `${raw}T00:00:00` : raw;
  const date = new Date(localIsoDate);
  return Number.isNaN(date.getTime()) ? null : date;
}
