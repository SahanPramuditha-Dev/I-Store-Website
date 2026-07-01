import { useCachedQuery } from "./useCachedQuery";

export function useFetch(path, options = {}) {
  const { data, loading, error, refetch, setData } = useCachedQuery(
    path, 
    path, 
    { 
      enabled: !!path,
      ...options 
    }
  );

  return { 
    data, 
    loading: path ? loading : false, 
    error, 
    setData, 
    refresh: refetch 
  };
}
