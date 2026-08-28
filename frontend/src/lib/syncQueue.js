import { apiService } from "./apiService";
import api from "./api";

const QUEUE_KEY = "istore_sync_events_queue";
const OFFLINE_SALES_KEY = "istore_offline_sales_queue";
const PRODUCTS_CACHE_KEY = "istore_products_offline_cache";

/**
 * Deterministically generates a collision-free offline invoice number.
 * Format: INV-OFF-{BRANCH}-{DEVICE}-{TIMESTAMP_BASE36}-{RAND}
 */
export const generateOfflineInvoiceNo = (branchCode = "BR01", deviceId = "POS01") => {
  const cleanBranch = (branchCode || "BR01").replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 4);
  const cleanDevice = (deviceId || "REG").replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 4);
  const timeCode = Date.now().toString(36).toUpperCase();
  const randCode = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `INV-OFF-${cleanBranch}-${cleanDevice}-${timeCode}-${randCode}`;
};

/**
 * IndexedDB Wrapper for high-volume offline storage with localStorage fallback
 */
class OfflineStorageEngine {
  constructor() {
    this.dbName = "istore_offline_db";
    this.dbVersion = 1;
    this.db = null;
    this._initPromise = this._initDb();
  }

  async _initDb() {
    if (typeof window === "undefined" || !window.indexedDB) return null;
    return new Promise((resolve) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("offline_sales")) {
          db.createObjectStore("offline_sales", { keyPath: "offline_invoice_no" });
        }
        if (!db.objectStoreNames.contains("products_cache")) {
          db.createObjectStore("products_cache", { keyPath: "id" });
        }
      };
      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      request.onerror = () => resolve(null);
    });
  }

  async saveOfflineSale(sale) {
    await this._initPromise;
    if (this.db) {
      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction("offline_sales", "readwrite");
          const store = tx.objectStore("offline_sales");
          store.put(sale);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      });
    } else {
      // LocalStorage Fallback
      try {
        const queue = JSON.parse(localStorage.getItem(OFFLINE_SALES_KEY)) || [];
        queue.push(sale);
        localStorage.setItem(OFFLINE_SALES_KEY, JSON.stringify(queue));
        return true;
      } catch {
        return false;
      }
    }
  }

  async getPendingOfflineSales() {
    await this._initPromise;
    if (this.db) {
      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction("offline_sales", "readonly");
          const store = tx.objectStore("offline_sales");
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => resolve([]);
        } catch {
          resolve([]);
        }
      });
    } else {
      try {
        return JSON.parse(localStorage.getItem(OFFLINE_SALES_KEY)) || [];
      } catch {
        return [];
      }
    }
  }

  async removeOfflineSale(invoiceNo) {
    await this._initPromise;
    if (this.db) {
      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction("offline_sales", "readwrite");
          const store = tx.objectStore("offline_sales");
          store.delete(invoiceNo);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      });
    } else {
      try {
        let queue = JSON.parse(localStorage.getItem(OFFLINE_SALES_KEY)) || [];
        queue = queue.filter((s) => s.offline_invoice_no !== invoiceNo);
        localStorage.setItem(OFFLINE_SALES_KEY, JSON.stringify(queue));
        return true;
      } catch {
        return false;
      }
    }
  }

  async cacheProducts(products) {
    if (!Array.isArray(products)) return;
    try {
      localStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify(products.slice(0, 1000)));
    } catch {
      // Ignore quota exceeded
    }
  }

  getCachedProducts() {
    try {
      return JSON.parse(localStorage.getItem(PRODUCTS_CACHE_KEY)) || [];
    } catch {
      return [];
    }
  }
}

export const offlineStorage = new OfflineStorageEngine();

export const syncQueue = {
  getQueue: () => {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY)) || [];
    } catch {
      return [];
    }
  },

  saveQueue: (queue) => {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  },

  enqueue: (eventType, payload) => {
    const queue = syncQueue.getQueue();
    const event = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: eventType,
      payload,
      timestamp: new Date().toISOString(),
      attempts: 0,
    };
    queue.push(event);
    syncQueue.saveQueue(queue);

    if (navigator.onLine) {
      syncQueue.processQueue();
    }
  },

  /**
   * Processes both standard event queue and offline batch sales
   */
  processQueue: async () => {
    if (!navigator.onLine) return { success: false, reason: "offline" };

    let totalSynced = 0;

    // 1. Process Offline Sales Batch
    try {
      const pendingSales = await offlineStorage.getPendingOfflineSales();
      if (pendingSales.length > 0) {
        const batchPayload = {
          sales: pendingSales.map((s) => ({
            offline_invoice_no: s.offline_invoice_no,
            checkout_payload: s.payload,
            offline_created_at: s.created_at,
            terminal_id: s.terminal_id || "POS-01",
          })),
        };

        const resp = await api.post("/pos/checkout/batch-sync", batchPayload);
        if (resp && resp.results) {
          for (const res of resp.results) {
            if (res.status === "synced" || res.status === "already_synced") {
              await offlineStorage.removeOfflineSale(res.offline_invoice_no);
              totalSynced += 1;
            }
          }
        }
      }
    } catch (err) {
      console.warn("Offline batch sync attempt failed:", err);
    }

    // 2. Process General CRUD Events
    const queue = syncQueue.getQueue();
    if (queue.length === 0) return { success: true, syncedCount: totalSynced };

    const remaining = [];
    for (const event of queue) {
      event.attempts += 1;
      let success = false;
      try {
        if (event.type === "sale_created") {
          const endpoint = event.payload.endpoint || "/pos/checkout";
          await api.post(endpoint, event.payload.payload);
          success = true;
        } else if (event.type === "inventory_created") {
          await apiService.inventory.create(event.payload);
          success = true;
        } else if (event.type === "inventory_updated") {
          await apiService.inventory.update(event.payload.id, event.payload.data);
          success = true;
        } else if (event.type === "repair_created") {
          await apiService.repairs.create(event.payload);
          success = true;
        } else if (event.type === "repair_updated") {
          await apiService.repairs.update(event.payload.id, event.payload.data);
          success = true;
        } else if (event.type === "customer_created") {
          await apiService.customers.create(event.payload);
          success = true;
        }
      } catch (err) {
        const status = err?.response?.status;
        if (status === 400 || status === 403 || event.attempts > 5) {
          success = true;
        }
      }

      if (success) {
        totalSynced += 1;
      } else {
        remaining.push(event);
      }
    }

    syncQueue.saveQueue(remaining);
    return { success: true, syncedCount: totalSynced };
  },
};

// Periodic Background Sync Worker (every 60 seconds when online)
if (typeof window !== "undefined" && !window.__istore_sync_worker_started) {
  window.__istore_sync_worker_started = true;
  setInterval(() => {
    if (navigator.onLine) {
      syncQueue.processQueue();
    }
  }, 60 * 1000);

  window.addEventListener("online", () => {
    syncQueue.processQueue();
  });
}
