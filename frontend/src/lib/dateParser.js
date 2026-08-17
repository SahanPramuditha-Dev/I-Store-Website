/**
 * Robust ISO 8601 UTC Date Parser & Localizer
 * Ensures all timestamps from backend (whether serialized with 'Z' or as naive UTC)
 * are accurately parsed as UTC and rendered in the browser's local timezone (e.g. Asia/Colombo GMT+5:30).
 */

export function parseUtcIso(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  if (!raw) return null;

  // If already contains Z or timezone offset (+05:30 / -04:00)
  if (raw.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(raw)) {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // If standard ISO format YYYY-MM-DDTHH:mm:ss(.sss) without timezone
  const isoWithoutTimezone = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?$/.test(raw);
  const normalized = isoWithoutTimezone ? `${raw}Z` : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseLocalDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  if (!raw) return null;
  const localIsoDate = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(raw) ? `${raw}T00:00:00` : raw;
  const date = new Date(localIsoDate);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toLocalIsoDate(value = new Date()) {
  const d = value instanceof Date ? value : parseUtcIso(value) || new Date(value);
  if (!d || Number.isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDateTime(value, fallback = "—") {
  const d = parseUtcIso(value);
  if (!d) return fallback;
  return d.toLocaleString();
}

export function formatDate(value, fallback = "—") {
  const d = parseUtcIso(value);
  if (!d) return fallback;
  return d.toLocaleDateString();
}

export function formatTime(value, fallback = "—") {
  const d = parseUtcIso(value);
  if (!d) return fallback;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
