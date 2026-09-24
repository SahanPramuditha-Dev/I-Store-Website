"use strict";

const assert = require("node:assert/strict");
const os = require("os");
const { fingerprintFromMachineId, getHardwareFingerprint } = require("./hardware-fingerprint");

assert.equal(fingerprintFromMachineId("ABC-123"), fingerprintFromMachineId("abc-123"));
assert.notEqual(fingerprintFromMachineId("ABC-123"), fingerprintFromMachineId("abc-124"));

const initial = getHardwareFingerprint();
const originalInterfaces = os.networkInterfaces;
os.networkInterfaces = () => ({ changingAdapter: [{ mac: "aa:bb:cc:dd:ee:ff" }] });
try {
  assert.equal(getHardwareFingerprint(), initial, "network adapter changes must not alter device identity");
} finally {
  os.networkInterfaces = originalInterfaces;
}

console.log("Stable hardware fingerprint tests passed.");
