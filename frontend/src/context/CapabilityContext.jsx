import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import api from "../lib/api";

const CapabilityContext = createContext({
  industryType: "MOBILE_RETAIL",
  capabilities: {
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
  hasCapability: () => true,
  isLoading: false,
  refreshCapabilities: async () => {},
});

export function CapabilityProvider({ children }) {
  const [industryType, setIndustryType] = useState("MOBILE_RETAIL");
  const [capabilities, setCapabilities] = useState({
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
  });
  const [isLoading, setIsLoading] = useState(false);

  const fetchCapabilities = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await api.get("/saas/tenant/capabilities");
      if (res.data && res.data.capabilities) {
        setIndustryType(res.data.industry_type || "MOBILE_RETAIL");
        setCapabilities(res.data.capabilities);
      }
    } catch (e) {
      // Fallback gracefully to mobile retail defaults on network / local offline mode
      console.warn("Could not fetch tenant capabilities, using defaults:", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCapabilities();
  }, [fetchCapabilities]);

  const hasCapability = useCallback(
    (key) => {
      return Boolean(capabilities[key]);
    },
    [capabilities]
  );

  return (
    <CapabilityContext.Provider
      value={{
        industryType,
        capabilities,
        hasCapability,
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
