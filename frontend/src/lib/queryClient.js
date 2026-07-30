import { QueryClient } from "@tanstack/react-query";

export const createAppQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        gcTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        refetchOnMount: false,
        retry: (failureCount, error) => {
          const status =
            error && typeof error === "object"
              ? error.response?.status ?? error.status ?? null
              : null;
          if (status === 401 || status === 403) return false;
          return failureCount < 2;
        },
        retryDelay: (attemptIndex) =>
          Math.min(1000 * 2 ** attemptIndex, 10000),
      },
      mutations: {
        retry: (failureCount, error) => {
          const status =
            error && typeof error === "object"
              ? error.response?.status ?? error.status ?? null
              : null;
          if (status === 401 || status === 403 || status === 400 || status === 409)
            return false;
          return failureCount < 1;
        },
      },
    },
  });

export const appQueryClient = createAppQueryClient();
