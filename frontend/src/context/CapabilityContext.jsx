import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import api from "../lib/api";

export const INDUSTRY_TEMPLATES = {
  MOBILE_RETAIL: {
    imei_tracking: true,
    serial_tracking: true,
    repairs_management: true,
    warranty_management: true,
    warranty_claims: true,
    trade_ins: true,
    batch_tracking: false,
    expiry_tracking: false,
    weighted_products: false,
    decimal_quantities: false,
    variants_matrix: true,
    size_color_variants: false,
    season_management: false,
    unit_conversions: false,
  },
  GROCERY: {
    imei_tracking: false,
    serial_tracking: false,
    repairs_management: false,
    warranty_management: false,
    warranty_claims: false,
    trade_ins: false,
    batch_tracking: true,
    expiry_tracking: true,
    weighted_products: true,
    decimal_quantities: true,
    variants_matrix: false,
    size_color_variants: false,
    season_management: false,
    unit_conversions: true,
  },
  FASHION: {
    imei_tracking: false,
    serial_tracking: false,
    repairs_management: false,
    warranty_management: false,
    warranty_claims: false,
    trade_ins: false,
    batch_tracking: false,
    expiry_tracking: false,
    weighted_products: false,
    decimal_quantities: false,
    variants_matrix: true,
    size_color_variants: true,
    season_management: true,
    unit_conversions: false,
  },
  ELECTRONICS: {
    imei_tracking: false,
    serial_tracking: true,
    repairs_management: true,
    warranty_management: true,
    warranty_claims: true,
    trade_ins: true,
    batch_tracking: false,
    expiry_tracking: false,
    weighted_products: false,
    decimal_quantities: false,
    variants_matrix: true,
    size_color_variants: false,
    season_management: false,
    unit_conversions: false,
  },
  COSMETICS: {
    imei_tracking: false,
    serial_tracking: false,
    repairs_management: false,
    warranty_management: false,
    warranty_claims: false,
    trade_ins: false,
    batch_tracking: true,
    expiry_tracking: true,
    weighted_products: false,
    decimal_quantities: false,
    variants_matrix: true,
    size_color_variants: false,
    season_management: false,
    unit_conversions: false,
  },
  GENERAL_RETAIL: {
    imei_tracking: false,
    serial_tracking: false,
    repairs_management: false,
    warranty_management: true,
    warranty_claims: false,
    trade_ins: false,
    batch_tracking: false,
    expiry_tracking: false,
    weighted_products: false,
    decimal_quantities: false,
    variants_matrix: true,
    size_color_variants: false,
    season_management: false,
    unit_conversions: false,
  },
};

function getInitialCapabilityState() {
  try {
    const raw = localStorage.getItem("istore_license_token");
    if (raw) {
      const parsed = JSON.parse(raw);
      const payload = parsed.payload || parsed;
      const ind = (payload.industry_code || "").toUpperCase();
      const signedCaps = payload.capabilities || [];
      
      const template = INDUSTRY_TEMPLATES[ind] || INDUSTRY_TEMPLATES["MOBILE_RETAIL"];
      let base = { ...template };
      if (Array.isArray(signedCaps) && signedCaps.length > 0) {
        Object.keys(base).forEach((k) => {
          base[k] = signedCaps.includes("all") ? true : signedCaps.includes(k);
        });
      }
      return {
        industryType: ind || "MOBILE_RETAIL",
        capabilities: base,
        entitlements: Array.isArray(payload.entitlements) ? payload.entitlements : [],
      };
    }
  } catch (_e) {}
  return {
    industryType: "MOBILE_RETAIL",
    capabilities: INDUSTRY_TEMPLATES["MOBILE_RETAIL"],
    entitlements: [],
  };
}

const initial = getInitialCapabilityState();

const CapabilityContext = createContext({
  industryType: initial.industryType,
  capabilities: initial.capabilities,
  hasCapability: () => true,
  hasEntitlement: () => true,
  isLoading: false,
  refreshCapabilities: async () => {},
});

export function CapabilityProvider({ children }) {
  const [industryType, setIndustryType] = useState(() => getInitialCapabilityState().industryType);
  const [capabilities, setCapabilities] = useState(() => getInitialCapabilityState().capabilities);
  const [entitlements, setEntitlements] = useState(() => getInitialCapabilityState().entitlements);
  const [isLoading, setIsLoading] = useState(false);

  const fetchCapabilities = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await api.get("/saas/capabilities");
      if (res.data && res.data.capabilities) {
        const ind = (res.data.industry_type || "MOBILE_RETAIL").toUpperCase();
        setIndustryType(ind);
        setCapabilities(res.data.capabilities);
        setEntitlements(Array.isArray(res.data.entitlements) ? res.data.entitlements : getInitialCapabilityState().entitlements);
      }
    } catch (e) {
      // Fallback gracefully to cached license or defaults
      const cached = getInitialCapabilityState();
      setIndustryType(cached.industryType);
      setCapabilities(cached.capabilities);
      setEntitlements(cached.entitlements);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCapabilities();

    const handleLicenseUpdate = (event) => {
      if (event.detail) {
        const ind = (event.detail.industry_code || "").toUpperCase();
        const template = INDUSTRY_TEMPLATES[ind] || INDUSTRY_TEMPLATES["MOBILE_RETAIL"];
        setIndustryType(ind);
        setCapabilities({ ...template });
      }
      fetchCapabilities();
    };

    window.addEventListener("istore_license_updated", handleLicenseUpdate);
    return () => {
      window.removeEventListener("istore_license_updated", handleLicenseUpdate);
    };
  }, [fetchCapabilities]);

  const hasCapability = useCallback(
    (key) => {
      return Boolean(capabilities[key]);
    },
    [capabilities]
  );

  const hasEntitlement = useCallback(
    (key) => entitlements.includes("all") || entitlements.includes(key),
    [entitlements]
  );

  return (
    <CapabilityContext.Provider
      value={{
        industryType,
        capabilities,
        hasCapability,
        entitlements,
        hasEntitlement,
        isLoading,
        refreshCapabilities: fetchCapabilities,
      }}
    >
      {children}
    </CapabilityContext.Provider>
  );
}

export function useCapability(key) {
  const { hasCapability } = useContext(CapabilityContext);
  return hasCapability(key);
}

export function useCapabilities() {
  return useContext(CapabilityContext);
}
