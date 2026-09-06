"use strict";

const assert = require("node:assert/strict");
const path = require("path");
const { sanitizeTenantCode, getLicensedTenantCode, resolveTenantDataRoot } = require("./tenant-data-root");

assert.equal(sanitizeTenantCode(" supermar "), "SUPERMAR");
assert.equal(sanitizeTenantCode("../Vogue Fashion"), "VOGUE-FASHION");
assert.equal(getLicensedTenantCode({ payload: { tenant_code: "SUPERMAR" } }), "SUPERMAR");
assert.equal(resolveTenantDataRoot("C:\\data\\iStore", null), "C:\\data\\iStore");
assert.equal(
  resolveTenantDataRoot("C:\\data\\iStore", { payload: { tenant_code: "SUPERMAR" } }),
  path.join("C:\\data\\iStore", "tenants", "SUPERMAR")
);

console.log("Tenant data-root isolation tests passed.");
