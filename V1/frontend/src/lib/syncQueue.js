import { apiService } from "./apiService";
import api from "./api";

const QUEUE_KEY = "istore_sync_events_queue";

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
    
    // Attempt immediate sync if online
    if (navigator.onLine) {
      syncQueue.processQueue();
    }
  },

  processQueue: async () => {
    if (!navigator.onLine) return { success: false, reason: "offline" };
    
    const queue = syncQueue.getQueue();
    if (queue.length === 0) return { success: true, syncedCount: 0 };

    const remaining = [];
    let syncedCount = 0;

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
        console.error(`Sync failed for event ${event.id}:`, err);
        // If it's a validation error (400) or authorization error (401, 403), do not retry forever
        const status = err?.response?.status;
        if (status === 400 || status === 403 || event.attempts > 5) {
          // Drop poisoned events or events with too many attempts
          console.warn(`Dropping event ${event.id} due to permanent failure or max attempts.`);
          success = true; 
        }
      }

      if (success) {
        syncedCount += 1;
      } else {
        remaining.push(event);
      }
    }

    syncQueue.saveQueue(remaining);
    return { success: true, syncedCount };
  }
};

// Start periodic sync worker (every 3 minutes)
if (typeof window !== "undefined") {
  setInterval(() => {
    if (navigator.onLine) {
      syncQueue.processQueue();
    }
  }, 3 * 60 * 1000);

  window.addEventListener("online", () => {
    syncQueue.processQueue();
  });
}
