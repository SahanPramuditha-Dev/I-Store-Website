"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PUBLIC_KEY_B64 = "psTliZ+/c7aE9zenGTHyvuxVuVJWDmTrUgA3ZfXXod4=";
const LICENSE_SERVER = process.env.ESTORE_LICENSE_SERVER_URL || "https://e-store-control-center-backend.vercel.app/license";

function fingerprint() {
  const cpu = os.cpus()?.[0]?.model || "unknown_cpu";
  const macs = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const item of entries || []) {
      if (!item.internal && item.mac && item.mac !== "00:00:00:00:00:00") macs.push(item.mac);
    }
  }
  return crypto.createHash("sha256").update(`${os.platform()}|${os.arch()}|${os.hostname()}|${cpu}|${macs.sort().join("-")}`).digest("hex");
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

function verify(token, machineFingerprint) {
  if (!token?.payload || !token?.signature) throw new Error("Server returned no signed token");
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  const publicKey = crypto.createPublicKey({
    key: Buffer.concat([prefix, Buffer.from(PUBLIC_KEY_B64, "base64")]),
    format: "der",
    type: "spki",
  });
  const signature = Buffer.from(token.signature, "base64");
  const valid = crypto.verify(null, Buffer.from(canonicalize(token.payload)), publicKey, signature)
    || crypto.verify(null, Buffer.from(canonicalizeLegacyPython(token.payload)), publicKey, signature);
  if (!valid) {
    throw new Error("Production license signature is invalid");
  }
  if (token.payload.machine_fingerprint !== "*" && token.payload.machine_fingerprint.toLowerCase() !== machineFingerprint.toLowerCase()) {
    throw new Error("Production token is bound to a different machine");
  }
}

async function main() {
  if (process.argv[2] === "--verify-stdin") {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const machineFingerprint = fingerprint();
    verify(data.token, machineFingerprint);
    console.log(JSON.stringify({
      success: true,
      signature_valid: true,
      machine_match: true,
      package: data.token.payload.package_code,
      key_id: data.token.key_id,
    }));
    return;
  }
  const licenseKey = String(process.argv[2] || "").trim().toUpperCase();
  if (!licenseKey) throw new Error("Usage: node activate-production-license.js <license-key>");
  const machineFingerprint = fingerprint();
  const response = await fetch(`${LICENSE_SERVER}/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      license_key: licenseKey,
      machine_fingerprint: machineFingerprint,
      machine_name: `${os.hostname()} - Counter`,
      app_version: "1.1.103",
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.message || data.detail || `Activation failed (HTTP ${response.status})`);
  verify(data.token, machineFingerprint);
  const target = path.join(process.env.LOCALAPPDATA, "iStore", "license_cache.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({
    ...data.token,
    license_key: licenseKey,
    hardware_uuid: machineFingerprint,
    cached_at: new Date().toISOString(),
    last_verified_at: new Date().toISOString(),
  }, null, 2));
  console.log(JSON.stringify({
    success: true,
    signature_valid: true,
    cache_shape: "shared-root-token",
    package: data.token.payload.package_code,
    entitlements: data.token.payload.entitlements,
    expires_at: data.token.payload.expires_at,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
