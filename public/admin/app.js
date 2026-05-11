let SECRET = "";
let currentTab = "dashboard";
let ordersPage = 0;
let usersPage = 0;
let ordersTotal = 0;
let usersTotal = 0;
let allCategories = [];
let allProducts = [];
let ordersCache = new Map();
let editingOrderId = null;
let dashboardInterval = null;
let usersSearchTimer = null;
let ordersSearchTimer = null;

const PAGE_SIZE = 20;

const pageInfo = {
  dashboard: ["Dashboard", "Tổng quan vận hành cửa hàng."],
  orders: ["Đơn hàng", "Theo dõi thanh toán và trạng thái giao hàng."],
  products: ["Sản phẩm", "Quản lý sản phẩm, giá bán và nội dung giao."],
  categories: ["Danh mục", "Sắp xếp nhóm sản phẩm trong shop."],
  stock: ["Kho hàng", "Nạp và kiểm tra tồn kho tự động."],
  users: ["Người dùng", "Theo dõi khách hàng, ví và cấp VIP."],
  wallet: ["Ví tiền", "Tra cứu giao dịch và điều chỉnh số dư ví."],
  coupons: ["Coupon", "Tạo và quản lý mã giảm giá."],
  broadcast: ["Broadcast", "Gửi thông báo tới khách hàng."],
  system: ["Hệ thống", "Nhật ký admin và sao lưu dữ liệu."],
};

const $ = (id) => document.getElementById(id);

// ============ Auth ============

function doLogin() {
  const value = $("secret-input").value.trim();
  if (!value) return;
  SECRET = value;
  localStorage.setItem("admin_secret", value);
  testAndEnter();
}

function testAndEnter() {
  fetch(`/api/admin/stats?secret=${encodeURIComponent(SECRET)}`)
    .then((res) => {
      if (res.status === 403) throw new Error("Unauthorized");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(() => enterApp())
    .catch(() => {
      $("login-error").style.display = "block";
      SECRET = "";
      localStorage.removeItem("admin_secret");
    });
}

function enterApp() {
  $("login-error").style.display = "none";
  $("login-screen").style.display = "none";
  $("app").style.display = "grid";
  switchTab(currentTab);

  if (dashboardInterval) clearInterval(dashboardInterval);
  dashboardInterval = setInterval(() => {
    if (currentTab === "dashboard") loadDashboard();
  }, 30000);
}

function doLogout() {
  localStorage.removeItem("admin_secret");
  SECRET = "";
  if (dashboardInterval) clearInterval(dashboardInterval);
  dashboardInterval = null;
  $("app").style.display = "none";
  $("login-screen").style.display = "flex";
  $("secret-input").value = "";
}

// ============ API ============

function api(path, opts = {}) {
  const sep = path.includes("?") ? "&" : "?";
  return fetch(`${path}${sep}secret=${encodeURIComponent(SECRET)}`, opts).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  });
}

// ============ Formatters ============

function fmt(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toLocaleString("vi-VN")}đ`;
}

function fmtDate(value) {
  if (!value) return "—";
  const dt = new Date(value);
  return `${dt.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })} ${dt.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`;
}

function escHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function jsString(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n");
}

function fmtFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function statusBadge(status) {
  const map = {
    PENDING: ["badge-pending", "Chờ TT"],
    PAID: ["badge-paid", "Đã TT"],
    DELIVERED: ["badge-delivered", "Đã giao"],
    CANCELED: ["badge-canceled", "Đã hủy"],
  };
  const [className, label] = map[status] || ["badge-inactive", status || "—"];
  return `<span class="badge ${className}">${escHtml(label)}</span>`;
}

// ============ Toast ============

function toast(message, type = "info", duration = 3000) {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  const icon = document.createElement("span");
  icon.className = "toast-icon";
  icon.textContent = type === "success" ? "✓" : type === "error" ? "!" : "i";
  const text = document.createElement("span");
  text.className = "toast-text";
  text.textContent = message;
  el.append(icon, text);
  $("toast-container").appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(-8px)";
    setTimeout(() => el.remove(), 180);
  }, duration);
}

// ============ Modal helpers ============

function openModal(id) { $(id)?.classList.add("open"); }
function closeModal(id) { $(id)?.classList.remove("open"); }

// ============ Dialog (confirm / prompt) ============

let _dialogResolve = null;

function showConfirm(message, title = "Xác nhận") {
  return new Promise((resolve) => {
    _dialogResolve = resolve;
    $("dialog-title").textContent = title;
    $("dialog-message").textContent = message;
    $("dialog-input-wrap").style.display = "none";
    $("dialog-input").value = "";
    $("dialog-ok").textContent = "Xác nhận";
    openModal("dialog-modal");
    setTimeout(() => $("dialog-ok").focus(), 40);
  });
}

function showPrompt(message, defaultValue = "", title = "Nhập giá trị") {
  return new Promise((resolve) => {
    _dialogResolve = resolve;
    $("dialog-title").textContent = title;
    $("dialog-message").textContent = message;
    $("dialog-input-wrap").style.display = "block";
    $("dialog-input").value = defaultValue;
    $("dialog-ok").textContent = "OK";
    openModal("dialog-modal");
    setTimeout(() => $("dialog-input").focus(), 40);
  });
}

function _dialogOk() {
  const inputVisible = $("dialog-input-wrap").style.display !== "none";
  const value = inputVisible ? $("dialog-input").value : true;
  closeModal("dialog-modal");
  if (_dialogResolve) { _dialogResolve(value); _dialogResolve = null; }
}

function _dialogCancel() {
  closeModal("dialog-modal");
  if (_dialogResolve) { _dialogResolve(inputVisible ? null : false); _dialogResolve = null; }
}

// Fix _dialogCancel to not reference undefined inputVisible
(function patchDialogCancel() {
  window._dialogCancel = function () {
    closeModal("dialog-modal");
    if (_dialogResolve) {
      const inputVisible = $("dialog-input-wrap").style.display !== "none";
      _dialogResolve(inputVisible ? null : false);
      _dialogResolve = null;
    }
  };
})();

// ============ Sidebar ============

function toggleSidebar() {
  $("sidebar").classList.toggle("open");
  $("sidebar-overlay").classList.toggle("open");
}

function closeSidebar() {
  $("sidebar").classList.remove("open");
  $("sidebar-overlay").classList.remove("open");
}

// ============ Tab routing ============

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".nav-link[data-tab]").forEach((el) => {
    el.classList.toggle("active", el.dataset.tab === tab);
  });
  document.querySelectorAll(".tab-panel").forEach((el) => {
    el.classList.toggle("active", el.id === `tab-${tab}`);
  });
  const [title, subtitle] = pageInfo[tab] || [tab, ""];
  $("page-title").textContent = title;
  $("page-subtitle").textContent = subtitle;
  closeSidebar();

  const loaders = {
    dashboard: loadDashboard,
    orders: () => loadOrders(true),
    products: loadProducts,
    categories: loadCategories,
    stock: loadStockTab,
    users: () => loadUsers(true),
    wallet: loadWalletTab,
    coupons: loadCoupons,
    broadcast: loadBroadcasts,
    system: loadSystem,
  };
  loaders[tab]?.();
}

function setRefresh(loading) {
  $("refresh-indicator").style.display = loading ? "flex" : "none";
}

function setLoading(tbodyId, cols) {
  $(tbodyId).innerHTML = `<tr class="loading-row"><td colspan="${cols}"><span class="spinner"></span></td></tr>`;
}

function setErrorRow(tbodyId, cols, text) {
  $(tbodyId).innerHTML = `<tr class="empty-row"><td colspan="${cols}">${escHtml(text)}</td></tr>`;
}

// ============ Dashboard ============

async function loadDashboard() {
  setRefresh(true);
  try {
    const [stats, ordersData] = await Promise.all([
      api("/api/admin/stats"),
      api("/api/admin/orders?limit=10"),
    ]);
    renderStats(stats);
    renderOrdersTable(ordersData.orders || [], "dashboard-orders-body", false);
  } catch (err) {
    toast(`Không thể tải dashboard: ${err.message}`, "error");
    setErrorRow("dashboard-orders-body", 6, "Không thể tải dữ liệu");
  } finally {
    setRefresh(false);
  }
}

function renderStats(stats) {
  const items = [
    { icon: "💰", label: "Doanh thu hôm nay", value: fmt(stats.todayRevenue), note: "Đơn đã giao trong ngày" },
    { icon: "📈", label: "Tổng doanh thu", value: fmt(stats.totalRevenue), note: "Tất cả đơn đã giao" },
    { icon: "🛒", label: "Đơn hôm nay", value: stats.todayOrders ?? 0, note: `${stats.totalOrders ?? 0} đơn toàn hệ thống` },
    { icon: "⏳", label: "Đơn chờ", value: stats.pendingOrders ?? 0, note: "Cần kiểm tra thanh toán" },
    { icon: "👥", label: "Người dùng", value: stats.totalUsers ?? 0, note: "Tổng tài khoản đã ghi nhận" },
    { icon: "📦", label: "Sản phẩm", value: stats.totalProducts ?? 0, note: "Sản phẩm đang bán" },
  ];

  $("stat-grid").innerHTML = items.map((item) => `
    <article class="stat-card">
      <div class="stat-top">
        <span class="stat-icon">${escHtml(item.icon)}</span>
      </div>
      <div>
        <span class="stat-label">${escHtml(item.label)}</span>
        <strong class="stat-value">${escHtml(String(item.value))}</strong>
      </div>
      <span class="stat-note">${escHtml(item.note)}</span>
    </article>
  `).join("");
}

// ============ Orders ============

async function loadOrders(reset = false) {
  if (reset) ordersPage = 0;
  const status = $("order-status-filter").value;
  const search = ($("order-search")?.value || "").trim();
  const dateFrom = $("order-date-from")?.value || "";
  const dateTo = $("order-date-to")?.value || "";
  const skip = ordersPage * PAGE_SIZE;

  let url = `/api/admin/orders?limit=${PAGE_SIZE}&skip=${skip}`;
  if (status) url += `&status=${encodeURIComponent(status)}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;
  if (dateFrom) url += `&dateFrom=${encodeURIComponent(dateFrom)}`;
  if (dateTo) url += `&dateTo=${encodeURIComponent(dateTo)}`;

  setLoading("orders-body", 7);
  try {
    const data = await api(url);
    ordersTotal = data.total || 0;
    renderOrdersTable(data.orders || [], "orders-body", true);
    renderPagination("orders-pagination", ordersPage, ordersTotal, PAGE_SIZE, "orders");
  } catch (err) {
    toast(`Lỗi tải đơn hàng: ${err.message}`, "error");
    setErrorRow("orders-body", 7, "Lỗi tải dữ liệu");
  }
}

function renderOrdersTable(orders, bodyId, clickable) {
  const tbody = $(bodyId);
  const cols = clickable ? 7 : 6;

  orders.forEach((o) => ordersCache.set(o.id, o));

  if (!orders.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${cols}">Không có dữ liệu</td></tr>`;
    return;
  }

  tbody.innerHTML = orders.map((order) => {
    const user = order.user
      ? (order.user.firstName || order.user.username || order.user.telegramId || order.odelegramId || "?")
      : (order.odelegramId || "?");
    const shortId = order.id ? order.id.slice(-8).toUpperCase() : "?";
    const rowAttrs = clickable
      ? `class="clickable" onclick="openOrderDetailModal('${order.id}')"`
      : "";

    return `<tr ${rowAttrs}>
      <td><code>${escHtml(shortId)}</code></td>
      <td class="truncate">${escHtml(user)}</td>
      <td class="truncate">${escHtml(order.product?.name || "—")}</td>
      <td><span class="money">${fmt(order.finalAmount)}</span></td>
      ${clickable ? `<td>${escHtml(order.paymentMethod || "—")}</td>` : ""}
      <td>${statusBadge(order.status)}</td>
      <td class="text-muted">${fmtDate(order.createdAt)}</td>
    </tr>`;
  }).join("");
}

function openOrderDetailModal(orderId) {
  const order = ordersCache.get(orderId);
  if (!order) return;

  editingOrderId = orderId;
  const shortId = orderId.slice(-8).toUpperCase();
  const user = order.user;
  const userName = user ? [user.firstName, user.username ? `@${user.username}` : ""].filter(Boolean).join(" ") : "—";
  const telegramId = user?.telegramId || order.odelegramId || "—";

  // Build detail HTML
  let html = `
    <div class="od-header">
      <div>
        <strong class="od-id">#${escHtml(shortId)}</strong>
        <code class="od-full-id">${escHtml(orderId)}</code>
      </div>
      ${statusBadge(order.status)}
    </div>
    <dl class="order-detail-dl">
      <dt>Người dùng</dt><dd>${escHtml(userName)}</dd>
      <dt>Telegram ID</dt><dd><code>${escHtml(telegramId)}</code></dd>
      <dt>Sản phẩm</dt><dd>${escHtml(order.product?.name || "—")}</dd>
      <dt>Mã SP</dt><dd><code>${escHtml(order.product?.code || "—")}</code></dd>
      <dt>Số lượng</dt><dd>${order.quantity ?? 1}</dd>
      <dt>Giá gốc</dt><dd>${fmt(order.amount)}</dd>
      <dt>Giảm giá</dt><dd>${order.discount ? fmt(order.discount) : "—"}</dd>
      <dt>Thành tiền</dt><dd><strong>${fmt(order.finalAmount)}</strong></dd>
      <dt>Thanh toán</dt><dd>${escHtml(order.paymentMethod || "—")}</dd>
      <dt>Mã TT</dt><dd>${escHtml(order.paymentRef || "—")}</dd>
      <dt>Ngày tạo</dt><dd>${fmtDate(order.createdAt)}</dd>
      ${order.cancelReason ? `<dt>Lý do hủy</dt><dd style="color:var(--red)">${escHtml(order.cancelReason)}</dd>` : ""}
    </dl>`;

  if (order.deliveryContent) {
    html += `
      <div class="order-detail-section">
        <h4>Nội dung đã giao</h4>
        <div class="delivery-content-box">${escHtml(order.deliveryContent)}</div>
      </div>`;
  }

  $("order-detail-content").innerHTML = html;
  $("order-detail-status").value = order.status || "PENDING";
  openModal("order-detail-modal");
}

async function saveOrderDetailStatus() {
  if (!editingOrderId) return;
  const status = $("order-detail-status").value;
  try {
    await api(`/api/admin/orders/${editingOrderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    toast("Đã cập nhật trạng thái đơn hàng", "success");
    closeModal("order-detail-modal");
    loadOrders();
    if (currentTab === "dashboard") loadDashboard();
  } catch (err) {
    toast(`Lỗi: ${err.message}`, "error");
  }
}

// Keep for backward compat
function openOrderStatusModal(orderId, currentStatus) {
  openOrderDetailModal(orderId);
}

async function saveOrderStatus() {
  return saveOrderDetailStatus();
}

// ============ Products ============

async function loadProducts() {
  setLoading("products-body", 7);
  try {
    const [productsData, categoriesData] = await Promise.all([
      api("/api/admin/products"),
      api("/api/admin/categories"),
    ]);
    allProducts = productsData.products || [];
    allCategories = categoriesData.categories || [];
    renderProducts();
    populateCategorySelects();
  } catch (err) {
    toast(`Lỗi tải sản phẩm: ${err.message}`, "error");
    setErrorRow("products-body", 7, "Lỗi tải sản phẩm");
  }
}

function renderProducts() {
  const tbody = $("products-body");
  const query = ($("product-search")?.value || "").trim().toLowerCase();
  const products = query
    ? allProducts.filter((product) => {
        const category = product.category?.name || "";
        return `${product.name} ${product.code} ${category}`.toLowerCase().includes(query);
      })
    : allProducts;

  if (!products.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">${query ? "Không tìm thấy sản phẩm" : "Không có sản phẩm"}</td></tr>`;
    return;
  }

  tbody.innerHTML = products.map((product) => {
    const stock = product.deliveryMode === "STOCK_LINES"
      ? (product._count?.stockItems ?? 0)
      : null;
    const stockText = stock === null
      ? `<span class="text-muted">—</span>`
      : `<strong style="color:${stock > 0 ? "var(--green)" : "var(--red)"}">${stock}</strong>`;
    const category = product.category
      ? `${escHtml(product.category.icon || "")} ${escHtml(product.category.name)}`
      : `<span class="text-muted">—</span>`;

    const toggleBtn = product.isActive
      ? `<button class="btn btn-danger btn-sm" type="button" onclick="toggleProduct('${product.id}', false)">Tắt</button>`
      : `<button class="btn btn-success btn-sm" type="button" onclick="toggleProduct('${product.id}', true)">Bật</button>`;

    return `<tr>
      <td>
        <div class="truncate"><strong>${escHtml(product.name)}</strong></div>
        <code>${escHtml(product.code || "—")}</code>
      </td>
      <td>${category}</td>
      <td>
        <span class="money">${fmt(product.price)}</span>
        ${product.vipPrice ? `<div class="text-muted">VIP ${fmt(product.vipPrice)}</div>` : ""}
      </td>
      <td><span class="mode-pill">${escHtml(product.deliveryMode || "—")}</span></td>
      <td>${stockText}</td>
      <td>${product.isActive ? `<span class="badge badge-active">Đang bán</span>` : `<span class="badge badge-inactive">Tắt</span>`}</td>
      <td>
        <div class="row-actions">
          <button class="btn btn-secondary btn-sm" type="button" onclick="openProductModalById('${product.id}')">Sửa</button>
          ${toggleBtn}
        </div>
      </td>
    </tr>`;
  }).join("");
}

function openProductModalById(productId) {
  const product = allProducts.find((item) => item.id === productId);
  openProductModal(product || null);
}

function openProductModal(product = null) {
  $("product-modal-title").textContent = product ? "Sửa sản phẩm" : "Thêm sản phẩm";
  $("product-edit-id").value = product?.id || "";
  $("p-name").value = product?.name || "";
  $("p-code").value = product?.code || "";
  $("p-price").value = product?.price ?? "";
  $("p-vip-price").value = product?.vipPrice ?? "";
  $("p-mode").value = product?.deliveryMode || "TEXT";
  $("p-stock-alert").value = product?.stockAlertAt ?? 5;
  $("p-auto-disable").value = product?.autoDisableAt ?? 0;
  $("p-auto-hide").checked = product?.autoHideWhenEmpty === true;
  $("p-category").value = product?.categoryId || "";
  $("p-image-url").value = product?.imageUrl || "";
  $("p-description").value = product?.description || "";
  $("p-note").value = product?.note || "";
  $("p-payload").value = product?.payload || "";
  $("p-active-group").classList.toggle("hidden", !product);
  if (product) $("p-active").value = product.isActive ? "true" : "false";
  populateCategorySelects(product?.categoryId || "");
  openModal("product-modal");
  setTimeout(() => $("p-name").focus(), 40);
}

function populateCategorySelects(selectedId = "") {
  const select = $("p-category");
  if (!select) return;
  const current = selectedId || select.value;
  select.innerHTML = `<option value="">Không có</option>` +
    allCategories.map((category) => `<option value="${category.id}">${escHtml(`${category.icon || ""} ${category.name}`.trim())}</option>`).join("");
  if (current) select.value = current;
}

async function saveProduct() {
  const id = $("product-edit-id").value;
  const body = {
    name: $("p-name").value.trim(),
    code: $("p-code").value.trim(),
    price: $("p-price").value,
    vipPrice: $("p-vip-price").value,
    deliveryMode: $("p-mode").value,
    stockAlertAt: $("p-stock-alert").value,
    autoDisableAt: $("p-auto-disable").value,
    autoHideWhenEmpty: $("p-auto-hide").checked,
    categoryId: $("p-category").value || null,
    imageUrl: $("p-image-url").value.trim() || null,
    description: $("p-description").value.trim(),
    note: $("p-note").value.trim() || null,
    payload: $("p-payload").value.trim(),
  };
  if (id) body.isActive = $("p-active").value === "true";
  if (!body.name) return toast("Vui lòng nhập tên sản phẩm", "error");
  if (!body.code) return toast("Vui lòng nhập mã sản phẩm", "error");

  try {
    await api(id ? `/api/admin/products/${id}` : "/api/admin/products", {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    toast(id ? "Đã cập nhật sản phẩm" : "Đã thêm sản phẩm", "success");
    closeModal("product-modal");
    loadProducts();
  } catch (err) {
    toast(`Lỗi: ${err.message}`, "error");
  }
}

async function toggleProduct(productId, activate) {
  const product = allProducts.find((item) => item.id === productId);
  const name = product?.name || productId;
  const confirmed = await showConfirm(`${activate ? "Bật" : "Tắt"} sản phẩm "${name}"?`);
  if (!confirmed) return;

  try {
    await api(`/api/admin/products/${productId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: activate }),
    });
    toast(activate ? "Đã bật sản phẩm" : "Đã tắt sản phẩm", "success");
    loadProducts();
  } catch (err) {
    toast(`Lỗi: ${err.message}`, "error");
  }
}

// Keep deleteProduct for backward compat
async function deleteProduct(productId) {
  return toggleProduct(productId, false);
}

// ============ Categories ============

async function loadCategories() {
  setLoading("categories-body", 6);
  try {
    const [categoriesData, productsData] = await Promise.all([
      api("/api/admin/categories"),
      api("/api/admin/products"),
    ]);
    allCategories = categoriesData.categories || [];
    allProducts = productsData.products || [];
    renderCategories();
  } catch (err) {
    toast(`Lỗi tải danh mục: ${err.message}`, "error");
    setErrorRow("categories-body", 6, "Lỗi tải danh mục");
  }
}

function renderCategories() {
  const tbody = $("categories-body");
  if (!allCategories.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">Không có danh mục</td></tr>`;
    return;
  }

  const productCount = {};
  allProducts.forEach((product) => {
    if (product.categoryId) productCount[product.categoryId] = (productCount[product.categoryId] || 0) + 1;
  });

  tbody.innerHTML = allCategories.map((category) => `
    <tr>
      <td><span class="stat-icon">${escHtml(category.icon || "📁")}</span></td>
      <td><strong>${escHtml(category.name)}</strong></td>
      <td>${productCount[category.id] || 0}</td>
      <td>${category.order ?? 0}</td>
      <td>${category.isActive ? `<span class="badge badge-active">Hoạt động</span>` : `<span class="badge badge-inactive">Tắt</span>`}</td>
      <td>
        <div class="row-actions">
          <button class="btn btn-secondary btn-sm" type="button" onclick="openEditCategoryModal('${category.id}')">Sửa</button>
          <button class="btn btn-danger btn-sm" type="button" onclick="deleteCategory('${category.id}')">Tắt</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function openCategoryModal() {
  $("c-name").value = "";
  $("c-icon").value = "";
  $("c-order").value = "";
  openModal("category-modal");
  setTimeout(() => $("c-name").focus(), 40);
}

async function saveCategory() {
  const body = {
    name: $("c-name").value.trim(),
    icon: $("c-icon").value.trim() || "📁",
    order: Number($("c-order").value) || 0,
  };
  if (!body.name) return toast("Vui lòng nhập tên danh mục", "error");

  try {
    await api("/api/admin/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    toast("Đã thêm danh mục", "success");
    closeModal("category-modal");
    loadCategories();
  } catch (err) {
    toast(`Lỗi: ${err.message}`, "error");
  }
}

function openEditCategoryModal(categoryId) {
  const category = allCategories.find((item) => item.id === categoryId);
  if (!category) return;

  $("ec-id").value = category.id;
  $("ec-name").value = category.name || "";
  $("ec-icon").value = category.icon || "📁";
  $("ec-order").value = category.order ?? 0;
  $("ec-active").value = category.isActive ? "true" : "false";
  syncEditCategoryPreview();
  openModal("edit-category-modal");
  setTimeout(() => $("ec-name").focus(), 40);
}

function syncEditCategoryPreview() {
  $("ec-icon-preview").textContent = $("ec-icon").value.trim() || "📁";
  $("ec-name-preview").textContent = $("ec-name").value.trim() || "Danh mục";
}

async function saveEditCategory() {
  const id = $("ec-id").value;
  const body = {
    name: $("ec-name").value.trim(),
    icon: $("ec-icon").value.trim() || "📁",
    order: Number($("ec-order").value) || 0,
    isActive: $("ec-active").value === "true",
  };
  if (!body.name) return toast("Vui lòng nhập tên danh mục", "error");

  try {
    await api(`/api/admin/categories/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    toast("Đã cập nhật danh mục", "success");
    closeModal("edit-category-modal");
    loadCategories();
  } catch (err) {
    toast(`Lỗi: ${err.message}`, "error");
  }
}

async function deleteCategory(categoryId) {
  const category = allCategories.find((item) => item.id === categoryId);
  const name = category?.name || categoryId;
  const confirmed = await showConfirm(`Tắt danh mục "${name}"?`);
  if (!confirmed) return;

  try {
    await api(`/api/admin/categories/${categoryId}`, { method: "DELETE" });
    toast("Đã tắt danh mục", "success");
    loadCategories();
  } catch (err) {
    toast(`Lỗi: ${err.message}`, "error");
  }
}

// ============ Stock ============

async function loadStockTab() {
  if (!allProducts.length) {
    try {
      const data = await api("/api/admin/products");
      allProducts = data.products || [];
    } catch (err) {
      toast(`Lỗi tải sản phẩm kho: ${err.message}`, "error");
    }
  }
  populateStockProductSelect();
}

function populateStockProductSelect() {
  const select = $("stock-product-select");
  const current = select.value;
  const stockProducts = allProducts.filter((product) => product.deliveryMode === "STOCK_LINES");
  select.innerHTML = `<option value="">Chọn sản phẩm STOCK_LINES</option>` +
    stockProducts.map((product) => `<option value="${product.id}">${escHtml(product.name)}</option>`).join("");
  if (current) select.value = current;
  if (!select.value) $("stock-counts").classList.remove("open");
}

async function loadStockCounts() {
  const productId = $("stock-product-select").value;
  if (!productId) {
    $("stock-counts").classList.remove("open");
    return;
  }
  $("stock-counts").classList.add("open");
  $("stock-available").textContent = "...";
  $("stock-sold").textContent = "...";

  try {
    const data = await api(`/api/admin/stock/${productId}`);
    $("stock-available").textContent = data.available ?? 0;
    $("stock-sold").textContent = data.sold ?? 0;
  } catch (err) {
    toast(`Lỗi: ${err.message}`, "error");
  }
}

async function submitStock() {
  const productId = $("stock-product-select").value;
  const text = $("stock-textarea").value.trim();
  if (!productId) return toast("Vui lòng chọn sản phẩm", "error");
  if (!text) return toast("Vui lòng nhập nội dung kho hàng", "error");

  const items = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!items.length) return toast("Không có dòng hợp lệ", "error");

  const button = $("stock-submit-btn");
  button.disabled = true;
  button.textContent = "Đang nhập...";

  try {
    const data = await api(`/api/admin/stock/${productId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    toast(`Đã nhập ${data.created || 0} item vào kho`, "success");
    $("stock-textarea").value = "";
    loadStockCounts();
  } catch (err) {
    toast(`Lỗi: ${err.message}`, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Nhập kho";
  }
}

async function clearStock() {
  const productId = $("stock-product-select").value;
  if (!productId) return toast("Vui lòng chọn sản phẩm trước", "error");

  const product = allProducts.find((p) => p.id === productId);
  const name = product?.name || productId;
  const confirmed = await showConfirm(`Xóa toàn bộ kho chưa bán của "${name}"?\nThao tác không thể hoàn tác!`, "Xóa kho");
  if (!confirmed) return;

  try {
    const data = await api(`/api/admin/stock/${productId}`, { method: "DELETE" });
    toast(`Đã xóa ${data.deleted || 0} item khỏi kho`, "success");
    $("stock-textarea").value = "";
    loadStockCounts();
  } catch (err) {
    toast(`Lỗi: ${err.message}`, "error");
  }
}

// ============ Users ============

async function loadUsers(reset = false) {
  if (reset) usersPage = 0;
  const skip = usersPage * PAGE_SIZE;
  const search = ($("users-search")?.value || "").trim();
  setLoading("users-body", 9);

  try {
    let url = `/api/admin/users?limit=${PAGE_SIZE}&skip=${skip}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    const data = await api(url);
    usersTotal = data.total || 0;
    renderUsers(data.users || []);
    renderPagination("users-pagination", usersPage, usersTotal, PAGE_SIZE, "users");
  } catch (err) {
    toast(`Lỗi tải người dùng: ${err.message}`, "error");
    setErrorRow("users-body", 9, "Lỗi tải dữ liệu");
  }
}

function onUsersSearch() {
  clearTimeout(usersSearchTimer);
  usersSearchTimer = setTimeout(() => loadUsers(true), 400);
}

function renderUsers(users) {
  const tbody = $("users-body");
  if (!users.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="9">Không có dữ liệu</td></tr>`;
    return;
  }

  tbody.innerHTML = users.map((user) => {
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || "—";
    const balance = user.walletBalance ?? user.balance ?? 0;
    const telegramId = jsString(user.telegramId || "");
    const vipLevel = Number(user.vipLevel) || 0;
    const vipBadge = vipLevel > 0
      ? `<span class="badge badge-vip">VIP ${vipLevel}</span>`
      : `<span class="badge badge-inactive">0</span>`;

    return `<tr>
      <td><code>${escHtml(user.telegramId || "—")}</code></td>
      <td class="truncate">${escHtml(name)}</td>
      <td class="truncate">${user.username ? `@${escHtml(user.username)}` : `<span class="text-muted">—</span>`}</td>
      <td><span class="money">${fmt(balance)}</span></td>
      <td>${user._count?.orders ?? 0}</td>
      <td>${vipBadge}</td>
      <td>${user.isBlocked ? `<span class="badge badge-danger">Blocked</span>` : `<span class="badge badge-active">Active</span>`}</td>
      <td class="text-muted">${fmtDate(user.createdAt)}</td>
      <td>
        <div class="row-actions">
          <button class="btn btn-secondary btn-sm" type="button" onclick="openWalletForUser('${telegramId}')">Ví</button>
          <button class="btn btn-secondary btn-sm" type="button" onclick="setUserVip('${telegramId}', ${vipLevel})">VIP</button>
          <button class="btn ${user.isBlocked ? "btn-secondary" : "btn-danger"} btn-sm" type="button" onclick="toggleUserBlock('${telegramId}', ${user.isBlocked ? "false" : "true"})">${user.isBlocked ? "Mở" : "Block"}</button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

async function setUserVip(telegramId, currentLevel = 0) {
  const value = await showPrompt("Nhập cấp VIP mới (0–4):", String(currentLevel), "Đổi cấp VIP");
  if (value === null) return;
  const level = Number(value);
  if (!Number.isInteger(level) || level < 0) return toast("VIP phải là số nguyên >= 0", "error");

  try {
    await api(`/api/admin/users/${encodeURIComponent(telegramId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vipLevel: level }),
    });
    toast("Đã cập nhật VIP", "success");
    loadUsers();
  } catch (err) {
    toast(`Lỗi cập nhật VIP: ${err.message}`, "error");
  }
}

async function toggleUserBlock(telegramId, isBlocked) {
  const label = isBlocked === "true" || isBlocked === true ? "block" : "mở block";
  const confirmed = await showConfirm(`Xác nhận ${label} user ${telegramId}?`);
  if (!confirmed) return;

  const blockedBool = isBlocked === "true" || isBlocked === true;
  try {
    await api(`/api/admin/users/${encodeURIComponent(telegramId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isBlocked: blockedBool }),
    });
    toast("Đã cập nhật trạng thái user", "success");
    loadUsers();
  } catch (err) {
    toast(`Lỗi cập nhật user: ${err.message}`, "error");
  }
}

function openWalletForUser(telegramId) {
  switchTab("wallet");
  $("wallet-telegram-id").value = telegramId;
  loadWallet();
}

function loadWalletTab() {
  if ($("wallet-telegram-id")?.value.trim()) loadWallet();
}

// ============ Wallet ============

async function loadWallet() {
  const telegramId = $("wallet-telegram-id").value.trim();
  if (!telegramId) return toast("Nhập Telegram ID cần tra cứu", "error");

  setLoading("wallet-transactions-body", 7);
  try {
    const data = await api(`/api/admin/wallet/${encodeURIComponent(telegramId)}`);
    renderWallet(data);
  } catch (err) {
    $("wallet-summary").classList.add("hidden");
    setErrorRow("wallet-transactions-body", 7, `Lỗi tải ví: ${err.message}`);
  }
}

function renderWallet(data) {
  const user = data.user;
  const wallet = data.wallet || {};
  const name = user ? [user.firstName, user.username ? `@${user.username}` : ""].filter(Boolean).join(" ") : "Chưa có user";
  $("wallet-summary").classList.remove("hidden");
  $("wallet-summary").innerHTML = `
    <div><span>Telegram ID</span><strong>${escHtml(wallet.telegramId || $("wallet-telegram-id").value.trim())}</strong></div>
    <div><span>Người dùng</span><strong>${escHtml(name)}</strong></div>
    <div><span>Số dư</span><strong>${fmt(wallet.balance || 0)}</strong></div>
    <div><span>Ví</span><strong>${wallet.exists ? "Đã tạo" : "Chưa tạo"}</strong></div>
  `;

  const transactions = data.transactions || [];
  const tbody = $("wallet-transactions-body");
  if (!transactions.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">Chưa có giao dịch ví.</td></tr>`;
    return;
  }

  tbody.innerHTML = transactions.map((tx) => `
    <tr>
      <td><span class="mode-pill">${escHtml(tx.type || "—")}</span></td>
      <td><span class="money">${fmt(tx.amount)}</span></td>
      <td>${fmt(tx.balanceBefore)}</td>
      <td>${fmt(tx.balanceAfter)}</td>
      <td>${tx.status === "SUCCESS" ? `<span class="badge badge-active">OK</span>` : tx.status === "PENDING" ? `<span class="badge badge-pending">PENDING</span>` : `<span class="badge badge-danger">${escHtml(tx.status || "FAILED")}</span>`}</td>
      <td class="truncate">${escHtml(tx.description || tx.paymentRef || "—")}</td>
      <td class="text-muted">${fmtDate(tx.createdAt)}</td>
    </tr>
  `).join("");
}

async function adjustWallet() {
  const telegramId = $("wallet-telegram-id").value.trim();
  const type = $("wallet-adjust-type").value;
  const amount = Number($("wallet-adjust-amount").value) || 0;
  const reason = $("wallet-adjust-reason").value.trim();
  if (!telegramId) return toast("Nhập Telegram ID trước", "error");
  if (amount <= 0) return toast("Số tiền phải lớn hơn 0", "error");
  if (!reason) return toast("Nhập lý do điều chỉnh ví", "error");
  const confirmed = await showConfirm(`${type === "DEDUCT" ? "Trừ" : "Cộng"} ${fmt(amount)} cho ${telegramId}?`);
  if (!confirmed) return;

  try {
    await api("/api/admin/wallet/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegramId, type, amount, reason }),
    });
    $("wallet-adjust-amount").value = "";
    $("wallet-adjust-reason").value = "";
    toast("Đã cập nhật ví", "success");
    loadWallet();
    if (currentTab === "users") loadUsers();
  } catch (err) {
    toast(`Lỗi cập nhật ví: ${err.message}`, "error");
  }
}

// ============ Coupons ============

async function loadCoupons() {
  setLoading("coupons-body", 7);
  try {
    const data = await api("/api/admin/coupons");
    renderCoupons(data.coupons || []);
  } catch (err) {
    setErrorRow("coupons-body", 7, `Lỗi tải coupon: ${err.message}`);
  }
}

function renderCoupons(coupons) {
  const tbody = $("coupons-body");
  if (!coupons.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">Chưa có coupon.</td></tr>`;
    return;
  }

  tbody.innerHTML = coupons.map((coupon) => {
    const code = jsString(coupon.code);
    const discount = coupon.discountType === "PERCENT" ? `${coupon.discount}%` : fmt(coupon.discount);
    const conditions = [
      coupon.minOrder ? `Tối thiểu ${fmt(coupon.minOrder)}` : null,
      coupon.maxDiscount ? `Giảm tối đa ${fmt(coupon.maxDiscount)}` : null,
      coupon.vipOnly ? `VIP ${coupon.vipOnly}+` : null,
    ].filter(Boolean).join(" / ") || "—";
    const uses = `${coupon.usedCount || 0}${coupon.maxUses ? ` / ${coupon.maxUses}` : ""}`;
    return `<tr>
      <td><code>${escHtml(coupon.code)}</code></td>
      <td><span class="money">${escHtml(discount)}</span></td>
      <td>${escHtml(uses)}</td>
      <td class="truncate">${escHtml(conditions)}</td>
      <td class="text-muted">${fmtDate(coupon.expiresAt)}</td>
      <td>${coupon.isActive ? `<span class="badge badge-active">Active</span>` : `<span class="badge badge-inactive">Tắt</span>`}</td>
      <td>
        <div class="row-actions">
          <button class="btn btn-secondary btn-sm" type="button" onclick="toggleCoupon('${code}')">${coupon.isActive ? "Tắt" : "Bật"}</button>
          <button class="btn btn-danger btn-sm" type="button" onclick="deleteCouponAdmin('${code}')">Xóa</button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

async function createCoupon() {
  const body = {
    code: $("coupon-code").value.trim(),
    discountType: $("coupon-type").value,
    discount: $("coupon-discount").value,
    maxUses: $("coupon-max-uses").value,
    minOrder: $("coupon-min-order").value,
    maxDiscount: $("coupon-max-discount").value,
    vipOnly: $("coupon-vip-only").value,
    expiresAt: $("coupon-expires-at").value,
  };
  if (!body.code) return toast("Nhập mã coupon", "error");
  if (!Number(body.discount)) return toast("Nhập giá trị giảm", "error");

  try {
    await api("/api/admin/coupons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    ["coupon-code", "coupon-discount", "coupon-max-uses", "coupon-min-order", "coupon-max-discount", "coupon-vip-only", "coupon-expires-at"].forEach((id) => { $(id).value = ""; });
    $("coupon-type").value = "PERCENT";
    toast("Đã tạo coupon", "success");
    loadCoupons();
  } catch (err) {
    toast(`Lỗi tạo coupon: ${err.message}`, "error");
  }
}

async function toggleCoupon(code) {
  try {
    await api(`/api/admin/coupons/${encodeURIComponent(code)}/toggle`, { method: "PUT" });
    toast("Đã cập nhật coupon", "success");
    loadCoupons();
  } catch (err) {
    toast(`Lỗi cập nhật coupon: ${err.message}`, "error");
  }
}

async function deleteCouponAdmin(code) {
  const confirmed = await showConfirm(`Xóa coupon ${code}?`);
  if (!confirmed) return;
  try {
    await api(`/api/admin/coupons/${encodeURIComponent(code)}`, { method: "DELETE" });
    toast("Đã xóa coupon", "success");
    loadCoupons();
  } catch (err) {
    toast(`Lỗi xóa coupon: ${err.message}`, "error");
  }
}

// ============ Broadcast ============

async function loadBroadcasts() {
  setLoading("broadcasts-body", 5);
  try {
    const data = await api("/api/admin/broadcasts?limit=30");
    renderBroadcasts(data.broadcasts || []);
  } catch (err) {
    setErrorRow("broadcasts-body", 5, `Lỗi tải broadcast: ${err.message}`);
  }
}

function renderBroadcasts(broadcasts) {
  const tbody = $("broadcasts-body");
  if (!broadcasts.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Chưa có lịch sử broadcast.</td></tr>`;
    return;
  }

  tbody.innerHTML = broadcasts.map((item) => `
    <tr>
      <td class="truncate">${escHtml(item.message || "—")}</td>
      <td>${item.sentCount ?? 0}</td>
      <td>${item.failCount ?? 0}</td>
      <td>${item.status === "COMPLETED" ? `<span class="badge badge-active">DONE</span>` : `<span class="badge badge-pending">${escHtml(item.status || "PENDING")}</span>`}</td>
      <td class="text-muted">${fmtDate(item.createdAt)}</td>
    </tr>
  `).join("");
}

async function sendAdminBroadcast() {
  const message = $("broadcast-message").value.trim();
  const target = $("broadcast-target").value;
  const minVipLevel = Number($("broadcast-vip-level").value) || 1;
  if (!message) return toast("Nhập nội dung broadcast", "error");
  const confirmed = await showConfirm(`Gửi broadcast cho ${target === "vip" ? `VIP ${minVipLevel}+` : "tất cả người dùng"}?`);
  if (!confirmed) return;

  const button = $("broadcast-submit-btn");
  button.disabled = true;
  button.textContent = "Đang gửi...";
  try {
    const result = await api("/api/admin/broadcasts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, target, minVipLevel }),
    });
    $("broadcast-message").value = "";
    toast(`Đã gửi ${result.sentCount || 0}, lỗi ${result.failCount || 0}`, "success");
    loadBroadcasts();
  } catch (err) {
    toast(`Lỗi gửi broadcast: ${err.message}`, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Gửi broadcast";
  }
}

// ============ System ============

function loadSystem() {
  loadLogs();
  loadBackups();
}

async function loadLogs() {
  setLoading("logs-body", 5);
  try {
    const data = await api("/api/admin/logs?limit=80");
    renderLogs(data.logs || []);
  } catch (err) {
    setErrorRow("logs-body", 5, `Lỗi tải log: ${err.message}`);
  }
}

function renderLogs(logs) {
  const tbody = $("logs-body");
  if (!logs.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">Chưa có log.</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map((log) => `
    <tr>
      <td><code>${escHtml(log.adminId || "—")}</code></td>
      <td><span class="mode-pill">${escHtml(log.action || "—")}</span></td>
      <td class="truncate">${escHtml(log.target || "—")}</td>
      <td class="truncate">${escHtml(log.details || "—")}</td>
      <td class="text-muted">${fmtDate(log.createdAt)}</td>
    </tr>
  `).join("");
}

async function loadBackups() {
  setLoading("backups-body", 3);
  try {
    const data = await api("/api/admin/backups");
    renderBackups(data.backups || []);
  } catch (err) {
    setErrorRow("backups-body", 3, `Lỗi tải backup: ${err.message}`);
  }
}

function renderBackups(backups) {
  const tbody = $("backups-body");
  if (!backups.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="3">Chưa có backup.</td></tr>`;
    return;
  }

  tbody.innerHTML = backups.map((backup) => `
    <tr>
      <td><code>${escHtml(backup.filename)}</code></td>
      <td>${fmtFileSize(backup.size)}</td>
      <td class="text-muted">${fmtDate(backup.createdAt)}</td>
    </tr>
  `).join("");
}

async function createBackupNow() {
  const confirmed = await showConfirm("Tạo backup dữ liệu hiện tại?");
  if (!confirmed) return;
  const button = $("backup-create-btn");
  button.disabled = true;
  button.textContent = "Đang tạo...";
  try {
    const result = await api("/api/admin/backups", { method: "POST" });
    toast(`Đã tạo backup ${result.filename}`, "success");
    loadBackups();
  } catch (err) {
    toast(`Lỗi tạo backup: ${err.message}`, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Tạo backup";
  }
}

function downloadExport(type) {
  window.open(`/api/admin/export/${encodeURIComponent(type)}?secret=${encodeURIComponent(SECRET)}`, "_blank", "noreferrer");
}

// ============ Pagination ============

function renderPagination(containerId, page, total, pageSize, type) {
  const container = $(containerId);
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  const from = page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);
  const handler = type === "orders" ? "changeOrdersPage" : "changeUsersPage";

  container.innerHTML = `
    <span>${from}–${to} / ${total}</span>
    <button class="btn btn-secondary btn-sm" type="button" ${page === 0 ? "disabled" : ""} onclick="${handler}(${page - 1})">Trước</button>
    <button class="btn btn-secondary btn-sm" type="button" ${page >= totalPages - 1 ? "disabled" : ""} onclick="${handler}(${page + 1})">Sau</button>
  `;
}

function changeOrdersPage(page) {
  ordersPage = Math.max(0, page);
  loadOrders();
}

function changeUsersPage(page) {
  usersPage = Math.max(0, page);
  loadUsers();
}

// ============ Event listeners ============

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  document.querySelectorAll(".modal-overlay.open").forEach((modal) => modal.classList.remove("open"));
  if (_dialogResolve) { _dialogResolve(false); _dialogResolve = null; }
  closeSidebar();
});

document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (event) => {
    if (event.target !== overlay) return;
    overlay.classList.remove("open");
    if (overlay.id === "dialog-modal" && _dialogResolve) {
      _dialogResolve(false);
      _dialogResolve = null;
    }
  });
});

$("ec-name").addEventListener("input", syncEditCategoryPreview);

$("secret-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter") doLogin();
});

// ============ Boot ============

const savedSecret = localStorage.getItem("admin_secret");
if (savedSecret) {
  SECRET = savedSecret;
  testAndEnter();
}

// ============ Exports ============

Object.assign(window, {
  doLogin, doLogout,
  toggleSidebar, closeSidebar,
  switchTab,
  loadDashboard,
  loadOrders, onOrdersSearch: () => {
    clearTimeout(ordersSearchTimer);
    ordersSearchTimer = setTimeout(() => loadOrders(true), 400);
  },
  loadProducts, renderProducts,
  openProductModal, openProductModalById,
  saveProduct, toggleProduct, deleteProduct,
  loadCategories,
  openCategoryModal, saveCategory,
  openEditCategoryModal, syncEditCategoryPreview, saveEditCategory,
  deleteCategory,
  loadStockTab, loadStockCounts, submitStock,
  loadUsers, onUsersSearch,
  setUserVip, toggleUserBlock,
  openWalletForUser, loadWallet, adjustWallet,
  loadCoupons, createCoupon, toggleCoupon, deleteCouponAdmin,
  loadBroadcasts, sendAdminBroadcast,
  loadSystem, loadLogs, loadBackups, createBackupNow,
  downloadExport,
  changeOrdersPage, changeUsersPage,
  openOrderDetailModal, openOrderStatusModal,
  saveOrderDetailStatus, saveOrderStatus,
  closeModal,
  _dialogOk, _dialogCancel: window._dialogCancel,
  showConfirm, showPrompt,
});
