import axios from "axios";
import { clearAuthState, getAuthValue } from "./rbac";

const REQUEST_TIMEOUT_MS = 15000;
const MAX_GET_RETRIES = 2;

const isLocalhost = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
const defaultBaseUrl = import.meta.env.VITE_API_URL || (isLocalhost ? "http://127.0.0.1:8000" : "https://i-store-website-by6z.vercel.app");

const api = axios.create({
  baseURL: defaultBaseUrl,
  timeout: REQUEST_TIMEOUT_MS,
});

api.interceptors.request.use((config) => {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return Promise.reject(new axios.AxiosError("You are offline. Reconnect to continue.", "ERR_NETWORK", config));
  }
  const token = getAuthValue("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (typeof config.__retryCount !== "number") config.__retryCount = 0;
  return config;
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableGet(error) {
  const method = String(error?.config?.method || "").toLowerCase();
  if (method !== "get") return false;
  if (error.code === "ECONNABORTED") return true;
  if (!error.response) return true;
  const status = Number(error.response.status || 0);
  return status >= 500 || status === 429;
}

function toUserMessage(error) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "You are offline. Please check your network connection.";
  }
  if (error.code === "ECONNABORTED") {
    return "Request timed out. Please try again.";
  }
  const message = error.response?.data?.message;
  if (typeof message === "string" && message.trim()) return message;
  const detail = error.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (!error.response) return "Unable to reach backend service.";
  return `Request failed (${error.response.status}).`;
}

api.interceptors.response.use(
  (response) => {
    const payload = response?.data;
    if (payload && typeof payload === "object" && payload.success === true && Object.prototype.hasOwnProperty.call(payload, "data")) {
      response.data = payload.data;
    }
    return response;
  },
  async (error) => {
    const config = error?.config || {};
    if (isRetryableGet(error) && Number(config.__retryCount || 0) < MAX_GET_RETRIES) {
      config.__retryCount = Number(config.__retryCount || 0) + 1;
      const backoff = 350 * config.__retryCount;
      await delay(backoff);
      return api.request(config);
    }

    if (error.response?.status === 401) {
      clearAuthState();
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    const code = error?.response?.data?.error_code;
    error.userMessage = toUserMessage(error);
    if (typeof code === "string" && code.trim()) {
      error.errorCode = code;
    }
    return Promise.reject(error);
  }
);

export default api;
