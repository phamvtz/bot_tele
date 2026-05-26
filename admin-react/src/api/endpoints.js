import client from "./client";

export const api = {
  // Stats
  stats: () => client.get("/stats").then((r) => r.data),
  botStatus: () => client.get("/bot-status").then((r) => r.data),

  // Products
  products: (params) => client.get("/products", { params }).then((r) => r.data),
  product: (id) => client.get(`/products/${id}`).then((r) => r.data),
  createProduct: (data) => client.post("/products", data).then((r) => r.data),
  updateProduct: (id, data) => client.put(`/products/${id}`, data).then((r) => r.data),
  deleteProduct: (id) => client.delete(`/products/${id}`).then((r) => r.data),
  toggleProductActive: (id) => client.put(`/products/${id}/toggle-active`).then((r) => r.data),

  // Categories
  categories: () => client.get("/categories").then((r) => r.data),
  createCategory: (data) => client.post("/categories", data).then((r) => r.data),
  updateCategory: (id, data) => client.put(`/categories/${id}`, data).then((r) => r.data),
  deleteCategory: (id) => client.delete(`/categories/${id}`).then((r) => r.data),

  // Orders
  orders: (params) => client.get("/orders", { params }).then((r) => r.data),
  order: (id) => client.get(`/orders/${id}`).then((r) => r.data),
  updateOrderStatus: (id, status) => client.put(`/orders/${id}/status`, { status }).then((r) => r.data),

  // Users / Customers
  users: (params) => client.get("/users", { params }).then((r) => r.data),
  user: (id) => client.get(`/users/${id}`).then((r) => r.data),
  adjustWallet: (id, data) => client.put(`/users/${id}/wallet`, data).then((r) => r.data),
  blockUser: (id) => client.put(`/users/${id}/block`).then((r) => r.data),
  unblockUser: (id) => client.put(`/users/${id}/unblock`).then((r) => r.data),

  // Transactions
  transactions: (params) => client.get("/transactions", { params }).then((r) => r.data),

  // Coupons
  coupons: () => client.get("/coupons").then((r) => r.data),
  createCoupon: (data) => client.post("/coupons", data).then((r) => r.data),
  updateCoupon: (id, data) => client.put(`/coupons/${id}`, data).then((r) => r.data),
  deleteCoupon: (id) => client.delete(`/coupons/${id}`).then((r) => r.data),

  // Audit logs
  auditLogs: (params) => client.get("/audit-logs", { params }).then((r) => r.data),

  // Settings
  settings: () => client.get("/settings").then((r) => r.data),
  updateSettings: (data) => client.put("/settings", data).then((r) => r.data),

  // VIP levels
  vipLevels: () => client.get("/vip-levels").then((r) => r.data),
  updateVipLevel: (id, data) => client.put(`/vip-levels/${id}`, data).then((r) => r.data),

  // API Providers
  apiProviders: () => client.get("/api-providers").then((r) => r.data),
  createApiProvider: (data) => client.post("/api-providers", data).then((r) => r.data),
  updateApiProvider: (id, data) => client.put(`/api-providers/${id}`, data).then((r) => r.data),
  deleteApiProvider: (id) => client.delete(`/api-providers/${id}`).then((r) => r.data),
  fetchProviderProducts: (id) => client.post(`/api-providers/${id}/fetch-products`).then((r) => r.data),
  importProviderProducts: (id, products, opts = {}) => client.post(`/api-providers/${id}/import`, { products, ...opts }).then((r) => r.data),

  // Referral
  referralStats: () => client.get("/referral-stats").then((r) => r.data),

  // Stock items
  stockItems: (params) => client.get("/stock-items", { params }).then((r) => r.data),
  bulkAddStock: (productId, lines) => client.post("/stock-items/bulk", { productId, lines }).then((r) => r.data),
  deleteStockItem: (id) => client.delete(`/stock-items/${id}`).then((r) => r.data),
  clearUnsoldStock: (productId) => client.delete(`/products/${productId}/stock-unsold`).then((r) => r.data),

  // Broadcast
  broadcastHistory: () => client.get("/broadcast/history").then((r) => r.data),
  sendBroadcast: (data) => client.post("/broadcast/send", data).then((r) => r.data),

  // Export CSV (responseType blob → triggers browser download)
  exportOrders: (params) => client.get("/export/orders", { params, responseType: "blob" }).then((r) => r.data),
  exportRevenue: (params) => client.get("/export/revenue", { params, responseType: "blob" }).then((r) => r.data),
  exportUsers: () => client.get("/export/users", { responseType: "blob" }).then((r) => r.data),

  // Bank Monitor
  bankStatus: () => client.get("/bank/status").then((r) => r.data),
  bankRecent: () => client.get("/bank/recent").then((r) => r.data),
};
