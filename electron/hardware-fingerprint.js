"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");

function fingerprintFromMachineId(machineId) {
  const normalized = String(machineId || "").trim().toLowerCase();
  if (!normalized) return "";
  return crypto.createHash("sha256").update(`estore-device-v2|${normalized}`).digest("hex");
}

function readMachineId() {
  if (process.platform === "win32") {
    try {
      const output = execFileSync("reg.exe", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], {
        encoding: "utf8", windowsHide: true, timeout: 3000,
      });
      return output.match(/MachineGuid\s+REG_SZ\s+(\S+)/i)?.[1] || "";
    } catch (_error) {
      return "";
    }
  }
  if (process.platform === "linux") {
    try { return fs.readFileSync("/etc/machine-id", "utf8").trim(); } catch (_error) {}
  }
  return "";
}

let cachedFingerprint = "";
function getHardwareFingerprint() {
  if (cachedFingerprint) return cachedFingerprint;
  const machineId = readMachineId();
  // The fallback stays constant across network changes and restarts.
  const fallbackId = `${os.platform()}|${os.arch()}|${os.hostname()}|${os.cpus()?.[0]?.model || "unknown_cpu"}`;
  cachedFingerprint = fingerprintFromMachineId(machineId || fallbackId);
  return cachedFingerprint;
}

module.exports = { fingerprintFromMachineId, getHardwareFingerprint };
