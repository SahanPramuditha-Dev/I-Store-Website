/**
 * license-manager.js  –  Electron Hardware Fingerprint & Offline License Engine
 * ==============================================================================
 * Connects directly to the Central License Platform Server (Port 8080 or Port 8000 fallback).
 * Performs hardware binding, Ed25519 cryptographic token verification, and offline caching.
 */

"use strict";

const os = require("os");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { net, app } = require("electron");
const { getHardwareFingerprint } = require("./hardware-fingerprint");

const configuredLicenseServer = (process.env.ESTORE_LICENSE_SERVER_URL || "https://e-store-control-center-backend.vercel.app").replace(/\/+$/, "");
const PRIMARY_LICENSE_SERVER = configuredLicenseServer.endsWith("/license") ? configuredLicenseServer : `${configuredLicenseServer}/license`;
// Root verification key published by the E Store control center. Key rotation
// requires shipping a new trusted key (or a signed keyring) in an app update.
const ESTORE_PUBLIC_KEY_B64 = process.env.ESTORE_PUBLIC_KEY_B64 || "psTliZ+/c7aE9zenGTHyvuxVuVJWDmTrUgA3ZfXXod4=";

let _cachedLicense = null;

function resolveLicenseStorePath() {
  const dataRoot = process.platform === "win32" && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "iStore")
    : path.join(app.getPath("appData"), "iStore");
  fs.mkdirSync(dataRoot, { recursive: true });
  return path.join(dataRoot, "license_cache.json");
}

/**
 * Computes a persistent cryptographic hardware fingerprint from machine properties.
 */
function loadCachedLicense() {
  if (_cachedLicense) return _cachedLicense;
  const storePath = resolveLicenseStorePath();
  if (fs.existsSync(storePath)) {
    try {
      const raw = fs.readFileSync(storePath, "utf8");
      _cachedLicense = normalizeCachedLicense(JSON.parse(raw));
    } catch (_e) {
      _cachedLicense = null;
    }
  }
  return _cachedLicense;
}

function normalizeCachedLicense(data) {
  if (!data || typeof data !== "object") return null;
  // Compatibility with installers up to 1.1.101, which wrapped the signed
  // token under `token` while the Python API expected it at the root.
  if (data.token?.payload && data.token?.signature) {
    return {
      ...data.token,
      license_key: data.license_key || data.token.payload.license_id,
      cached_at: data.cached_at,
      last_verified_at: data.last_verified_at,
      hardware_uuid: data.hardware_uuid,
      organization_name: data.organization_name || data.token.payload.organization_name || data.token.payload.tenant_code,
      branch_name: data.branch_name || data.token.payload.branch_name || data.token.payload.shop_code,
      device_code: data.device_code,
    };
  }
  return data;
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalizeLegacyPython(value, parentKey = "") {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalizeLegacyPython(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalizeLegacyPython(value[key], key)}`).join(",")}}`;
  }
  if (parentKey === "storage_gb" && typeof value === "number" && Number.isInteger(value)) return `${value}.0`;
  return JSON.stringify(value);
}

function verifySignedToken(token, expectedFingerprint = getHardwareFingerprint()) {
  if (!token?.payload || typeof token.signature !== "string") return { valid: false, error: "Malformed signed license token." };
  try {
    const rawKey = Buffer.from(ESTORE_PUBLIC_KEY_B64, "base64");
    if (rawKey.length !== 32) throw new Error("public key must contain 32 bytes");
    const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
    const publicKey = crypto.createPublicKey({ key: Buffer.concat([spkiPrefix, rawKey]), format: "der", type: "spki" });
    const signature = Buffer.from(token.signature, "base64");
    const valid = crypto.verify(null, Buffer.from(canonicalize(token.payload), "utf8"), publicKey, signature)
      || crypto.verify(null, Buffer.from(canonicalizeLegacyPython(token.payload), "utf8"), publicKey, signature);
    if (!valid) return { valid: false, error: "License signature is invalid." };
    const licensedFingerprint = token.payload.machine_fingerprint;
    if (licensedFingerprint && licensedFingerprint !== "*" && licensedFingerprint.toLowerCase() !== expectedFingerprint.toLowerCase()) {
      return { valid: false, error: "License belongs to a different device." };
    }
    return { valid: true, payload: token.payload };
  } catch (error) {
    return { valid: false, error: `License verification failed: ${error.message}` };
  }
}

function saveCachedLicense(data) {
  const normalized = normalizeCachedLicense(data);
  if (!verifySignedToken(normalized).valid) throw new Error("Refusing to cache an unverified license token.");
  _cachedLicense = {
    ...normalized,
    license_key: normalized.license_key || normalized.payload.license_id,
    cached_at: new Date().toISOString(),
    hardware_uuid: getHardwareFingerprint(),
  };
  const storePath = resolveLicenseStorePath();
  try {
    fs.writeFileSync(storePath, JSON.stringify(_cachedLicense, null, 2), "utf8");
  } catch (err) {
    console.error("[license-manager] Failed to save license cache:", err.message);
  }
  return _cachedLicense;
}

function isWithinOfflineGracePeriod(cached) {
  const verification = verifySignedToken(cached);
  if (!verification.valid || !cached.cached_at) return false;
  const cachedTime = new Date(cached.last_verified_at || cached.cached_at).getTime();
  if (!Number.isFinite(cachedTime)) return false;
  const now = Date.now();
  const diffHours = (now - cachedTime) / (1000 * 60 * 60);
  const graceHours = Math.max(0, Number(verification.payload.grace_period_days ?? 3) * 24);
  const expiresAt = verification.payload.expires_at ? new Date(verification.payload.expires_at).getTime() : Infinity;
  const expiryGraceCutoff = Number.isFinite(expiresAt) ? expiresAt + (graceHours * 60 * 60 * 1000) : Infinity;
  return now <= expiryGraceCutoff && diffHours >= 0 && diffHours <= graceHours;
}

async function verifyOrHeartbeatLicense() {
  const cached = loadCachedLicense();
  const hardwareUuid = getHardwareFingerprint();

  if (cached?.license_key && cached?.payload?.machine_fingerprint
      && cached.payload.machine_fingerprint !== hardwareUuid
      && verifySignedToken(cached, cached.payload.machine_fingerprint).valid) {
    return {
      status: "UNLICENSED",
      message: "This license was bound to an older device ID. Reset its machine binding in the Control Center, then activate this terminal again. Store data remains saved.",
      hardware_uuid: hardwareUuid,
    };
  }
  if (!cached || !cached.license_key || !verifySignedToken(cached, hardwareUuid).valid) {
    return {
      status: "UNLICENSED",
      message: "POS terminal requires activation with an E-Store license key.",
      hardware_uuid: hardwareUuid,
    };
  }

  if (net.isOnline()) {
    // Try Primary Central License Server (Port 8080)
    try {
      const response = await net.fetch(`${PRIMARY_LICENSE_SERVER}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          license_key: cached.license_key,
          machine_fingerprint: hardwareUuid,
          app_version: app.getVersion() || "1.0.0",
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const verification = verifySignedToken(data.token, hardwareUuid);
        if (!verification.valid) throw new Error(verification.error);
        const refreshed = saveCachedLicense({
          ...data.token,
          license_key: cached.license_key,
          last_verified_at: new Date().toISOString(),
        });
        return {
          status: "ACTIVATED",
          organization_name: refreshed.organization_name || refreshed.payload.tenant_code,
          branch_name: refreshed.branch_name || refreshed.payload.shop_code,
          device_code: refreshed.device_code || "POS Terminal",
          payload: refreshed.payload,
          is_offline_fallback: false,
        };
      }
    } catch (_err) {
      // Server unreachable, check local fallback
    }
  }

  // Offline Grace Period
  if (isWithinOfflineGracePeriod(cached)) {
    const graceHours = Math.max(0, Number(cached.payload.grace_period_days ?? 3) * 24);
    const verifiedAt = new Date(cached.last_verified_at || cached.cached_at).getTime();
    return {
      status: "ACTIVATED",
      organization_name: cached.organization_name || cached.tenant_code,
      branch_name: cached.branch_name || cached.shop_code,
      device_code: cached.device_code || "POS Terminal",
      payload: cached.payload,
      is_offline_fallback: true,
      offline_grace_remaining_hours: Math.max(
        0,
        graceHours - ((Date.now() - verifiedAt) / (1000 * 60 * 60))
      ).toFixed(1),
    };
  }

  return {
    status: "EXPIRED_OFFLINE",
    message: "The signed offline grace period has expired. Please connect to the internet to verify the license.",
  };
}

async function activatePOSDevice(licenseKey) {
  const hardwareUuid = getHardwareFingerprint();
  const trimmedKey = String(licenseKey || "").trim().toUpperCase();

  if (!trimmedKey) return { success: false, error: "Enter a license key." };

  // Only the central server may authorize a new machine binding. A local
  // backend cannot establish that the license is active or has a free seat.
  try {
    const response = await net.fetch(`${PRIMARY_LICENSE_SERVER}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        license_key: trimmedKey,
        machine_fingerprint: hardwareUuid,
        machine_name: `${os.hostname()} - Counter`,
        app_version: app.getVersion() || "1.0.0",
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      return {
        success: false,
        error: data.detail || data.message || data.error || `License server rejected activation (HTTP ${response.status}).`,
      };
    }
    const verification = verifySignedToken(data.token, hardwareUuid);
    if (!verification.valid) return { success: false, error: verification.error };
    const payload = verification.payload;
    saveCachedLicense({
      ...data.token,
      license_key: trimmedKey,
      tenant_code: payload.tenant_code,
      organization_name: payload.tenant_code,
      shop_code: payload.shop_code,
      branch_name: payload.shop_code,
      package_code: payload.package_code,
      entitlements: payload.entitlements,
      status: "ACTIVATED",
    });
    return {
      success: true,
      message: data.message || "Terminal activated successfully!",
      device: { organization_name: payload.tenant_code, branch_name: payload.shop_code },
    };
  } catch (err) {
    return { success: false, error: `Could not reach the license server. Check the connection and retry. (${err.message})` };
  }
}

module.exports = {
  getHardwareFingerprint,
  verifyOrHeartbeatLicense,
  activatePOSDevice,
  loadCachedLicense,
  verifySignedToken,
  ESTORE_PUBLIC_KEY_B64,
};
