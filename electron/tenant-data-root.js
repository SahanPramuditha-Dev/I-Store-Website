"use strict";

const path = require("path");

function sanitizeTenantCode(value) {
  const code = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  return code.slice(0, 64);
}

function getLicensedTenantCode(cachedLicense) {
  return sanitizeTenantCode(
    cachedLicense?.payload?.tenant_code ||
    cachedLicense?.tenant_code ||
    ""
  );
}

function resolveTenantDataRoot(baseDataRoot, cachedLicense) {
  const tenantCode = getLicensedTenantCode(cachedLicense);
  return tenantCode
    ? path.join(baseDataRoot, "tenants", tenantCode)
    : baseDataRoot;
}

module.exports = { sanitizeTenantCode, getLicensedTenantCode, resolveTenantDataRoot };
