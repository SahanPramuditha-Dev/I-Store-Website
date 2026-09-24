"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const requests = [];
const modules = {
  os: { hostname: () => "test-pc" },
  crypto: require("crypto"),
  fs: {},
  path,
  electron: {
    app: { getVersion: () => "1.1.127" },
    net: { fetch: async (url) => {
      requests.push(url);
      return { ok: false, status: 400, json: async () => ({ detail: "Machine limit reached (1)" }) };
    } },
  },
  "./hardware-fingerprint": { getHardwareFingerprint: () => "stable-device-id" },
};
const context = {
  require: (name) => modules[name],
  module: { exports: {} },
  process: { env: { ESTORE_LICENSE_SERVER_URL: "https://control.example" } },
  console,
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "license-manager.js"), "utf8"), context);

(async () => {
  const result = await context.module.exports.activatePOSDevice("  example-key  ");
  assert.equal(result.success, false);
  assert.equal(result.error, "Machine limit reached (1)");
  assert.deepEqual(requests, ["https://control.example/license/activate"]);
  console.log("License activation error propagation tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
