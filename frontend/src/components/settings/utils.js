export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function deepMergeDefaults(defaultVal, incomingVal) {
  if (Array.isArray(defaultVal)) {
    return Array.isArray(incomingVal) ? incomingVal : clone(defaultVal);
  }
  if (defaultVal && typeof defaultVal === "object") {
    const source = incomingVal && typeof incomingVal === "object" ? incomingVal : {};
    const out = { ...source };
    Object.entries(defaultVal).forEach(([key, nested]) => {
      out[key] = deepMergeDefaults(nested, source[key]);
    });
    return out;
  }
  return incomingVal === undefined || incomingVal === null ? defaultVal : incomingVal;
}

export function setPath(target, path, value) {
  const keys = String(path || "").split(".").filter(Boolean);
  if (!keys.length) return;
  let ptr = target;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (!ptr[key] || typeof ptr[key] !== "object") ptr[key] = {};
    ptr = ptr[key];
  }
  ptr[keys[keys.length - 1]] = value;
}

export function hash(value) {
  return JSON.stringify(value || {});
}

export function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

