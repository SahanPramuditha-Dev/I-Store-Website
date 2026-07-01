import api from "./api";

export const apiService = {
  inventory: {
    list: (params = {}) => {
      const q = new URLSearchParams();
      if (params.page) q.append("page", params.page);
      if (params.pageSize) q.append("page_size", params.pageSize);
      if (params.search) q.append("search", params.search);
      if (params.category && params.category !== "All") q.append("category", params.category);
      if (params.supplierId && params.supplierId !== "All") q.append("supplier_id", params.supplierId);
      return api.get(`/inventory?${q.toString()}`).then((res) => ({
        items: res.data || [],
        total: parseInt(res.headers["x-total-count"] || res.headers["X-Total-Count"] || "0", 10),
      }));
    },
    getMeta: () => api.get("/inventory/meta"),
    getSuppliers: () => api.get("/inventory/suppliers"),
    getMovements: () => api.get("/inventory/movements"),
    create: (payload) => api.post("/inventory", payload),
    update: (id, payload) => api.put(`/inventory/${id}`, payload),
    delete: (id, approvalCode = "") => {
      const query = approvalCode ? `?approval_request_code=${approvalCode}` : "";
      return api.delete(`/inventory/${id}${query}`);
    },
    adjustStock: (id, payload) => api.post(`/inventory/${id}/adjust`, payload),
    listSerials: (itemId) => api.get(`/inventory/${itemId}/serials`),
    addSerial: (itemId, serial) => api.post(`/inventory/${itemId}/serials`, { serial }),
    deleteSerial: (itemId, serialId) => api.delete(`/inventory/${itemId}/serials/${serialId}`),
  },
  sales: {
    list: (params = {}) => {
      const q = new URLSearchParams();
      if (params.page) q.append("page", params.page);
      if (params.pageSize) q.append("page_size", params.pageSize);
      return api.get(`/pos/sales?${q.toString()}`).then((res) => ({
        items: res.data || [],
        total: parseInt(res.headers["x-total-count"] || res.headers["X-Total-Count"] || "0", 10),
      }));
    },
    create: (payload) => api.post("/pos/checkout", payload),
  },
  repairs: {
    list: (params = {}) => {
      const q = new URLSearchParams();
      if (params.page) q.append("page", params.page);
      if (params.pageSize) q.append("page_size", params.pageSize);
      return api.get(`/repairs?${q.toString()}`).then((res) => ({
        items: res.data || [],
        total: parseInt(res.headers["x-total-count"] || res.headers["X-Total-Count"] || "0", 10),
      }));
    },
    create: (payload) => api.post("/repairs", payload),
    update: (id, payload) => api.put(`/repairs/${id}`, payload),
  },
  customers: {
    list: (params = {}) => {
      const q = new URLSearchParams();
      if (params.page) q.append("page", params.page);
      if (params.pageSize) q.append("page_size", params.pageSize);
      if (params.search) q.append("search", params.search);
      return api.get(`/customers?${q.toString()}`).then((res) => ({
        items: res.data || [],
        total: parseInt(res.headers["x-total-count"] || res.headers["X-Total-Count"] || "0", 10),
      }));
    },
    get: (id) => api.get(`/customers/${id}`),
    create: (payload) => api.post("/customers", payload),
    update: (id, payload) => api.put(`/customers/${id}`, payload),
  },
  staff: {
    list: () => api.get("/auth/staff"),
  }
};
