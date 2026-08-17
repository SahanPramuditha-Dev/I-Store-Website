import { useEffect, useState, useCallback, useRef } from "react";
import api from "../lib/api";

const cache = {};
const pendingRequests = {};

export function useCachedQuery(key, fetchFnOrUrl, options = {}) {
  const { staleTime = 5 * 60 * 1000, enabled = true, keepPreviousData = true } = options;
  const cacheKey = typeof key === "string" ? key : JSON.stringify(key);

  const fetchRef = useRef(fetchFnOrUrl);
  useEffect(() => {
    fetchRef.current = fetchFnOrUrl;
  }, [fetchFnOrUrl]);

  const getInitialState = useCallback(() => {
    const cached = cache[cacheKey];
    if (cached && Date.now() - cached.timestamp < staleTime) {
      return { data: cached.data, loading: false, error: null };
    }
    return { data: cached ? cached.data : null, loading: enabled, error: null };
  }, [cacheKey, staleTime, enabled]);

  const [status, setStatus] = useState(getInitialState);

  // Sync state when cacheKey, enabled, or staleTime changes without flashing empty state
  useEffect(() => {
    const nextState = getInitialState();
    setStatus((prev) => {
      if (keepPreviousData && prev.data && !nextState.data) {
        return { data: prev.data, loading: true, error: null };
      }
      return nextState;
    });
  }, [cacheKey, enabled, staleTime, getInitialState, keepPreviousData]);

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
      const fnOrUrl = fetchRef.current;
      if (typeof fnOrUrl === "function") {
        return await fnOrUrl();
      } else {
        const response = await api.get(fnOrUrl);
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
  }, [cacheKey, staleTime, enabled]);

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
