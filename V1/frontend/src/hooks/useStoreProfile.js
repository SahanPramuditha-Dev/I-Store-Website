import { useEffect, useState } from "react";
import api from "../lib/api";
import { normalizeStoreProfile } from "../lib/storeProfile";

export function useStoreProfile() {
  const [identity, setIdentity] = useState(() => normalizeStoreProfile());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get("/settings/section/store_profile").catch(() => ({ data: {} })),
      api.get("/settings/print-profile").catch(() => ({ data: {} })),
    ])
      .then(([profile, printProfile]) => {
        if (!active) return;
        setIdentity(normalizeStoreProfile(profile?.data || {}, printProfile?.data || {}));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { identity, loading };
}
