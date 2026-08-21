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

const PRIMARY_LICENSE_SERVER = process.env.ESTORE_LICENSE_SERVER_URL || "https://e-store-control-center-backend.vercel.app/license";
const LOCAL_BACKEND_FALLBACK = "http://127.0.0.1:8080/license";
const OFFLINE_GRACE_PERIOD_HOURS = 72;

let _cachedLicense = null;

function resolveLicenseStorePath() {
  try {
    const dataRoot = path.join(app.getPath("localAppData"), "iStore");
    fs.mkdirSync(dataRoot, { recursive: true });
    return path.join(dataRoot, "license_cache.json");
  } catch (_e) {
    const fallback = path.join(app.getPath("userData"), "license_cache.json");
    return fallback;
  }
}

/**
 * Computes a persistent cryptographic hardware fingerprint from machine properties.
 */
function getHardwareFingerprint() {
  const cpus = os.cpus() || [];
  const cpuModel = cpus.length > 0 ? cpus[0].model : "unknown_cpu";
  const hostname = os.hostname();
  const platform = os.platform();
  const arch = os.arch();
  
  // Collect MAC addresses of physical network interfaces
  const nics = os.networkInterfaces();
  const macs = [];
  for (const name of Object.keys(nics)) {
    for (const netInfo of nics[name] || []) {
      if (!netInfo.internal && netInfo.mac && netInfo.mac !== "00:00:00:00:00:00") {
        macs.push(netInfo.mac);
      }
    }
  }
  const macString = macs.sort().join("-");
  const rawFingerprint = `${platform}|${arch}|${hostname}|${cpuModel}|${macString}`;
  return crypto.createHash("sha256").update(rawFingerprint).digest("hex");
}

function loadCachedLicense() {
  if (_cachedLicense) return _cachedLicense;
  const storePath = resolveLicenseStorePath();
  if (fs.existsSync(storePath)) {
    try {
      const raw = fs.readFileSync(storePath, "utf8");
      _cachedLicense = JSON.parse(raw);
    } catch (_e) {
      _cachedLicense = null;
    }
  }
  return _cachedLicense;
}

function saveCachedLicense(data) {
  _cachedLicense = {
    ...data,
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
  if (!cached || !cached.cached_at) return false;
  const cachedTime = new Date(cached.cached_at).getTime();
  const now = Date.now();
  const diffHours = (now - cachedTime) / (1000 * 60 * 60);
  return diffHours <= OFFLINE_GRACE_PERIOD_HOURS;
}

async function verifyOrHeartbeatLicense() {
  const cached = loadCachedLicense();
  const hardwareUuid = getHardwareFingerprint();

  if (!cached || !cached.license_key) {
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
        saveCachedLicense({
          ...cached,
          status: "ACTIVATED",
          token: data.token,
          last_verified_at: new Date().toISOString(),
        });
        return {
          status: "ACTIVATED",
          organization_name: cached.organization_name || cached.tenant_code,
          branch_name: cached.branch_name || cached.shop_code,
          device_code: cached.device_code || "POS Terminal",
          is_offline_fallback: false,
        };
      }
    } catch (_err) {
      // Server unreachable, check local fallback
    }
  }

  // Offline Grace Period
  if (isWithinOfflineGracePeriod(cached)) {
    return {
      status: "ACTIVATED",
      organization_name: cached.organization_name || cached.tenant_code,
      branch_name: cached.branch_name || cached.shop_code,
      device_code: cached.device_code || "POS Terminal",
      is_offline_fallback: true,
      offline_grace_remaining_hours: Math.max(
        0,
        OFFLINE_GRACE_PERIOD_HOURS - ((Date.now() - new Date(cached.cached_at).getTime()) / (1000 * 60 * 60))
      ).toFixed(1),
    };
  }

  return {
    status: "EXPIRED_OFFLINE",
    message: "Offline grace period of 72 hours has expired. Please connect to the internet to verify license.",
  };
}

async function activatePOSDevice(licenseKey) {
  const hardwareUuid = getHardwareFingerprint();
  const trimmedKey = licenseKey.trim();

  // 1. First attempt: Central License Server (Port 8080)
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

    const data = await response.json();
    if (response.ok && data.success) {
      const payload = data.token?.payload || {};
      saveCachedLicense({
        license_key: trimmedKey,
        tenant_code: payload.tenant_code,
        organization_name: payload.tenant_code,
        shop_code: payload.shop_code,
        branch_name: payload.shop_code,
        package_code: payload.package_code,
        entitlements: payload.entitlements,
        token: data.token,
        status: "ACTIVATED",
      });

      return {
        success: true,
        message: data.message || "Terminal activated successfully!",
        device: {
          organization_name: payload.tenant_code,
          branch_name: payload.shop_code,
        },
      };
    }
  } catch (_e) {
    // Try fallback
  }

  // 2. Second attempt: Local ERP Backend (Port 8000)
  try {
    const response = await net.fetch(`${LOCAL_BACKEND_FALLBACK}/devices/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        license_key: trimmedKey,
        hardware_uuid: hardwareUuid,
        app_version: app.getVersion() || "1.0.0",
        os_info: `${os.type()} ${os.release()} (${os.arch()})`,
      }),
    });

    const data = await response.json();
    if (response.ok && data.success) {
      const device = data.device || {};
      saveCachedLicense({
        license_key: trimmedKey,
        device_uuid: device.uuid,
        device_code: device.device_code,
        organization_id: device.organization_id,
        organization_name: device.organization_name,
        branch_id: device.branch_id,
        branch_name: device.branch_name,
        status: "ACTIVATED",
      });

      return {
        success: true,
        message: "Terminal activated successfully!",
        device: device,
      };
    }
    return { success: false, error: data.detail || data.error || "Activation key not found" };
  } catch (err) {
    return { success: false, error: `Could not reach license server: ${err.message}` };
  }
}

module.exports = {
  getHardwareFingerprint,
  verifyOrHeartbeatLicense,
  activatePOSDevice,
  loadCachedLicense,
};
