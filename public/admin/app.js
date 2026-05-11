let SECRET = "";
let currentTab = "dashboard";
let ordersPage = 0;
let usersPage = 0;
let ordersTotal = 0;
let usersTotal = 0;
let allCategories = [];
let allProducts = [];
let editingOrderId = null;
let dashboardInterval = null;

const PAGE_SIZE = 20;

const pageInfo = {
  dashboard: ["Dashboard", "Tổng quan vận hành cửa hàng."],
  orders: ["Đơn hàng", "Theo dõi thanh toán và trạng thái giao hàng."],
  products: ["Sản phẩm", "Quản lý sản phẩm, giá bán và nội dung giao."],
  categories: ["Danh mục", "Sắp xếp nhóm sản phẩm trong shop."],
  stock: ["Kho hàng", "Nạp và kiểm tra tồn kho tự động."],
  users: ["Người dùng", "Theo dõi khách hàng, ví và cấp VIP."],
};

const $ = (id) => document.getElementById(id);

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

function api(path, opts = {}) {
  const sep = path.includes("?") ? "&" : "?";
  return fetch(`${path}${sep}secret=${encodeURIComponent(SECRET)}`, opts).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  });
}

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

function openModal(id) {
  $(id)?.classList.add("open");
}

function closeModal(id) {
  $(id)?.classList.remove("open");
}

function toggleSidebar() {
  $("sidebar").classList.toggle("open");
  $("sidebar-overlay").classList.toggle("open");
}

function closeSidebar() {
  $("sidebar").classList.remove("open");
  $("sidebar-overlay").classList.remove("open");
}

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
    { icon: "₫", label: "Doanh thu hôm nay", value: fmt(stats.todayRevenue), note: "Đơn đã giao trong ngày" },
    { icon: "Σ", label: "Tổng doanh thu", value: fmt(stats.totalRevenue), note: "Tất cả đơn đã giao" },
    { icon: "#", label: "Đơn hôm nay", value: stats.todayOrders ?? 0, note: `${stats.totalOrders ?? 0} đơn toàn hệ thống` },
    { icon: "!", label: "Đơn chờ", value: stats.pendingOrders ?? 0, note: "Cần kiểm tra thanh toán" },
    { icon: "U", label: "Người dùng", value: stats.totalUsers ?? 0, note: "Tổng tài khoản đã ghi nhận" },
    { icon: "P", label: "Sản phẩm", value: stats.totalProducts ?? 0, note: "Sản phẩm đang bán" },
  ];

  $("stat-grid").innerHTML = items.map((item) => `
    <article class="stat-card">
      <div class="stat-top">
        <span class="stat-icon">${escHtml(item.icon)}</span>
      </div>
      <div>
        <span class="stat-label">${escHtml(item.label)}</span>
        <strong class="stat-value">${escHtml(item.value)}</strong>
      </div>
      <span class="stat-note">${escHtml(item.note)}</span>
    </article>
  `).join("");
}

async function loadOrders(reset = false) {
  if (reset) ordersPage = 0;
  const status = $("order-status-filter").value;
  const skip = ordersPage * PAGE_SIZE;
  const url = `/api/admin/orders?limit=${PAGE_SIZE}&skip=${skip}${status ? `&status=${encodeURIComponent(status)}` : ""}`;

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
  if (!orders.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${cols}">Không có dữ liệu</td></tr>`;
    return;
  }

  tbody.innerHTML = orders.map((order) => {
    const user = order.user
      ? (order.user.firstName || order.user.username || order.user.telegramId || "?")
      : "?";
    const shortId = order.id ? order.id.slice(-8).toUpperCase() : "?";
    const rowAttrs = clickable ? `class="clickable" onclick="openOrderStatusModal('${order.id}', '${order.status || ""}')"` : "";

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

function openOrderStatusModal(orderId, currentStatus) {
  editingOrderId = orderId;
  $("order-modal-info").textContent = `Đơn hàng ...${orderId.slice(-8).toUpperCase()}`;
  $("order-new-status").value = currentStatus;
  openModal("order-status-modal");
}

async function saveOrderStatus() {
  if (!editingOrderId) return;
  const status = $("order-new-status").value;
  try {
    await api(`/api/admin/orders/${editingOrderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    toast("Đã cập nhật trạng thái đơn hàng", "success");
    closeModal("order-status-modal");
    loadOrders();
    if (currentTab === "dashboard") loadDashboard();
  } catch (err) {
    toast(`Lỗi: ${err.message}`, "error");
  }
}

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

    return `<tr>
      <td>
        <div class="truncate"><strong>${escHtml(product.name)}</strong></div>
        <code>${escHtml(product.code || "—")}</code>
      </td>
      <td>${category}</td>
      <td><span class="money">${fmt(product.price)}</span></td>
      <td><span class="mode-pill">${escHtml(product.deliveryMode || "—")}</span></td>
      <td>${stockText}</td>
      <td>${product.isActive ? `<span class="badge badge-active">Đang bán</span>` : `<span class="badge badge-inactive">Tắt</span>`}</td>
      <td>
        <div class="row-actions">
          <button class="btn btn-secondary btn-sm" type="button" onclick="openProductModalById('${product.id}')">Sửa</button>
          <button class="btn btn-danger btn-sm" type="button" onclick="deleteProduct('${product.id}')">Tắt</button>
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
  $("p-mode").value = product?.deliveryMode || "TEXT";
  $("p-category").value = product?.categoryId || "";
  $("p-description").value = product?.description || "";
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
    deliveryMode: $("p-mode").value,
    categoryId: $("p-category").value || null,
    description: $("p-description").value.trim(),
    payload: $("p-payload").value.trim(),
  };

  if (id) body.isActive = $("p-active").value === "true";
  if (!body.name) return toast("Vui lòng nhập tên sản phẩm", "error");
  if (!body.code) return toast("Vui lòng nhập mã sản phẩm", "error");

  try {
    const request = {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };
    await api(id ? `/api/admin/products/${id}` : "/api/admin/products", request);
    toast(id ? "Đã cập nhật sản phẩm" : "Đã thêm sản phẩm", "success");
    closeModal("product-modal");
    loadProducts();
  } catch (err) {
    toast(`Lỗi: ${err.message}`, "error");
  }
}

async function deleteProduct(productId) {
  const product = allProducts.find((item) => item.id === productId);
  const name = product?.name || productId;
  if (!confirm(`Tắt sản phẩm "${name}"?`)) return;

  try {
    await api(`/api/admin/products/${productId}`, { method: "DELETE" });
    toast("Đã tắt sản phẩm", "success");
    loadProducts();
  } catch (err) {
    toast(`Lỗi: ${err.message}`, "error");
  }
}

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
  if (!confirm(`Tắt danh mục "${name}"?`)) return;

  try {
    await api(`/api/admin/categories/${categoryId}`, { method: "DELETE" });
    toast("Đã tắt danh mục", "success");
    loadCategories();
  } catch (err) {
    toast(`Lỗi: ${err.message}`, "error");
  }
}

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

async function loadUsers(reset = false) {
  if (reset) usersPage = 0;
  const skip = usersPage * PAGE_SIZE;
  setLoading("users-body", 7);

  try {
    const data = await api(`/api/admin/users?limit=${PAGE_SIZE}&skip=${skip}`);
    usersTotal = data.total || 0;
    renderUsers(data.users || []);
    renderPagination("users-pagination", usersPage, usersTotal, PAGE_SIZE, "users");
  } catch (err) {
    toast(`Lỗi tải người dùng: ${err.message}`, "error");
    setErrorRow("users-body", 7, "Lỗi tải dữ liệu");
  }
}

function renderUsers(users) {
  const tbody = $("users-body");
  if (!users.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">Không có dữ liệu</td></tr>`;
    return;
  }

  tbody.innerHTML = users.map((user) => {
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || "—";
    const balance = user.walletBalance ?? user.balance ?? 0;
    return `<tr>
      <td><code>${escHtml(user.telegramId || "—")}</code></td>
      <td class="truncate">${escHtml(name)}</td>
      <td class="truncate">${user.username ? `@${escHtml(user.username)}` : `<span class="text-muted">—</span>`}</td>
      <td><span class="money">${fmt(balance)}</span></td>
      <td>${user._count?.orders ?? 0}</td>
      <td><span class="badge badge-paid">VIP ${user.vipLevel ?? 0}</span></td>
      <td class="text-muted">${fmtDate(user.createdAt)}</td>
    </tr>`;
  }).join("");
}

function renderPagination(containerId, page, total, pageSize, type) {
  const container = $(containerId);
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  const from = page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);
  const prev = page - 1;
  const next = page + 1;
  const handler = type === "orders" ? "changeOrdersPage" : "changeUsersPage";

  container.innerHTML = `
    <span>${from}-${to} / ${total}</span>
    <button class="btn btn-secondary btn-sm" type="button" ${page === 0 ? "disabled" : ""} onclick="${handler}(${prev})">Trước</button>
    <button class="btn btn-secondary btn-sm" type="button" ${page >= totalPages - 1 ? "disabled" : ""} onclick="${handler}(${next})">Sau</button>
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

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  document.querySelectorAll(".modal-overlay.open").forEach((modal) => modal.classList.remove("open"));
  closeSidebar();
});

document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.classList.remove("open");
  });
});

$("ec-name").addEventListener("input", syncEditCategoryPreview);
$("secret-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter") doLogin();
});

const savedSecret = localStorage.getItem("admin_secret");
if (savedSecret) {
  SECRET = savedSecret;
  testAndEnter();
}

Object.assign(window, {
  doLogin,
  doLogout,
  toggleSidebar,
  closeSidebar,
  switchTab,
  loadDashboard,
  loadOrders,
  loadProducts,
  renderProducts,
  openProductModal,
  openProductModalById,
  saveProduct,
  deleteProduct,
  loadCategories,
  openCategoryModal,
  saveCategory,
  openEditCategoryModal,
  syncEditCategoryPreview,
  saveEditCategory,
  deleteCategory,
  loadStockTab,
  loadStockCounts,
  submitStock,
  loadUsers,
  changeOrdersPage,
  changeUsersPage,
  openOrderStatusModal,
  saveOrderStatus,
  closeModal,
});
