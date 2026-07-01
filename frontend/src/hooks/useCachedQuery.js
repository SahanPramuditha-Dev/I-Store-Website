import { useEffect, useState, useCallback } from "react";
import api from "../lib/api";

const cache = {};
const pendingRequests = {};

export function useCachedQuery(key, fetchFnOrUrl, options = {}) {
  const { staleTime = 5 * 60 * 1000, enabled = true } = options;
  const cacheKey = typeof key === "string" ? key : JSON.stringify(key);

  const getInitialState = useCallback(() => {
    const cached = cache[cacheKey];
    if (cached && Date.now() - cached.timestamp < staleTime) {
      return { data: cached.data, loading: false, error: null };
    }
    return { data: cached ? cached.data : null, loading: enabled, error: null };
  }, [cacheKey, staleTime, enabled]);

  const [status, setStatus] = useState(getInitialState);

  // Sync state when cacheKey, enabled, or staleTime changes
  useEffect(() => {
    setStatus(getInitialState());
  }, [cacheKey, enabled, staleTime, getInitialState]);

  const fetchData = useCallback(async (force = false) => {
    if (!enabled && !force) return;

    const cached = cache[cacheKey];
    if (!force && cached && Date.now() - cached.timestamp < staleTime) {
      setStatus({ data: cached.data, loading: false, error: null });
      return;
    }

    setStatus((prev) => ({ ...prev, loading: true }));

    // Request deduplication
    if (pendingRequests[cacheKey]) {
      try {
        const resData = await pendingRequests[cacheKey];
        setStatus({ data: resData, loading: false, error: null });
      } catch (err) {
        setStatus({ data: null, loading: false, error: err.message });
      }
      return;
    }

    const promise = (async () => {
      if (typeof fetchFnOrUrl === "function") {
        return await fetchFnOrUrl();
      } else {
        const response = await api.get(fetchFnOrUrl);
        return response.data;
      }
    })();

    pendingRequests[cacheKey] = promise;

    try {
      const data = await promise;
      cache[cacheKey] = { data, timestamp: Date.now() };
      setStatus({ data, loading: false, error: null });
    } catch (err) {
      setStatus({ data: null, loading: false, error: err?.userMessage || err?.message || "Failed to fetch data" });
    } finally {
      delete pendingRequests[cacheKey];
    }
  }, [cacheKey, fetchFnOrUrl, staleTime, enabled]);

  useEffect(() => {
    fetchData();
  }, [cacheKey, fetchData]);

  const refetch = useCallback(() => fetchData(true), [fetchData]);

  const setData = useCallback((updater) => {
    setStatus((prev) => {
      const newData = typeof updater === "function" ? updater(prev.data) : updater;
      cache[cacheKey] = { data: newData, timestamp: Date.now() };
      return { ...prev, data: newData };
    });
  }, [cacheKey]);

  return { ...status, refetch, setData };
}

export function clearQueryCache(key = null) {
  if (key) {
    const cacheKey = typeof key === "string" ? key : JSON.stringify(key);
    delete cache[cacheKey];
  } else {
    Object.keys(cache).forEach((k) => delete cache[k]);
  }
}
