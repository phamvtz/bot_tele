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
let notifInterval = null;
let usersSearchTimer = null;
let ordersSearchTimer = null;
let globalSearchTimer = null;
let revenueChart = null;

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
  vip: ["Bậc VIP", "Cấu hình điều kiện và quyền lợi từng bậc VIP."],
  referrals: ["Referral", "Lịch sử giới thiệu bạn bè và hoa hồng."],
  settings: ["Cài đặt", "Cấu hình tên shop, ngân hàng và hiển thị."],
  system: ["Hệ thống", "Nhật ký admin và sao lưu dữ liệu."],
};

const $ = (id) => document.getElementById(id);

// ============ Auth ============

function switchLoginTab(tab) {
  $("login-pw").style.display = tab === "pw" ? "block" : "none";
  $("login-otp").style.display = tab === "otp" ? "block" : "none";
  $("tab-pw").classList.toggle("active", tab === "pw");
  $("tab-otp").classList.toggle("active", tab === "otp");
  $("login-error").style.display = "none";
}

function doLoginPw() {
  const username = $("login-username").value.trim();
  const password = $("login-password").value.trim();
  if (!username || !password) return showLoginError("Vui lòng nhập đầy đủ thông tin");
  $("login-error").style.display = "none";
  fetch("/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  })
    .then(r => r.json())
    .then(data => {
      if (!data.ok) throw new Error(data.error || "Đăng nhập thất bại");
      SECRET = data.secret;
      localStorage.setItem("admin_secret", SECRET);
      enterApp();
    })
    .catch(e => showLoginError(e.message));
}

function showLoginError(msg) {
  const el = $("login-error");
  el.textContent = msg;
  el.style.display = "block";
}

function requestOtp() {
  const telegramId = $("tele-id-input").value.trim();
  if (!telegramId) return showLoginError("Vui lòng nhập Telegram ID");
  $("login-error").style.display = "none";
  fetch("/admin/otp/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ telegramId }),
  })
    .then(r => r.json())
    .then(data => {
      if (!data.ok) throw new Error(data.error || "Lỗi gửi OTP");
      $("otp-step1").style.display = "none";
      $("otp-step2").style.display = "block";
      setTimeout(() => $("otp-input").focus(), 100);
    })
    .catch(e => showLoginError(e.message));
}

function verifyOtp() {
  const telegramId = $("tele-id-input").value.trim();
  const otp = $("otp-input").value.trim();
  if (!otp) return showLoginError("Vui lòng nhập mã OTP");
  $("login-error").style.display = "none";
  fetch("/admin/otp/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ telegramId, otp }),
  })
    .then(r => r.json())
    .then(data => {
      if (!data.ok) throw new Error(data.error || "Mã không đúng");
      SECRET = data.secret;
      localStorage.setItem("admin_secret", SECRET);
      localStorage.setItem("admin_tele_id", telegramId);
      enterApp();
    })
    .catch(e => showLoginError(e.message));
}

function resetOtpStep() {
  $("otp-step1").style.display = "block";
  $("otp-step2").style.display = "none";
  $("otp-input").value = "";
  $("login-error").style.display = "none";
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

  // Start notification polling every 30 seconds
  if (notifInterval) clearInterval(notifInterval);
  pollNotifications();
  notifInterval = setInterval(pollNotifications, 30000);
}

function doLogout() {
  localStorage.removeItem("admin_secret");
  SECRET = "";
  if (dashboardInterval) clearInterval(dashboardInterval);
  dashboardInterval = null;
  if (notifInterval) clearInterval(notifInterval);
  notifInterval = null;
  if (revenueChart) { revenueChart.destroy(); revenueChart = null; }
  $("app").style.display = "none";
  $("login-screen").style.display = "flex";
  $("tele-id-input").value = "";
  $("otp-input").value = "";
  resetOtpStep();
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

// ============ Dialog ============

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
    vip: loadVipLevels,
    referrals: () => loadReferrals(true),
    settings: loadSettings,
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
  $(tbodyId).innerHTML = `<tr class="empty-row"><td colspan="${cols}"><div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-title">${escHtml(text)}</div></div></td></tr>`;
}

function setEmptyRow(tbodyId, cols, text = "Không có dữ liệu", icon = "🗂️") {
  $(tbodyId).innerHTML = `<tr class="empty-row"><td colspan="${cols}"><div class="empty-state"><div class="empty-state-icon">${icon}</div><div class="empty-state-title">${escHtml(text)}</div></div></td></tr>`;
}

// ============ Dashboard ============

async function loadDashboard() {
  setRefresh(true);
  try {
    const [stats, ordersData, chartData] = await Promise.all([
      api("/api/admin/stats"),
      api("/api/admin/orders?limit=10"),
      api("/api/admin/revenue-chart").catch(() => null),
    ]);
    renderStats(stats);
    renderOrdersTable(ordersData.orders || [], "dashboard-orders-body", false);
    if (chartData) renderRevenueChart(chartData);
  } catch (err) {
    toast(`Không thể tải dashboard: ${err.message}`, "error");
    setErrorRow("dashboard-orders-body", 6, "Không thể tải dữ liệu");
  } finally {
    setRefresh(false);
  }
}

function renderRevenueChart(data) {
  const wrap = $("revenue-chart");
  if (!wrap) return;

  if (!data || !data.length) {
    wrap.innerHTML = `<div class="empty-state" style="padding:40px"><div class="empty-state-icon">📊</div><div class="empty-state-title">Chưa có dữ liệu doanh thu</div></div>`;
    return;
  }

  // Use Chart.js if available, otherwise fall back to bar chart
  if (typeof Chart !== "undefined") {
    if (revenueChart) { revenueChart.destroy(); revenueChart = null; }
    wrap.innerHTML = `<div class="chart-canvas-wrap"><canvas id="revenue-canvas"></canvas></div>`;
    const ctx = document.getElementById("revenue-canvas").getContext("2d");
    const labels = data.map(d => d.date);
    const values = data.map(d => d.revenue || 0);

    revenueChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "Doanh thu",
          data: values,
          borderColor: "#6366f1",
          backgroundColor: "rgba(99,102,241,0.12)",
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: "#6366f1",
          pointBorderColor: "#1e2130",
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#1a1d27",
            borderColor: "#2d3149",
            borderWidth: 1,
            titleColor: "#94a3b8",
            bodyColor: "#f1f5f9",
            callbacks: {
              label: (ctx) => ` ${Number(ctx.raw).toLocaleString("vi-VN")}đ`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: "rgba(45,49,73,0.6)", drawBorder: false },
            ticks: { color: "#64748b", font: { size: 11 }, maxTicksLimit: 10 },
          },
          y: {
            grid: { color: "rgba(45,49,73,0.6)", drawBorder: false },
            ticks: {
              color: "#64748b",
              font: { size: 11 },
              callback: (v) => {
                if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
                if (v >= 1000) return `${(v / 1000).toFixed(0)}K`;
                return v;
              },
            },
          },
        },
      },
    });
    return;
  }

  // Fallback: bar chart
  const maxRevenue = Math.max(...data.map(d => d.revenue), 1);
  const bars = data.map(d => {
    const pct = Math.max(Math.round((d.revenue / maxRevenue) * 100), d.revenue > 0 ? 4 : 0);
    const isEmpty = d.revenue === 0;
    return `<div class="bar-chart-col">
      <div class="bar-chart-bar-wrap">
        <div class="bar-chart-bar ${isEmpty ? "empty" : ""}" style="height:${pct}%">
          <span class="bar-chart-value">${fmt(d.revenue)}</span>
        </div>
      </div>
      <div class="bar-chart-date">${escHtml(d.date)}</div>
    </div>`;
  }).join("");
  wrap.innerHTML = `<div class="bar-chart">${bars}</div>`;
}

function renderStats(stats) {
  const items = [
    { icon: "💰", color: "green",  label: "Doanh thu hôm nay", value: fmt(stats.todayRevenue), note: "Đơn đã giao trong ngày" },
    { icon: "📈", color: "teal",   label: "Tổng doanh thu", value: fmt(stats.totalRevenue), note: "Tất cả đơn đã giao" },
    { icon: "🛒", color: "blue",   label: "Đơn hôm nay", value: stats.todayOrders ?? 0, note: `${stats.totalOrders ?? 0} đơn toàn hệ thống` },
    { icon: "⏳", color: "amber",  label: "Đơn chờ", value: stats.pendingOrders ?? 0, note: "Cần kiểm tra thanh toán" },
    { icon: "👥", color: "indigo", label: "Người dùng", value: stats.totalUsers ?? 0, note: "Tổng tài khoản đã ghi nhận" },
    { icon: "📦", color: "purple", label: "Sản phẩm", value: stats.totalProducts ?? 0, note: "Sản phẩm đang bán" },
  ];

  $("stat-grid").innerHTML = items.map((item) => `
    <article class="stat-card">
      <div class="stat-top">
        <span class="stat-icon stat-icon-${item.color}">${escHtml(item.icon)}</span>
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
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${cols}"><div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-title">Không có đơn hàng nào</div></div></td></tr>`;
    return;
  }

  tbody.innerHTML = orders.map((order) => {
    const user = order.user
      ? (order.user.firstName || order.user.username || order.user.telegramId || order.odelegramId || "?")
      : (order.odelegramId || "?");
    const shortId = order.id ? order.id.slice(-8).toUpperCase() : "?";
    const rowAttrs = clickable
      ? `class="clickable" data-action="openOrderDetailModal" data-arg="${order.id}"`
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
  const catFilter = $("product-cat-filter")?.value || "";
  const statusFilter = $("product-status-filter")?.value || "";

  const products = allProducts.filter((p) => {
    if (query && !`${p.name} ${p.code} ${p.category?.name || ""}`.toLowerCase().includes(query)) return false;
    if (catFilter && p.categoryId !== catFilter) return false;
    if (statusFilter === "active" && !p.isActive) return false;
    if (statusFilter === "inactive" && p.isActive) return false;
    return true;
  });

  if (!products.length) {
    const msg = query || catFilter || statusFilter ? "Không tìm thấy sản phẩm" : "Chưa có sản phẩm nào";
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8"><div class="empty-state"><div class="empty-state-icon">📦</div><div class="empty-state-title">${msg}</div></div></td></tr>`;
    return;
  }

  tbody.innerHTML = products.map((product) => {
    const stock = product.deliveryMode === "STOCK_LINES"
      ? (product._count?.stockItems ?? 0)
      : null;
    const stockText = stock === null
      ? `<span class="text-muted">—</span>`
      : `<button class="stock-count-btn ${stock > 0 ? "stock-ok" : "stock-empty"}" data-action="goToStock" data-arg="${product.id}" title="Nhập kho">${stock}</button>`;
    const sold = product.soldCount ?? 0;
    const soldText = sold > 0 ? `<strong style="color:var(--green)">${sold}</strong>` : `<span class="text-muted">0</span>`;
    const category = product.category
      ? `${escHtml(product.category.icon || "")} ${escHtml(product.category.name)}`
      : `<span class="text-muted">—</span>`;

    return `<tr class="${!product.isActive ? "row-inactive" : ""}">
      <td>
        <div class="truncate"><strong>${escHtml(product.name)}</strong></div>
        <code>${escHtml(product.code || "—")}</code>
      </td>
      <td>${category}</td>
      <td>
        <span class="money">${fmt(product.price)}</span>
        ${product.vipPrice ? `<div style="font-size:11px;color:var(--text-muted)">VIP ${fmt(product.vipPrice)}</div>` : ""}
      </td>
      <td><span class="mode-pill">${escHtml(product.deliveryMode || "—")}</span></td>
      <td>${stockText}</td>
      <td>${soldText}</td>
      <td>${product.isActive ? `<span class="badge badge-active">Bán</span>` : `<span class="badge badge-inactive">Ẩn</span>`}</td>
      <td>
        <div class="row-actions">
          <button class="btn btn-secondary btn-sm" type="button" data-action="openProductModalById" data-arg="${product.id}">Sửa</button>
          <button class="btn btn-sm ${product.isActive ? "btn-secondary" : "btn-success"}" type="button" data-action="quickToggleProduct" data-arg="${product.id}" title="${product.isActive ? "Ẩn sản phẩm" : "Hiện sản phẩm"}">${product.isActive ? "Ẩn" : "Bật"}</button>
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
  switchImgTab("url");
  if (product?.imageUrl) { $("img-preview").src = product.imageUrl; $("img-preview-wrap").classList.remove("hidden"); }
  else { $("img-preview-wrap").classList.add("hidden"); }
  onProductModeChange();
  openModal("product-modal");
  setTimeout(() => $("p-name").focus(), 40);
}

function populateCategorySelects(selectedId = "") {
  const select = $("p-category");
  if (!select) return;
  const current = selectedId || select.value;
  select.innerHTML = `<option value="">Không có</option>` +
    allCategories.map((c) => `<option value="${c.id}">${escHtml(`${c.icon || ""} ${c.name}`.trim())}</option>`).join("");
  if (current) select.value = current;

  const catFilter = $("product-cat-filter");
  if (catFilter) {
    const prev = catFilter.value;
    catFilter.innerHTML = `<option value="">Tất cả danh mục</option>` +
      allCategories.map((c) => `<option value="${c.id}">${escHtml(`${c.icon || ""} ${c.name}`.trim())}</option>`).join("");
    catFilter.value = prev;
  }

  const bulkCatSelect = $("bulk-edit-cat-select");
  if (bulkCatSelect) {
    bulkCatSelect.innerHTML = `<option value="">— Không thay đổi —</option>` +
      allCategories.map((c) => `<option value="${c.id}">${escHtml(`${c.icon || ""} ${c.name}`.trim())}</option>`).join("");
  }
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
    <tr class="${!category.isActive ? "row-inactive" : ""}">
      <td><span class="stat-icon">${escHtml(category.icon || "📁")}</span></td>
      <td><strong>${escHtml(category.name)}</strong></td>
      <td>${productCount[category.id] || 0}</td>
      <td>${category.order ?? 0}</td>
      <td>${category.isActive ? `<span class="badge badge-active">Hiện</span>` : `<span class="badge badge-inactive">Ẩn</span>`}</td>
      <td>
        <div class="row-actions">
          <button class="btn btn-secondary btn-sm" type="button" data-action="openEditCategoryModal" data-arg="${category.id}">Sửa</button>
          <button class="btn btn-sm ${category.isActive ? "btn-secondary" : "btn-success"}" type="button" data-action="quickToggleCategory" data-arg="${category.id}">${category.isActive ? "Ẩn" : "Bật"}</button>
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
    tbody.innerHTML = `<tr class="empty-row"><td colspan="9"><div class="empty-state"><div class="empty-state-icon">👥</div><div class="empty-state-title">Không có người dùng nào</div></div></td></tr>`;
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
          <button class="btn btn-secondary btn-sm" type="button" data-action="openWalletForUser" data-arg="${telegramId}">Ví</button>
          <button class="btn btn-secondary btn-sm" type="button" data-action="setUserVip" data-arg="${telegramId}" data-arg2="${vipLevel}">VIP</button>
          <button class="btn ${user.isBlocked ? "btn-secondary" : "btn-danger"} btn-sm" type="button" data-action="toggleUserBlock" data-arg="${telegramId}" data-arg2="${user.isBlocked ? "false" : "true"}">${user.isBlocked ? "Mở" : "Block"}</button>
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
          <button class="btn btn-secondary btn-sm" type="button" data-action="toggleCoupon" data-arg="${code}">${coupon.isActive ? "Tắt" : "Bật"}</button>
          <button class="btn btn-danger btn-sm" type="button" data-action="deleteCouponAdmin" data-arg="${code}">Xóa</button>
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
  const handler = type === "orders" ? "changeOrdersPage" : type === "referrals" ? "changeReferralsPage" : "changeUsersPage";

  const maxVisible = 7;
  let pages = [];
  if (totalPages <= maxVisible) {
    for (let i = 0; i < totalPages; i++) pages.push(i);
  } else {
    const half = Math.floor(maxVisible / 2);
    let start = Math.max(0, page - half);
    let end = Math.min(totalPages - 1, start + maxVisible - 1);
    if (end - start < maxVisible - 1) start = Math.max(0, end - maxVisible + 1);
    if (start > 0) pages.push(0, "…");
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < totalPages - 1) pages.push("…", totalPages - 1);
  }

  const pills = pages.map(p => {
    if (p === "…") return `<span style="padding:0 4px;color:var(--text-muted);font-size:13px">…</span>`;
    return `<button class="page-btn${p === page ? " active" : ""}" type="button" data-action="${handler}" data-arg="${p}">${p + 1}</button>`;
  }).join("");

  container.innerHTML = `
    <span class="pagination-info">${from}–${to} / ${total}</span>
    <div class="pagination-pages">
      <button class="page-btn" type="button" ${page === 0 ? "disabled" : ""} data-action="${handler}" data-arg="${page - 1}" title="Trang trước">‹</button>
      ${pills}
      <button class="page-btn" type="button" ${page >= totalPages - 1 ? "disabled" : ""} data-action="${handler}" data-arg="${page + 1}" title="Trang sau">›</button>
    </div>
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

// ============ Settings ============

async function loadSettings() {
  setRefresh(true);
  try {
    const data = await api("/api/admin/settings");
    const s = data.settings || {};
    $("s-shop-name").value = s.SHOP_NAME || "";
    $("s-support-username").value = s.SHOP_SUPPORT_USERNAME || "";
    $("s-banner-text").value = s.SHOP_BANNER_TEXT || "";
    $("s-welcome-greeting").value = s.WELCOME_GREETING || "";
    $("s-bank-name").value = s.SHOP_BANK_NAME || "";
    $("s-bank-account").value = s.SHOP_BANK_ACCOUNT || "";
    $("s-bank-owner").value = s.SHOP_BANK_ACCOUNT_NAME || "";
  } catch (e) {
    toast(`Lỗi tải cài đặt: ${e.message}`, "error");
  } finally {
    setRefresh(false);
  }
}

async function saveSettings() {
  try {
    await api("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        SHOP_NAME: $("s-shop-name").value,
        SHOP_SUPPORT_USERNAME: $("s-support-username").value,
        SHOP_BANNER_TEXT: $("s-banner-text").value,
        WELCOME_GREETING: $("s-welcome-greeting").value,
        SHOP_BANK_NAME: $("s-bank-name").value,
        SHOP_BANK_ACCOUNT: $("s-bank-account").value,
        SHOP_BANK_ACCOUNT_NAME: $("s-bank-owner").value,
      }),
    });
    toast("Đã lưu cài đặt", "success");
  } catch (e) {
    toast(`Lỗi lưu cài đặt: ${e.message}`, "error");
  }
}

// ============ VIP Levels ============

let vipLevelsData = [];

async function loadVipLevels() {
  setLoading("vip-body", 7);
  setRefresh(true);
  try {
    const data = await api("/api/admin/vip-levels");
    vipLevelsData = data.levels || [];
    renderVipTable(vipLevelsData);
  } catch (e) {
    setErrorRow("vip-body", 7, `Lỗi: ${e.message}`);
  } finally {
    setRefresh(false);
  }
}

function renderVipTable(levels) {
  const tbody = $("vip-body");
  if (!levels.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="7">Chưa có dữ liệu VIP. Khởi động lại bot để khởi tạo.</td></tr>`; return; }
  tbody.innerHTML = levels.map(v => `
    <tr>
      <td><span class="vip-badge vip-badge-${v.level}">VIP ${v.level}</span></td>
      <td>${escHtml(v.name || `VIP ${v.level}`)}</td>
      <td>${fmt(v.minSpent)}</td>
      <td>${v.discountPercent || 0}%</td>
      <td>${v.referralBonus || 0}%</td>
      <td>${escHtml(v.benefits || "—")}</td>
      <td><button class="btn btn-secondary btn-sm" data-action="openVipEditModal" data-arg="${v.level}">Sửa</button></td>
    </tr>
  `).join("");
}

function openVipEditModal(level) {
  const v = vipLevelsData.find(x => x.level === level);
  if (!v) return;
  $("vip-edit-level").value = v.level;
  $("vip-modal-title").textContent = `Chỉnh sửa VIP ${v.level}`;
  $("vip-edit-name").value = v.name || "";
  $("vip-edit-min-spent").value = v.minSpent || 0;
  $("vip-edit-discount").value = v.discountPercent || 0;
  $("vip-edit-referral").value = v.referralBonus || 0;
  $("vip-edit-benefits").value = v.benefits || "";
  openModal("vip-edit-modal");
}

async function saveVipLevel() {
  const level = Number($("vip-edit-level").value);
  try {
    await api(`/api/admin/vip-levels/${level}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: $("vip-edit-name").value,
        minSpent: $("vip-edit-min-spent").value,
        discountPercent: $("vip-edit-discount").value,
        referralBonus: $("vip-edit-referral").value,
        benefits: $("vip-edit-benefits").value,
      }),
    });
    toast("Đã cập nhật VIP", "success");
    closeModal("vip-edit-modal");
    loadVipLevels();
  } catch (e) {
    toast(`Lỗi: ${e.message}`, "error");
  }
}

// ============ Referrals ============

let referralsPage = 0;
let referralsTotal = 0;

async function loadReferrals(reset = false) {
  if (reset) referralsPage = 0;
  const skip = referralsPage * PAGE_SIZE;
  setLoading("referrals-body", 5);
  setRefresh(true);
  try {
    const data = await api(`/api/admin/referrals?limit=${PAGE_SIZE}&skip=${skip}`);
    referralsTotal = data.total || 0;
    const rows = data.referrals || [];
    if (!rows.length) { setErrorRow("referrals-body", 5, "Chưa có dữ liệu referral."); return; }
    $("referrals-body").innerHTML = rows.map(r => {
      const referrer = r.referrer;
      const referee = r.referee;
      const nameOf = u => u ? escHtml(u.firstName || u.username || u.telegramId || "—") : "—";
      return `<tr>
        <td>${nameOf(referrer)}<br><small style="color:var(--text-muted)">${escHtml(referrer?.telegramId || "")}</small></td>
        <td>${nameOf(referee)}<br><small style="color:var(--text-muted)">${escHtml(referee?.telegramId || "")}</small></td>
        <td>${fmt(r.commission)}</td>
        <td><span class="badge ${r.status === "PAID" ? "badge-delivered" : "badge-pending"}">${escHtml(r.status || "—")}</span></td>
        <td>${fmtDate(r.createdAt)}</td>
      </tr>`;
    }).join("");
    renderPagination("referrals-pagination", referralsPage, referralsTotal, PAGE_SIZE, "referrals");
  } catch (e) {
    setErrorRow("referrals-body", 5, `Lỗi: ${e.message}`);
  } finally {
    setRefresh(false);
  }
}

function changeReferralsPage(page) {
  const maxPage = Math.ceil(referralsTotal / PAGE_SIZE) - 1;
  referralsPage = Math.max(0, Math.min(maxPage, page));
  loadReferrals();
}

// ============ Stock Items Detail ============

let stockItemsProductId = null;
let stockItemsPage = 0;
let stockItemsTotal = 0;

async function openStockItems() {
  const productId = $("stock-product-select")?.value;
  if (!productId) { toast("Chọn sản phẩm trước", "error"); return; }
  const product = allProducts.find(p => p.id === productId);
  $("stock-items-title").textContent = `Kho: ${product?.name || productId}`;
  stockItemsProductId = productId;
  stockItemsPage = 0;
  openModal("stock-items-modal");
  loadStockItems();
}

async function loadStockItems() {
  if (!stockItemsProductId) return;
  setLoading("stock-items-body", 3);
  try {
    const skip = stockItemsPage * 50;
    const data = await api(`/api/admin/stock/${stockItemsProductId}/items?sold=false&limit=50&skip=${skip}`);
    stockItemsTotal = data.total || 0;
    const items = data.items || [];
    if (!items.length) { setErrorRow("stock-items-body", 3, "Kho trống."); $("stock-items-pagination").innerHTML = ""; return; }
    $("stock-items-body").innerHTML = items.map(item => `
      <tr>
        <td style="font-family:monospace;font-size:12px;word-break:break-all">${escHtml(item.content)}</td>
        <td class="text-muted">${fmtDate(item.createdAt)}</td>
        <td><button class="btn btn-danger btn-sm" data-action="deleteStockItem" data-arg="${escHtml(item.id)}">Xóa</button></td>
      </tr>
    `).join("");
    const maxPage = Math.ceil(stockItemsTotal / 50) - 1;
    $("stock-items-pagination").innerHTML = stockItemsTotal > 50 ? `
      <button class="btn btn-secondary btn-sm" ${stockItemsPage === 0 ? "disabled" : ""} data-action="changeStockItemsPage" data-arg="-1">← Trước</button>
      <span style="padding:0 12px;color:var(--text-muted)">Trang ${stockItemsPage + 1} / ${maxPage + 1} (${stockItemsTotal} items)</span>
      <button class="btn btn-secondary btn-sm" ${stockItemsPage >= maxPage ? "disabled" : ""} data-action="changeStockItemsPage" data-arg="1">Tiếp →</button>
    ` : `<span style="color:var(--text-muted);font-size:13px">${stockItemsTotal} items</span>`;
  } catch (e) {
    setErrorRow("stock-items-body", 3, `Lỗi: ${e.message}`);
  }
}

function changeStockItemsPage(dir) {
  const maxPage = Math.ceil(stockItemsTotal / 50) - 1;
  stockItemsPage = Math.max(0, Math.min(maxPage, stockItemsPage + dir));
  loadStockItems();
}

async function deleteStockItem(itemId) {
  if (!await showConfirm("Xóa dòng stock này?")) return;
  try {
    await api(`/api/admin/stock/${stockItemsProductId}/items/${itemId}`, { method: "DELETE" });
    toast("Đã xóa", "success");
    loadStockItems();
    loadStockCounts();
  } catch (e) {
    toast(`Lỗi: ${e.message}`, "error");
  }
}

// ============ Quick Toggle ============

async function quickToggleProduct(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;
  try {
    await api(`/api/admin/products/${productId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !product.isActive }),
    });
    product.isActive = !product.isActive;
    renderProducts();
  } catch (err) {
    toast(`Lỗi: ${err.message}`, "error");
  }
}

async function quickToggleCategory(categoryId) {
  const cat = allCategories.find(c => c.id === categoryId);
  if (!cat) return;
  try {
    await api(`/api/admin/categories/${categoryId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !cat.isActive }),
    });
    cat.isActive = !cat.isActive;
    renderCategories();
  } catch (err) {
    toast(`Lỗi: ${err.message}`, "error");
  }
}

function goToStock(productId) {
  switchTab("stock");
  setTimeout(() => {
    if ($("stock-product-select")) {
      $("stock-product-select").value = productId;
      loadStockCounts();
      $("stock-textarea").focus();
    }
  }, 120);
}

function onProductModeChange() {
  const mode = $("p-mode")?.value;
  const payloadGroup = $("p-payload-group");
  const stockNotice = $("p-stock-notice");
  if (!payloadGroup || !stockNotice) return;
  if (mode === "STOCK_LINES") {
    payloadGroup.classList.add("hidden");
    stockNotice.classList.remove("hidden");
    stockNotice.textContent = "Chế độ STOCK_LINES: nội dung giao được lấy từ kho hàng.";
  } else {
    payloadGroup.classList.remove("hidden");
    stockNotice.classList.add("hidden");
  }
}

// ============ Bulk Edit ============

let bulkEditSelected = new Set();

function openBulkEditModal() {
  bulkEditSelected = new Set();
  if ($("bulk-edit-search")) $("bulk-edit-search").value = "";
  if ($("bulk-edit-status")) $("bulk-edit-status").textContent = "";
  if ($("bulk-edit-price-val")) $("bulk-edit-price-val").value = "";
  if ($("bulk-edit-cat-select")) $("bulk-edit-cat-select").value = "";
  populateCategorySelects();
  renderBulkEditList();
  openModal("bulk-edit-modal");
}

function renderBulkEditList() {
  const search = ($("bulk-edit-search")?.value || "").toLowerCase().trim();
  const products = allProducts.filter(p =>
    !search ||
    p.name.toLowerCase().includes(search) ||
    (p.code || "").toLowerCase().includes(search)
  );

  const container = $("bulk-edit-list");
  if (!container) return;
  if (!products.length) {
    container.innerHTML = `<p style="text-align:center;padding:24px;color:var(--text-muted)">Không tìm thấy</p>`;
    return;
  }

  container.innerHTML = products.map((p) => {
    const checked = bulkEditSelected.has(p.id);
    return `<label class="bulk-item${checked ? " selected" : ""}">
      <input type="checkbox" ${checked ? "checked" : ""} data-change="onBulkItemCheck" data-arg="${p.id}">
      <div class="bulk-item-info">
        <strong>${escHtml(p.name)}</strong>
        <span class="bulk-item-meta">
          <code>${escHtml(p.code || "")}</code>
          <span class="mode-pill">${escHtml(p.deliveryMode || "")}</span>
          <span class="badge ${p.isActive ? "badge-active" : "badge-inactive"}">${p.isActive ? "Bán" : "Ẩn"}</span>
        </span>
      </div>
      <span class="money">${fmt(p.price)}</span>
    </label>`;
  }).join("");
}

function onBulkItemCheck(productId, checked) {
  if (checked) bulkEditSelected.add(productId);
  else bulkEditSelected.delete(productId);
  const label = $("bulk-edit-list").querySelector(`input[data-change="onBulkItemCheck"][data-arg="${productId}"]`)?.closest(".bulk-item");
  if (label) label.classList.toggle("selected", checked);
  updateBulkEditStatus();
}

function bulkSelectAll() {
  const search = ($("bulk-edit-search")?.value || "").toLowerCase().trim();
  allProducts.filter(p =>
    !search || p.name.toLowerCase().includes(search) || (p.code || "").toLowerCase().includes(search)
  ).forEach(p => bulkEditSelected.add(p.id));
  renderBulkEditList();
}

function bulkSelectNone() {
  bulkEditSelected.clear();
  renderBulkEditList();
}

function updateBulkEditStatus() {
  const n = bulkEditSelected.size;
  if ($("bulk-edit-status")) $("bulk-edit-status").textContent = n ? `Đã chọn ${n} sản phẩm` : "";
}

async function bulkAction(action) {
  if (!bulkEditSelected.size) return toast("Chọn ít nhất 1 sản phẩm", "error");
  const ids = [...bulkEditSelected];
  let body = {};

  if (action === "activate") body = { isActive: true };
  else if (action === "deactivate") body = { isActive: false };
  else if (action === "set-price") {
    const val = Number($("bulk-edit-price-val")?.value);
    if (isNaN(val) || val < 0) return toast("Nhập giá hợp lệ", "error");
    body = { price: val };
  } else if (action === "set-category") {
    const catId = $("bulk-edit-cat-select")?.value || null;
    body = { categoryId: catId };
  } else if (action === "set-mode") {
    const mode = $("bulk-edit-mode-select")?.value;
    if (!mode) return toast("Chọn chế độ giao hàng", "error");
    body = { deliveryMode: mode };
  }

  const labels = { activate: "Bật", deactivate: "Ẩn", "set-price": "Đổi giá", "set-category": "Đổi danh mục", "set-mode": "Đổi chế độ giao" };
  const confirmed = await showConfirm(`${labels[action]} ${ids.length} sản phẩm đã chọn?`);
  if (!confirmed) return;

  let ok = 0, fail = 0;
  for (const id of ids) {
    try {
      await api(`/api/admin/products/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      ok++;
    } catch { fail++; }
  }

  toast(`Thành công ${ok}${fail ? `, lỗi ${fail}` : ""}`, fail ? "error" : "success");
  closeModal("bulk-edit-modal");
  loadProducts();
}

// ============ Bulk Price Edit ============

let bulkPriceChanges = {};

function openBulkPriceModal() {
  bulkPriceChanges = {};
  const searchEl = $("bulk-price-search");
  if (searchEl) searchEl.value = "";
  const statusEl = $("bulk-price-status");
  if (statusEl) statusEl.textContent = "";
  renderBulkPriceList();
  openModal("bulk-price-modal");
}

function renderBulkPriceList() {
  const search = ($("bulk-price-search")?.value || "").toLowerCase().trim();
  const products = allProducts.filter((p) =>
    !search ||
    p.name.toLowerCase().includes(search) ||
    (p.code || "").toLowerCase().includes(search)
  );

  const container = $("bulk-price-list");
  if (!products.length) {
    container.innerHTML = `<p style="text-align:center;padding:24px;color:var(--text-muted)">Không tìm thấy sản phẩm</p>`;
    return;
  }

  container.innerHTML = products.map((p) => {
    const pending = bulkPriceChanges[p.id];
    const currentVal = pending !== undefined ? pending : (p.price ?? 0);
    const changed = pending !== undefined;
    return `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="flex:1;min-width:0;overflow:hidden">
          <strong style="font-size:14px">${escHtml(p.name)}</strong>
          <code style="font-size:12px;color:var(--text-muted);margin-left:6px">${escHtml(p.code || "")}</code>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          <input
            type="number"
            min="0"
            step="1000"
            class="control control-sm"
            style="width:130px;text-align:right;${changed ? "border-color:var(--accent);background:var(--accent-soft)" : ""}"
            value="${currentVal}"
            data-product-id="${escHtml(p.id)}"
            data-original="${p.price ?? 0}"
            data-input="onBulkPriceInput"
          >
          <span style="font-size:13px;color:var(--text-muted)">đ</span>
        </div>
      </div>`;
  }).join("");
}

function onBulkPriceInput(input) {
  const productId = input.dataset.productId;
  const original = Number(input.dataset.original);
  const newVal = Number(input.value) || 0;

  if (newVal !== original) {
    bulkPriceChanges[productId] = newVal;
    input.style.borderColor = "var(--accent)";
    input.style.background = "var(--accent-soft)";
  } else {
    delete bulkPriceChanges[productId];
    input.style.borderColor = "";
    input.style.background = "";
  }

  const count = Object.keys(bulkPriceChanges).length;
  const statusEl = $("bulk-price-status");
  if (statusEl) statusEl.textContent = count > 0 ? `${count} sản phẩm đã thay đổi` : "";
}

async function saveBulkPrices() {
  const ids = Object.keys(bulkPriceChanges);
  if (!ids.length) { toast("Chưa có thay đổi nào", "error"); return; }

  const statusEl = $("bulk-price-status");
  if (statusEl) statusEl.textContent = `Đang lưu ${ids.length} sản phẩm...`;

  let success = 0, failed = 0;
  for (const productId of ids) {
    try {
      await api(`/api/admin/products/${productId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price: bulkPriceChanges[productId] }),
      });
      success++;
    } catch { failed++; }
  }

  bulkPriceChanges = {};
  if (failed === 0) {
    toast(`Đã cập nhật giá ${success} sản phẩm`, "success");
    closeModal("bulk-price-modal");
    loadProducts();
  } else {
    toast(`Lưu ${success} OK, ${failed} thất bại`, "error");
    if (statusEl) statusEl.textContent = `${success} OK, ${failed} thất bại`;
    loadProducts();
  }
}

// ============ Image Upload ============

function switchImgTab(tab) {
  document.querySelectorAll(".img-tab").forEach(b => b.classList.toggle("active", b.textContent.toLowerCase() === (tab === "url" ? "url" : "upload")));
  $("img-tab-url").classList.toggle("hidden", tab !== "url");
  $("img-tab-upload").classList.toggle("hidden", tab !== "upload");
}

function previewImage() {
  const url = ($("p-image-url")?.value || "").trim();
  const wrap = $("img-preview-wrap");
  const img = $("img-preview");
  if (url) { img.src = url; wrap.classList.remove("hidden"); }
  else wrap.classList.add("hidden");
}

function clearImage() {
  if ($("p-image-url")) $("p-image-url").value = "";
  $("img-preview-wrap").classList.add("hidden");
  if ($("img-preview")) $("img-preview").src = "";
}

async function uploadImageFile(file) {
  if (!file) return;
  const progress = $("upload-progress");
  progress.classList.remove("hidden");
  progress.textContent = "Đang tải lên...";
  try {
    const form = new FormData();
    form.append("image", file);
    const res = await fetch(`/api/admin/upload/image?secret=${encodeURIComponent(SECRET)}`, { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok || !data.url) throw new Error(data.error || "Upload thất bại");
    $("p-image-url").value = data.url;
    previewImage();
    switchImgTab("url");
    toast("Tải ảnh lên thành công", "success");
  } catch (e) {
    toast(`Lỗi upload: ${e.message}`, "error");
  } finally {
    progress.classList.add("hidden");
    progress.textContent = "";
  }
}

function handleImageDrop(e) {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type.startsWith("image/")) uploadImageFile(file);
}

// ============ Global Search ============

function onGlobalSearch() {
  clearTimeout(globalSearchTimer);
  globalSearchTimer = setTimeout(doGlobalSearch, 300);
}

async function doGlobalSearch() {
  const input = $("global-search-input");
  const dropdown = $("search-dropdown");
  if (!input || !dropdown) return;

  const query = input.value.trim();
  if (!query || query.length < 2) {
    dropdown.classList.remove("open");
    return;
  }

  dropdown.innerHTML = `<div class="search-empty"><span class="spinner"></span></div>`;
  dropdown.classList.add("open");

  try {
    const [ordersData, productsData, usersData] = await Promise.allSettled([
      api(`/api/admin/orders?search=${encodeURIComponent(query)}&limit=5`),
      api(`/api/admin/products?search=${encodeURIComponent(query)}&limit=5`).catch(() =>
        // fallback: filter from cache
        ({ products: allProducts.filter(p => p.name.toLowerCase().includes(query.toLowerCase()) || (p.code || "").toLowerCase().includes(query.toLowerCase())).slice(0, 5) })
      ),
      api(`/api/admin/users?search=${encodeURIComponent(query)}&limit=5`),
    ]);

    const orders = ordersData.status === "fulfilled" ? (ordersData.value.orders || []) : [];
    const products = productsData.status === "fulfilled" ? (productsData.value.products || []) : [];
    const users = usersData.status === "fulfilled" ? (usersData.value.users || []) : [];

    if (!orders.length && !products.length && !users.length) {
      dropdown.innerHTML = `<div class="search-empty">Không tìm thấy kết quả cho "${escHtml(query)}"</div>`;
      return;
    }

    let html = "";

    if (orders.length) {
      html += `<div class="search-group-title">Đơn hàng</div>`;
      orders.forEach(o => {
        const shortId = (o.id || "").slice(-8).toUpperCase();
        const user = o.user?.firstName || o.user?.username || o.odelegramId || "—";
        html += `<div class="search-item" data-action="openOrderFromSearch" data-arg="${o.id}">
          <span class="search-item-icon">📋</span>
          <div>
            <div class="search-item-title">#${escHtml(shortId)} — ${escHtml(user)}</div>
            <div class="search-item-sub">${escHtml(o.product?.name || "—")} • ${statusBadge(o.status)}</div>
          </div>
        </div>`;
        ordersCache.set(o.id, o);
      });
    }

    if (products.length) {
      html += `<div class="search-group-title">Sản phẩm</div>`;
      products.forEach(p => {
        html += `<div class="search-item" data-action="openProductFromSearch" data-arg="${p.id}">
          <span class="search-item-icon">📦</span>
          <div>
            <div class="search-item-title">${escHtml(p.name)}</div>
            <div class="search-item-sub">${escHtml(p.code || "")} • ${fmt(p.price)}</div>
          </div>
        </div>`;
      });
    }

    if (users.length) {
      html += `<div class="search-group-title">Người dùng</div>`;
      users.forEach(u => {
        const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || "—";
        html += `<div class="search-item" data-action="openUserFromSearch" data-arg="${escHtml(jsString(u.telegramId || ""))}">
          <span class="search-item-icon">👤</span>
          <div>
            <div class="search-item-title">${escHtml(name)}</div>
            <div class="search-item-sub">${u.username ? "@" + escHtml(u.username) + " • " : ""}ID: ${escHtml(u.telegramId || "")}</div>
          </div>
        </div>`;
      });
    }

    dropdown.innerHTML = html;
  } catch (err) {
    dropdown.innerHTML = `<div class="search-empty">Lỗi tìm kiếm: ${escHtml(err.message)}</div>`;
  }
}

function closeSearchDropdown() {
  const dropdown = $("search-dropdown");
  if (dropdown) dropdown.classList.remove("open");
}

function openOrderFromSearch(orderId) {
  closeSearchDropdown();
  if ($("global-search-input")) $("global-search-input").value = "";
  switchTab("orders");
  setTimeout(() => {
    if (ordersCache.has(orderId)) openOrderDetailModal(orderId);
    else loadOrders(true);
  }, 200);
}

function openProductFromSearch(productId) {
  closeSearchDropdown();
  if ($("global-search-input")) $("global-search-input").value = "";
  switchTab("products");
  setTimeout(() => {
    if (allProducts.length) openProductModalById(productId);
    else loadProducts().then(() => openProductModalById(productId));
  }, 200);
}

function openUserFromSearch(telegramId) {
  closeSearchDropdown();
  if ($("global-search-input")) $("global-search-input").value = "";
  openWalletForUser(telegramId);
}

// ============ Notifications ============

async function pollNotifications() {
  if (!SECRET) return;
  try {
    const data = await api("/api/admin/orders?status=PENDING&limit=5");
    const orders = data.orders || [];
    const count = data.total || orders.length;

    const badge = $("notif-badge");
    const list = $("notif-list");
    if (!badge || !list) return;

    if (count > 0) {
      badge.textContent = count > 99 ? "99+" : count;
      badge.classList.add("visible");
    } else {
      badge.classList.remove("visible");
    }

    if (!orders.length) {
      list.innerHTML = `<div class="notif-empty">Không có đơn hàng chờ</div>`;
      return;
    }

    list.innerHTML = orders.map(o => {
      const user = o.user?.firstName || o.user?.username || o.odelegramId || "—";
      const shortId = (o.id || "").slice(-8).toUpperCase();
      return `<div class="notif-item" data-action="openOrderFromSearch" data-arg="${o.id}">
        <span class="notif-item-icon">⏳</span>
        <div>
          <div class="notif-item-title">#${escHtml(shortId)} — ${escHtml(user)}</div>
          <div class="notif-item-sub">${escHtml(o.product?.name || "—")} • ${fmt(o.finalAmount)} • ${fmtDate(o.createdAt)}</div>
        </div>
      </div>`;
    }).join("");
    orders.forEach(o => ordersCache.set(o.id, o));
  } catch {
    /* silent fail for notifications */
  }
}

function toggleNotifDropdown() {
  const dropdown = $("notif-dropdown");
  if (!dropdown) return;
  const isOpen = dropdown.classList.contains("open");
  closeAllDropdowns();
  if (!isOpen) dropdown.classList.add("open");
}

function closeNotifDropdown() {
  $("notif-dropdown")?.classList.remove("open");
}

function closeAllDropdowns() {
  $("notif-dropdown")?.classList.remove("open");
  $("search-dropdown")?.classList.remove("open");
}

// ============ Theme ============

function toggleTheme() {
  const root = document.documentElement;
  const isDark = root.getAttribute("data-theme") === "dark";
  const next = isDark ? "light" : "dark";
  root.setAttribute("data-theme", next);
  localStorage.setItem("admin-theme", next);
  const icon = $("theme-icon");
  if (icon) icon.textContent = next === "dark" ? "☀️" : "🌙";
}

(function applyInitialTheme() {
  try {
    const saved = localStorage.getItem("admin-theme");
    if (saved === "dark" || saved === "light") {
      document.documentElement.setAttribute("data-theme", saved);
      const icon = $("theme-icon");
      if (icon) icon.textContent = saved === "dark" ? "☀️" : "🌙";
    }
  } catch { /* ignore */ }
})();

// ============ Event Listeners ============

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    document.querySelectorAll(".modal-overlay.open").forEach((modal) => modal.classList.remove("open"));
    if (_dialogResolve) { _dialogResolve(false); _dialogResolve = null; }
    closeSidebar();
    closeAllDropdowns();
  }
  // Ctrl+K / Cmd+K to focus search
  if ((event.ctrlKey || event.metaKey) && event.key === "k") {
    event.preventDefault();
    const input = $("global-search-input");
    if (input) { input.focus(); input.select(); }
  }
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

// Close dropdowns when clicking outside
document.addEventListener("click", (ev) => {
  const searchWrap = $("global-search-wrap");
  const notifWrap = $("notif-wrap");

  if (searchWrap && !searchWrap.contains(ev.target)) {
    closeSearchDropdown();
  }
  if (notifWrap && !notifWrap.contains(ev.target)) {
    closeNotifDropdown();
  }
}, true);

$("secret-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter") doLogin();
});

$("ec-name").addEventListener("input", syncEditCategoryPreview);

// ============ Boot ============

const savedSecret = localStorage.getItem("admin_secret");
if (savedSecret) {
  SECRET = savedSecret;
  testAndEnter();
}

// ============ Exports ============

// Enter key support
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  if (document.activeElement?.id === "tele-id-input") requestOtp();
  if (document.activeElement?.id === "otp-input") verifyOtp();
  if (document.activeElement?.id === "login-username") $("login-password").focus();
  if (document.activeElement?.id === "login-password") doLoginPw();
});

// Restore tele-id if saved
const savedTeleId = localStorage.getItem("admin_tele_id");
if (savedTeleId && $("tele-id-input")) $("tele-id-input").value = savedTeleId;

Object.assign(window, {
  doLogin, doLogout, requestOtp, verifyOtp, resetOtpStep, switchLoginTab, doLoginPw,
  toggleSidebar, closeSidebar,
  switchTab,
  loadDashboard,
  loadOrders,
  onOrdersSearch: () => {
    clearTimeout(ordersSearchTimer);
    ordersSearchTimer = setTimeout(() => loadOrders(true), 400);
  },
  loadProducts, renderProducts,
  quickToggleProduct, quickToggleCategory,
  onProductModeChange, goToStock,
  openBulkEditModal, renderBulkEditList, onBulkItemCheck, bulkSelectAll, bulkSelectNone, bulkAction,
  openBulkPriceModal, renderBulkPriceList, onBulkPriceInput, saveBulkPrices,
  openProductModal, openProductModalById,
  saveProduct, toggleProduct, deleteProduct,
  loadCategories,
  openCategoryModal, saveCategory,
  openEditCategoryModal, syncEditCategoryPreview, saveEditCategory,
  deleteCategory,
  loadStockTab, loadStockCounts, submitStock,
  openStockItems, loadStockItems, changeStockItemsPage, deleteStockItem,
  clearStock,
  loadUsers, onUsersSearch,
  setUserVip, toggleUserBlock,
  openWalletForUser, loadWallet, adjustWallet,
  loadCoupons, createCoupon, toggleCoupon, deleteCouponAdmin,
  loadBroadcasts, sendAdminBroadcast,
  loadVipLevels, openVipEditModal, saveVipLevel,
  loadReferrals, changeReferralsPage,
  loadSettings, saveSettings,
  switchImgTab, previewImage, clearImage, uploadImageFile, handleImageDrop,
  loadSystem, loadLogs, loadBackups, createBackupNow,
  downloadExport,
  changeOrdersPage, changeUsersPage,
  openOrderDetailModal, openOrderStatusModal,
  saveOrderDetailStatus, saveOrderStatus,
  closeModal, openModal,
  _dialogOk, _dialogCancel: window._dialogCancel,
  showConfirm, showPrompt,
  toggleTheme,
  onGlobalSearch, closeSearchDropdown,
  openOrderFromSearch, openProductFromSearch, openUserFromSearch,
  toggleNotifDropdown, closeNotifDropdown,
  pollNotifications,
});

// ============ Event Delegation ============

function _coerceArg(v) {
  if (v === undefined || v === null) return v;
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null") return null;
  if (v === "") return "";
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}

function _collectArgs(el) {
  const args = [];
  if ("arg" in el.dataset) args.push(_coerceArg(el.dataset.arg));
  let i = 2;
  while (`arg${i}` in el.dataset) {
    args.push(_coerceArg(el.dataset[`arg${i}`]));
    i++;
  }
  return args;
}

function _invokeFromData(el, kind, ev) {
  const fnName = el.dataset[kind];
  if (!fnName) return;
  const fn = window[fnName];
  if (typeof fn !== "function") {
    console.warn(`[delegate] missing handler: ${fnName}`);
    return;
  }
  const args = _collectArgs(el);
  if (fnName === "onBulkItemCheck" && el.tagName === "INPUT") {
    args.push(el.checked);
  }
  if (fnName === "onBulkPriceInput") {
    fn(el);
    return;
  }
  if (fnName === "uploadImageFile" && el.tagName === "INPUT" && el.type === "file") {
    fn(el.files?.[0]);
    return;
  }
  try {
    fn(...args);
  } catch (err) {
    console.error(`[delegate] error in ${fnName}:`, err);
  }

  if (kind === "action") {
    const then = el.dataset.actionThen;
    if (then && typeof window[then] === "function") {
      const thenArgs = [];
      let i = 1;
      while (`thenArg${i}` in el.dataset) {
        thenArgs.push(_coerceArg(el.dataset[`thenArg${i}`]));
        i++;
      }
      try { window[then](...thenArgs); } catch (err) {
        console.error(`[delegate] error in chained ${then}:`, err);
      }
    }
  }
}

document.addEventListener("click", (ev) => {
  const target = ev.target.closest("[data-action]");
  if (!target) return;
  if (target.dataset.action === "openImageFilePicker") {
    document.getElementById("p-image-file")?.click();
    return;
  }
  _invokeFromData(target, "action", ev);
});

document.addEventListener("input", (ev) => {
  const el = ev.target.closest("[data-input]");
  if (!el) return;
  _invokeFromData(el, "input", ev);
});

document.addEventListener("change", (ev) => {
  const el = ev.target.closest("[data-change]");
  if (!el) return;
  _invokeFromData(el, "change", ev);
});

document.addEventListener("submit", (ev) => {
  const form = ev.target.closest("[data-submit]");
  if (!form) return;
  ev.preventDefault();
  _invokeFromData(form, "submit", ev);
});
