const API = '/api/admin';
let token = localStorage.getItem('admin_token') || '';
let currentPage = 'dashboard';

// ─── UTILS ────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmt = n => new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND'}).format(n||0);
const fmtDate = d => new Date(d).toLocaleString('vi-VN');
const debounce = (f, t) => { let id; return (...a) => { clearTimeout(id); id=setTimeout(()=>f(...a), t); }; };

// ─── MOBILE SIDEBAR ───────────────────────────────────────────────
function toggleSidebar() {
  const s = $('sidebar'), o = $('sidebar-overlay'), h = $('hamburger');
  s.classList.toggle('open');
  o.classList.toggle('open');
  h.classList.toggle('open');
}
function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebar-overlay').classList.remove('open');
  $('hamburger').classList.remove('open');
}

function toast(msg, type = 'ok') {
  const c = $('toast-container');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = msg;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity=0; setTimeout(()=>t.remove(), 300); }, 3000);
}

async function api(method, path, body = null) {
  const headers = { 'Authorization': `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : null });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 && path !== '/login') doLogout();
    throw new Error(data.error || 'Lỗi hệ thống');
  }
  return data;
}

// ─── NAVIGATION ───────────────────────────────────────────────────
function nav(page) {
  closeSidebar(); // đóng sidebar trên mobile khi chọn trang
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(p => p.classList.remove('active'));
  $(`page-${page}`).classList.remove('hidden');
  const n = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (n) n.classList.add('active');
  currentPage = page;
  
  const titles = {
    dashboard: '📊 Dashboard', products: '📦 Sản phẩm', categories: '📂 Danh mục',
    stock: '🗝️ Kho hàng', orders: '🧾 Đơn hàng', users: '👥 Người dùng', transactions: '💰 Giao dịch'
  };
  $('page-title').textContent = titles[page];
  
  if (page === 'dashboard') loadDashboard();
  if (page === 'products') { loadCatFilter(); loadProducts(0); }
  if (page === 'categories') loadCategories();
  if (page === 'stock') loadStockInit();
  if (page === 'orders') loadOrders(0);
  if (page === 'users') loadUsers(0);
  if (page === 'transactions') loadTransactions(0);
  if (page === 'coupons') loadCoupons();
  if (page === 'vip') loadVipLevels();
  if (page === 'broadcast') loadBroadcasts();
}

// ─── AUTH ─────────────────────────────────────────────────────────
async function doLogin() {
  const pw = $('login-pw').value;
  try {
    const d = await api('POST', '/login', { password: pw });
    token = d.token;
    localStorage.setItem('admin_token', token);
    $('login-view').style.display = 'none';
    $('app').style.display = 'flex';
    nav('dashboard');
  } catch(e) { $('login-err').textContent = e.message; }
}

function doLogout() {
  token = ''; localStorage.removeItem('admin_token');
  $('login-view').style.display = 'flex';
  $('app').style.display = 'none';
  $('login-pw').value = '';
}

// ─── MODAL UTILS ──────────────────────────────────────────────────
function showModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }

// ─── PAGINATION BUILDER ───────────────────────────────────────────
function buildPager(total, page, limit, callbackName) {
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) return `<div class="pager"><span>Tổng: ${total}</span></div>`;
  
  let btns = '';
  for (let i = 0; i < totalPages; i++) {
    if (i === 0 || i === totalPages - 1 || Math.abs(i - page) <= 2) {
      btns += `<button class="pager-btn ${i===page?'active':''}" onclick="${callbackName}(${i})">${i+1}</button>`;
    } else if (Math.abs(i - page) === 3) {
      btns += `<span style="padding:0 4px">...</span>`;
    }
  }
  return `<div class="pager"><span>Tổng: ${total}</span> <div class="pager-btns">${btns}</div></div>`;
}

// ─── DASHBOARD ────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const stats = await api('GET', '/stats');
    $('s-rev-today').textContent = fmt(stats.todayRevenue);
    $('s-rev-month').textContent = `Tháng: ${fmt(stats.monthRevenue)}`;
    $('s-ord-today').textContent = stats.todayOrders;
    $('s-ord-month').textContent = `Tháng: ${stats.monthOrders}`;
    $('s-users').textContent = stats.totalUsers;
    $('s-users-new').textContent = `Hôm nay: +${stats.newUsers}`;
    $('s-low').textContent = stats.lowStockCount;
    $('s-prod-total').textContent = `${stats.totalProducts} sản phẩm đang bán`;
    
    $('s-rev-total').textContent = fmt(stats.totalRevenue);
    $('s-ord-total').textContent = stats.totalOrders;
    $('s-rev-month2').textContent = fmt(stats.monthRevenue);
    $('s-ord-month2').textContent = stats.monthOrders;
    
    const chartData = await api('GET', '/stats/chart');
    if (window.drawRevenueChart) drawRevenueChart(chartData);

    // #8 — Donut chart đơn theo trạng thái
    try {
      const orderStats = await api('GET', '/stats/order-status');
      if (window.drawDonutChart) drawDonutChart(orderStats);
    } catch(e) {}

    // #9 — Referral leaderboard
    try {
      const refs = await api('GET', '/referrals/leaderboard');
      const el = $('referral-leaderboard');
      if (el && refs.length) {
        el.innerHTML = refs.map((r, i) => `
          <div class="flex-center" style="padding:8px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:18px;width:28px">${['\uD83E\uDD47','\uD83E\uDD48','\uD83E\uDD49'][i]||'\uD83D\uDD35'}</span>
            <span class="fw-medium" style="flex:1">${r.username||r.firstName||'User'}</span>
            <span class="badge badge-green">${r._count?.referredUsers||0} ng\u01B0\u1EDDi</span>
          </div>`).join('');
      }
    } catch(e) {}

    const d = await api('GET', '/orders?page=0&limit=8');
    const table = $('dash-orders-table');
    table.innerHTML = d.orders.length ? d.orders.map(o => `
      <tr>
        <td><code>${o.orderCode}</code></td>
        <td>${o.user?.firstName||''}</td>
        <td><span class="truncate" style="display:block">${o.items?.[0]?.productNameSnapshot||'—'}</span></td>
        <td class="fw-bold">${fmt(o.finalAmount)}</td>
        <td>${getOrdBadge(o.status)}</td>
        <td>${fmtDate(o.createdAt)}</td>
      </tr>
    `).join('') : `<tr><td colspan="6" class="empty-state"><p>Chưa có đơn hàng</p></td></tr>`;
  } catch(e) { console.error(e); }
}

function getOrdBadge(s) {
  const m = { COMPLETED: ['green','Hoàn thành'], PENDING_PAYMENT: ['yellow','Chờ thanh toán'], CANCELLED: ['gray','Đã huỷ'], FAILED: ['red','Thất bại'] };
  return `<span class="badge badge-${m[s]?.[0]||'gray'}">${m[s]?.[1]||s}</span>`;
}

// ─── PRODUCTS ─────────────────────────────────────────────────────
let prodPage = 0;
let editProdId = null;

async function loadCatFilter() {
  try {
    const cats = await api('GET', '/categories');
    const c = $('prod-filter-cat');
    c.innerHTML = '<option value="">Tất cả danh mục</option>' + cats.map(x => `<option value="${x.id}">${x.name}</option>`).join('');
    const c2 = $('p-cat');
    c2.innerHTML = '<option value="">-- Không chọn --</option>' + cats.map(x => `<option value="${x.id}">${x.name}</option>`).join('');
  } catch(e){}
}

async function loadProducts(page = prodPage) {
  prodPage = page;
  const q = $('prod-search').value;
  const cat = $('prod-filter-cat').value;
  const stat = $('prod-filter-status').value;
  
  try {
    const res = await api('GET', `/products?page=0&limit=500`); // Lấy hết lọc cho lẹ (nếu ít)
    let list = res.products || res;
    
    if (q) list = list.filter(p => p.name.toLowerCase().includes(q.toLowerCase()));
    if (cat) list = list.filter(p => p.categoryId === cat);
    if (stat) list = list.filter(p => p.isActive === (stat==='active'));
    
    const limit = 15;
    const total = list.length;
    const paginated = list.slice(page * limit, (page + 1) * limit);
    
    $('prod-table').innerHTML = paginated.length ? paginated.map(p => `
      <tr>
        <td class="fw-medium">${p.thumbnailEmoji||'📦'} ${p.name}</td>
        <td><span class="tag">${p.category?.name||'—'}</span></td>
        <td class="fw-bold">${fmt(p.basePrice)}</td>
        <td class="text-accent2">${p.vipPrice?fmt(p.vipPrice):'—'}</td>
        <td><span class="badge ${p.stockCount<5?'badge-red':'badge-gray'}">${p.stockMode==='UNLIMITED'?'∞':p.stockCount}</span></td>
        <td>
          <label class="toggle-switch" title="${p.isActive?'Đang bán — nhấn để ẩn':'Đã ẩn — nhấn để hiện'}">
            <input type="checkbox" ${p.isActive?'checked':''} onchange="toggleProduct('${p.id}',${p.isActive})">
            <span class="toggle-slider"></span>
          </label>
        </td>
        <td>
          <button class="btn btn-xs btn-blue" onclick='openProductModal(${JSON.stringify(p).replace(/'/g,"&#39;")})'>Sửa</button>
        </td>
      </tr>
    `).join('') : `<tr><td colspan="7" class="empty-state"><p>Không tìm thấy sản phẩm</p></td></tr>`;
    
    $('prod-pager').innerHTML = buildPager(total, page, limit, 'loadProducts');
  } catch(e) { toast(e.message, 'err'); }
}

function openProductModal(p) {
  editProdId = p ? p.id : null;
  $('modal-prod-title').textContent = p ? 'Sửa sản phẩm' : 'Thêm sản phẩm';
  $('p-name').value = p?.name||''; $('p-slug').value = p?.slug||'';
  $('p-emoji').value = p?.thumbnailEmoji||''; $('p-price').value = p?.basePrice||'';
  $('p-vip').value = p?.vipPrice||''; $('p-type').value = p?.productType||'AUTO_DELIVERY';
  $('p-deltype').value = p?.deliveryType||'DIGITAL_CODE'; $('p-stockmode').value = p?.stockMode||'TRACKED';
  $('p-cat').value = p?.categoryId||''; $('p-desc').value = p?.shortDescription||'';
  $('p-active').checked = p ? p.isActive : true;

  // #6 — Flash Sale fields
  const saleStatus = $('p-sale-status');
  const removeBtn  = $('btn-remove-sale');
  const now = new Date();
  const hasActiveSale = p?.salePrice && p?.saleEndsAt && new Date(p.saleEndsAt) > now;

  $('p-sale-price').value = p?.salePrice || '';
  if (p?.saleEndsAt) {
    // datetime-local cần format: YYYY-MM-DDTHH:MM
    const d = new Date(p.saleEndsAt);
    $('p-sale-ends').value = d.toISOString().slice(0, 16);
  } else {
    $('p-sale-ends').value = '';
  }

  if (hasActiveSale) {
    const remaining = new Date(p.saleEndsAt) - now;
    const h = Math.floor(remaining / 3600000);
    const m = Math.floor((remaining % 3600000) / 60000);
    saleStatus.innerHTML = `🔥 <b>Đang sale ${fmt(p.salePrice)}</b> — còn ${h > 0 ? h + 'h ' : ''}${m}p`;
    saleStatus.style.color = 'var(--orange)';
    removeBtn.style.display = '';
  } else {
    saleStatus.textContent = 'Không có flash sale';
    saleStatus.style.color = 'var(--text3)';
    removeBtn.style.display = 'none';
  }

  showModal('modal-product');
}

async function saveProduct() {
  const d = {
    name: $('p-name').value, slug: $('p-slug').value, thumbnailEmoji: $('p-emoji').value,
    basePrice: Number($('p-price').value), vipPrice: $('p-vip').value ? Number($('p-vip').value) : null,
    productType: $('p-type').value, deliveryType: $('p-deltype').value, stockMode: $('p-stockmode').value,
    categoryId: $('p-cat').value || null, shortDescription: $('p-desc').value,
    isActive: $('p-active').checked
  };
  try {
    if (editProdId) await api('PUT', `/products/${editProdId}`, d);
    else await api('POST', '/products', d);

    // #6 — Lưu Flash Sale nếu có nhập
    const salePrice = $('p-sale-price').value;
    const saleEnds  = $('p-sale-ends').value;
    if (editProdId && salePrice && saleEnds) {
      try {
        await api('PUT', `/products/${editProdId}/flash-sale`, {
          salePrice: Number(salePrice),
          saleEndsAt: new Date(saleEnds).toISOString(),
        });
        toast('Flash Sale đã được áp dụng 🔥');
      } catch(se) { toast('Lưu SP OK nhưng Flash Sale lỗi: ' + se.message, 'warn'); }
    }

    toast('Đã lưu sản phẩm ✅');
    closeModal('modal-product');
    loadProducts();
  } catch(e) { toast(e.message, 'err'); }
}

async function removeFlashSale() {
  if (!editProdId) return;
  try {
    await api('DELETE', `/products/${editProdId}/flash-sale`);
    toast('Đã xoá Flash Sale ✅');
    $('p-sale-price').value = '';
    $('p-sale-ends').value = '';
    $('p-sale-status').textContent = 'Không có flash sale';
    $('p-sale-status').style.color = 'var(--text3)';
    $('btn-remove-sale').style.display = 'none';
    loadProducts();
  } catch(e) { toast(e.message, 'err'); }
}

async function toggleProduct(id, currentActive) {
  try {
    await api('PUT', `/products/${id}`, { isActive: !currentActive });
    toast(currentActive ? 'Đã ẩn sản phẩm' : 'Đã hiện sản phẩm ✅');
    loadProducts();
  } catch(e) { toast(e.message, 'err'); }
}

// ─── CATEGORIES ───────────────────────────────────────────────────
async function loadCategories() {
  try {
    const cats = await api('GET', '/categories');
    $('cat-table').innerHTML = cats.length ? cats.map(c => `
      <tr>
        <td class="fw-medium">${c.emoji||''} ${c.name}</td>
        <td><code>${c.slug}</code></td>
        <td>${c.description||'—'}</td>
        <td>${c.isActive?'<span class="badge badge-green">Bật</span>':'<span class="badge badge-red">Tắt</span>'}</td>
        <td>
          <button class="btn btn-xs btn-blue" onclick='openCatModal(${JSON.stringify(c).replace(/'/g,"&#39;")})'>Sửa</button>
        </td>
      </tr>
    `).join('') : `<tr><td colspan="5" class="empty-state"><p>Chưa có danh mục</p></td></tr>`;
  } catch(e) { toast(e.message, 'err'); }
}

let editCatId = null;
function openCatModal(c) {
  editCatId = c ? c.id : null;
  $('modal-cat-title').textContent = c ? 'Sửa danh mục' : 'Thêm danh mục';
  $('c-name').value = c?.name||''; $('c-slug').value = c?.slug||'';
  $('c-emoji').value = c?.emoji||''; $('c-desc').value = c?.description||'';
  $('c-active').checked = c ? c.isActive : true;
  showModal('modal-cat');
}

async function saveCat() {
  const d = { name: $('c-name').value, slug: $('c-slug').value, emoji: $('c-emoji').value, description: $('c-desc').value, isActive: $('c-active').checked };
  try {
    if(editCatId) await api('PUT', `/categories/${editCatId}`, d);
    else await api('POST', '/categories', d);
    toast('Đã lưu');
    closeModal('modal-cat');
    loadCategories();
  } catch(e) { toast(e.message, 'err'); }
}

// ─── STOCK ────────────────────────────────────────────────────────
let stockPage = 0;
async function loadStockInit() {
  try {
    const res = await api('GET', '/products?limit=200');
    const p = res.products || [];
    $('stock-prod-sel').innerHTML = '<option value="">-- Chọn sản phẩm --</option>' + p.map(x => `<option value="${x.id}">${x.thumbnailEmoji||''} ${x.name}</option>`).join('');
  } catch(e){}
}

function onStockProdChange() { loadStock(0); }

async function loadStock(page = 0) {
  stockPage = page;
  const pid = $('stock-prod-sel').value;
  const stat = $('stock-filter').value;
  if(!pid) {
    $('stock-table').innerHTML = `<tr><td colspan="4" class="empty-state"><p>Vui lòng chọn sản phẩm</p></td></tr>`;
    $('stock-avail').textContent='0'; $('stock-del').textContent='0'; $('stock-total').textContent='0';
    return;
  }
  
  try {
    const d = await api('GET', `/products/${pid}/stock?page=${page}&limit=20&status=${stat}`);
    $('stock-table').innerHTML = d.items.length ? d.items.map(i => `
      <tr>
        <td class="mono">${i.content}</td>
        <td>${i.status==='AVAILABLE'?'<span class="badge badge-green">Có sẵn</span>':i.status==='DELIVERED'?'<span class="badge badge-blue">Đã giao</span>':'<span class="badge badge-yellow">Đang giữ</span>'}</td>
        <td>${fmtDate(i.createdAt)}</td>
        <td>${i.status==='AVAILABLE'?`<button class="btn btn-xs btn-red" onclick="delStock('${i.id}')">Xóa</button>`:'—'}</td>
      </tr>
    `).join('') : `<tr><td colspan="4" class="empty-state"><p>Không có kho nào</p></td></tr>`;
    
    $('stock-avail').textContent = d.available;
    $('stock-del').textContent = d.delivered;
    $('stock-total').textContent = d.total;
    $('stock-pager').innerHTML = buildPager(d.total, page, 20, 'loadStock');
  } catch(e) { toast(e.message, 'err'); }
}

async function addKeys() {
  const pid = $('stock-prod-sel').value;
  const text = $('keys-input').value.trim();
  if(!pid) return toast('Chưa chọn sản phẩm', 'err');
  if(!text) return toast('Chưa nhập key', 'err');
  
  const keysArr = text.split('\n').map(s=>s.trim()).filter(Boolean);
  try {
    await api('POST', `/products/${pid}/stock`, { keys: keysArr });
    toast(`Đã thêm ${keysArr.length} keys`);
    $('keys-input').value = '';
    loadStock(0);
  } catch(e) { toast(e.message, 'err'); }
}

async function delStock(id) {
  if(!confirm('Xóa key này?')) return;
  try { await api('DELETE', `/stock/${id}`); toast('Đã xóa'); loadStock(stockPage); }
  catch(e) { toast(e.message, 'err'); }
}

async function bulkDeleteKeys() {
  const pid = $('stock-prod-sel').value;
  if(!pid) return toast('Chọn sản phẩm trước', 'err');
  if(!confirm('Xóa toàn bộ keys đang CÓ SẴN của sản phẩm này?')) return;
  try {
    const res = await api('DELETE', `/products/${pid}/stock/bulk`);
    toast(`Đã xóa ${res.deleted} keys`);
    loadStock(0);
  } catch(e) { toast(e.message, 'err'); }
}

// ─── ORDERS ───────────────────────────────────────────────────────
let ordPage = 0;
async function searchOrders() {
  const q = $('ord-search').value;
  if(q.length < 3) return loadOrders(0);
  try {
    const orders = await api('GET', `/orders/search?q=${encodeURIComponent(q)}`);
    renderOrdTable(orders);
    $('ord-pager').innerHTML = '';
  } catch(e){}
}

async function loadOrders(page = 0) {
  ordPage = page;
  const stat = $('ord-filter').value;
  try {
    const d = await api('GET', `/orders?page=${page}&limit=20&status=${stat}`);
    renderOrdTable(d.orders);
    $('ord-pager').innerHTML = buildPager(d.total, page, 20, 'loadOrders');
  } catch(e) { toast(e.message, 'err'); }
}

function renderOrdTable(list) {
  $('ord-table').innerHTML = list.length ? list.map(o => `
    <tr>
      <td><a href="#" style="color:var(--accent2);text-decoration:none" onclick="openOrdModal('${o.id}');return false"><code>${o.orderCode}</code></a></td>
      <td>${o.user?.firstName||''}</td>
      <td><span class="truncate" style="display:block">${o.items?.[0]?.productNameSnapshot||'—'}</span></td>
      <td>${o.items?.[0]?.quantity||0}</td>
      <td class="fw-bold text-green">${fmt(o.finalAmount)}</td>
      <td>${getOrdBadge(o.status)}</td>
      <td class="text-sm">${fmtDate(o.createdAt)}</td>
    </tr>
  `).join('') : `<tr><td colspan="7" class="empty-state"><p>Không tìm thấy đơn hàng</p></td></tr>`;
}

async function openOrdModal(id) {
  showModal('modal-order');
  $('order-detail-body').innerHTML = '<div class="empty-state"><p>Đang tải...</p></div>';
  try {
    const o = await api('GET', `/orders/${id}`);
    $('order-detail-body').innerHTML = `
      <div class="form-row cols-2">
        <div class="card" style="padding:16px;margin:0"><div class="text-sm text-muted">Mã đơn</div><div class="fw-bold mt-8" style="font-size:16px">${o.orderCode}</div></div>
        <div class="card" style="padding:16px;margin:0"><div class="text-sm text-muted">Trạng thái</div><div class="mt-8">${getOrdBadge(o.status)}</div></div>
      </div>
      <div class="card mt-16" style="padding:16px">
        <div class="fw-bold mb-12">👤 Khách hàng</div>
        <div>${o.user?.firstName||''} ${o.user?.lastName||''} ${o.user?.username ? '(@'+o.user.username+')' : ''}</div>
        <div class="mt-8 text-sm">ID: <code>${o.user?.telegramId}</code></div>
      </div>
      <div class="card mt-16" style="padding:16px;margin-bottom:0">
        <div class="fw-bold mb-12">📦 Chi tiết sản phẩm</div>
        ${o.items.map(i => `
          <div style="padding:12px;background:var(--surface2);border-radius:8px;margin-bottom:8px">
            <div class="fw-bold">${i.productNameSnapshot}</div>
            <div class="text-sm mt-8 flex-center" style="justify-content:space-between">
              <span>Đơn giá: ${fmt(i.unitPriceSnapshot)} x ${i.quantity}</span>
              <span class="fw-bold text-green">${fmt(i.subtotalAmount)}</span>
            </div>
            ${i.deliveredItems?.length ? `<div class="mt-8 pt-8" style="border-top:1px solid var(--border)"><div class="text-xs text-muted mb-4">Keys đã giao:</div>${i.deliveredItems.map(k=>`<div class="mono" style="padding:4px 8px;background:var(--bg);border-radius:4px;margin-bottom:4px">${k.content}</div>`).join('')}</div>` : ''}
          </div>
        `).join('')}
        <div class="flex-center mt-16" style="justify-content:space-between;border-top:1px solid var(--border);padding-top:16px">
          <span class="fw-medium">Tổng thanh toán</span>
          <span class="fw-bold text-green" style="font-size:20px">${fmt(o.finalAmount)}</span>
        </div>
      </div>
    `;
  } catch(e) { $('order-detail-body').innerHTML = `<p class="text-red">${e.message}</p>`; }
}

// ─── USERS ────────────────────────────────────────────────────────
let usrPage = 0;
async function loadUsers(page = 0) {
  usrPage = page;
  const q = $('usr-search').value;
  try {
    const d = await api('GET', `/users?page=${page}&limit=20&q=${encodeURIComponent(q)}`);
    $('usr-table').innerHTML = d.users.length ? d.users.map(u => `
      <tr>
        <td class="fw-medium"><a href="#" style="color:var(--text);text-decoration:none" onclick="openUserModal('${u.id}');return false">${u.firstName||''} ${u.lastName||''}</a></td>
        <td>${u.username?'@'+u.username:'—'}</td>
        <td class="fw-bold text-green">${fmt(u.wallet?.balance)}</td>
        <td>${u._count?.orders || 0}</td>
        <td>${u.vipLevelId?'<span class="badge badge-yellow">VIP</span>':'—'}</td>
        <td>${u.status==='ACTIVE'?'<span class="badge badge-green">Hoạt động</span>':'<span class="badge badge-red">Bị khoá</span>'}</td>
        <td>
          <button class="btn btn-xs btn-blue" onclick="openWalletModal('${u.id}','${(u.firstName||'User').replace(/'/g,"")}')">Ví</button>
          <button class="btn btn-xs ${u.status==='ACTIVE'?'btn-red':'btn-green'}" onclick="banUser('${u.id}')">${u.status==='ACTIVE'?'Ban':'Mở'}</button>
        </td>
      </tr>
    `).join('') : `<tr><td colspan="7" class="empty-state"><p>Không tìm thấy người dùng</p></td></tr>`;
    $('usr-pager').innerHTML = buildPager(d.total, page, 20, 'loadUsers');
  } catch(e) { toast(e.message, 'err'); }
}

async function banUser(id) {
  if(!confirm('Thay đổi trạng thái tài khoản này?')) return;
  try { await api('PUT', `/users/${id}/ban`); toast('Đã cập nhật'); loadUsers(usrPage); }
  catch(e) { toast(e.message, 'err'); }
}

// ─── WALLET & TRANSACTIONS ────────────────────────────────────────
let walletUserId = null;
function openWalletModal(id, name) {
  walletUserId = id;
  $('w-user').value = name;
  $('w-amount').value = ''; $('w-note').value = '';
  showModal('modal-wallet');
}

async function saveWallet() {
  try {
    await api('POST', `/users/${walletUserId}/wallet`, {
      amount: Number($('w-amount').value),
      note: $('w-note').value
    });
    toast('Đã điều chỉnh số dư');
    closeModal('modal-wallet');
    loadUsers(usrPage);
  } catch(e) { toast(e.message, 'err'); }
}

async function loadTransactions(page = 0) {
  const t = $('tx-filter').value;
  try {
    const d = await api('GET', `/transactions?page=${page}&limit=20&type=${t}`);
    $('tx-table').innerHTML = d.transactions.length ? d.transactions.map(x => `
      <tr>
        <td><code>${x.id.slice(-6)}</code></td>
        <td><a href="#" style="color:var(--accent2);text-decoration:none" onclick="openUserModal('${x.userId}');return false">Xem user</a></td>
        <td><span class="tag">${x.type}</span></td>
        <td>${x.direction==='IN'?'<span class="text-green fw-bold">+ IN</span>':'<span class="text-red fw-bold">- OUT</span>'}</td>
        <td class="fw-bold">${fmt(x.amount)}</td>
        <td>${fmt(x.balanceAfter)}</td>
        <td><span class="truncate" style="display:block" title="${x.description||''}">${x.description||'—'}</span></td>
        <td class="text-sm">${fmtDate(x.createdAt)}</td>
      </tr>
    `).join('') : `<tr><td colspan="8" class="empty-state"><p>Không có giao dịch</p></td></tr>`;
    $('tx-pager').innerHTML = buildPager(d.total, page, 20, 'loadTransactions');
  } catch(e) { toast(e.message, 'err'); }
}

async function openUserModal(id) {
  showModal('modal-user');
  $('user-detail-body').innerHTML = '<div class="empty-state"><p>Đang tải...</p></div>';
  try {
    const u = await api('GET', `/users/${id}`);
    $('user-detail-body').innerHTML = `
      <div class="user-profile">
        <div class="user-avatar">${(u.firstName?u.firstName[0]:'U').toUpperCase()}</div>
        <div class="user-info">
          <h4>${u.firstName||''} ${u.lastName||''}</h4>
          <p>${u.username?'@'+u.username:''} | ID: <code>${u.telegramId}</code></p>
        </div>
      </div>
      <div class="grid-2">
        <div class="card" style="margin:0;padding:16px"><div class="fw-bold mb-12">Tổng quan</div>
          <div class="flex-center mb-8" style="justify-content:space-between"><span>Số dư ví:</span><span class="fw-bold text-green">${fmt(u.wallet?.balance)}</span></div>
          <div class="flex-center mb-8" style="justify-content:space-between"><span>Tổng nạp:</span><span class="fw-bold">${fmt(u.wallet?.totalDeposited)}</span></div>
          <div class="flex-center mb-8" style="justify-content:space-between"><span>Đơn hàng:</span><span class="fw-bold">${u.totalOrders}</span></div>
          <div class="flex-center" style="justify-content:space-between"><span>Tham gia:</span><span>${fmtDate(u.createdAt).slice(0,10)}</span></div>
        </div>
        <div class="card" style="margin:0;padding:16px"><div class="fw-bold mb-12">10 Giao dịch gần nhất</div>
          <div style="max-height:150px;overflow-y:auto;font-size:12px;padding-right:8px">
            ${(u.wallet?.transactions||[]).length===0 ? '<p class="text-muted">Chưa có giao dịch</p>' : ''}
            ${(u.wallet?.transactions||[]).map(t => `
              <div class="flex-center mb-8" style="justify-content:space-between;border-bottom:1px solid var(--border);padding-bottom:6px">
                <span class="${t.direction==='IN'?'text-green':'text-red'} fw-bold" style="width:70px">${t.direction==='IN'?'+':'-'}${fmt(t.amount)}</span>
                <span class="text-muted text-sm truncate" style="flex:1;text-align:right" title="${t.description}">${t.type}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  } catch(e) { $('user-detail-body').innerHTML = `<p class="text-red">${e.message}</p>`; }
}

// ─── COUPONS ──────────────────────────────────────────────────────
let editCouponId = null;
async function loadCoupons() {
  try {
    const list = await api('GET', '/coupons');
    $('coupon-table').innerHTML = list.length ? list.map(c => `
      <tr>
        <td><code>${c.code}</code></td>
        <td>${c.discountType==='PERCENT'?`${c.discountValue}%`:`${fmt(c.discountValue)}`}</td>
        <td>${c.minOrderAmount?fmt(c.minOrderAmount):'—'}</td>
        <td>${c.totalUsageLimit?`${c._count?.usages||0}/${c.totalUsageLimit}`:(c._count?.usages||0)+'/∞'}</td>
        <td>${c.expiresAt?fmtDate(c.expiresAt).slice(0,10):'Không hạn'}</td>
        <td>${c.isActive?'<span class="badge badge-green">Bật</span>':'<span class="badge badge-red">Tắt</span>'}</td>
        <td>
          <button class="btn btn-xs btn-blue" onclick='openCouponModal(${JSON.stringify(c).replace(/'/g,"&#39;")})'>Sửa</button>
          <button class="btn btn-xs btn-red" onclick="delCoupon('${c.id}')">Xóa</button>
        </td>
      </tr>`).join('') : '<tr><td colspan="7" class="empty-state"><p>Chưa có coupon</p></td></tr>';
  } catch(e) { toast(e.message, 'err'); }
}
function openCouponModal(c) {
  editCouponId = c ? c.id : null;
  $('modal-coupon-title').textContent = c ? 'Sửa coupon' : 'Tạo coupon';
  $('cp-code').value = c?.code||''; $('cp-type').value = c?.discountType||'PERCENT';
  $('cp-value').value = c?.discountValue||''; $('cp-maxdisc').value = c?.maxDiscountAmount||'';
  $('cp-minorder').value = c?.minOrderAmount||''; $('cp-maxuse').value = c?.totalUsageLimit||'';
  $('cp-expires').value = c?.expiresAt ? c.expiresAt.slice(0,16) : '';
  $('cp-active').checked = c ? c.isActive : true;
  showModal('modal-coupon');
}
async function saveCoupon() {
  const d = { code: $('cp-code').value, discountType: $('cp-type').value, discountValue: Number($('cp-value').value),
    maxDiscountAmount: $('cp-maxdisc').value||null, minOrderAmount: $('cp-minorder').value||null,
    totalUsageLimit: $('cp-maxuse').value||null, expiresAt: $('cp-expires').value||null, isActive: $('cp-active').checked };
  try {
    if(editCouponId) await api('PUT', `/coupons/${editCouponId}`, d);
    else await api('POST', '/coupons', d);
    toast('Đã lưu coupon ✅'); closeModal('modal-coupon'); loadCoupons();
  } catch(e) { toast(e.message, 'err'); }
}
async function delCoupon(id) {
  if(!confirm('Xóa coupon này?')) return;
  try { await api('DELETE', `/coupons/${id}`); toast('Đã xóa'); loadCoupons(); }
  catch(e) { toast(e.message, 'err'); }
}

// ─── VIP LEVELS ───────────────────────────────────────────────────
let editVipId = null;
async function loadVipLevels() {
  try {
    const list = await api('GET', '/vip-levels');
    $('vip-table').innerHTML = list.length ? list.map(v => `
      <tr>
        <td class="fw-bold">${v.name}</td>
        <td><code>${v.code}</code></td>
        <td class="fw-bold text-green">${fmt(v.spendingThreshold)}</td>
        <td class="fw-bold text-accent2">${v.percentDiscount}%</td>
        <td>${v._count?.users||0} người</td>
        <td>${v.isActive?'<span class="badge badge-green">Bật</span>':'<span class="badge badge-red">Tắt</span>'}</td>
        <td><button class="btn btn-xs btn-blue" onclick='openVipModal(${JSON.stringify(v).replace(/'/g,"&#39;")})'>Sửa</button></td>
      </tr>`).join('') : '<tr><td colspan="7" class="empty-state"><p>Chưa có VIP level</p></td></tr>';
  } catch(e) { toast(e.message, 'err'); }
}
function openVipModal(v) {
  editVipId = v ? v.id : null;
  $('modal-vip-title').textContent = v ? 'Sửa VIP Level' : 'Tạo VIP Level';
  $('vip-name').value = v?.name||''; $('vip-code').value = v?.code||'';
  $('vip-threshold').value = v?.spendingThreshold||0; $('vip-discount').value = v?.percentDiscount||0;
  $('vip-desc').value = v?.description||''; $('vip-active').checked = v ? v.isActive : true;
  showModal('modal-vip');
}
async function saveVipLevel() {
  const d = { name: $('vip-name').value, code: $('vip-code').value, spendingThreshold: Number($('vip-threshold').value),
    percentDiscount: Number($('vip-discount').value), description: $('vip-desc').value, isActive: $('vip-active').checked };
  try {
    if(editVipId) await api('PUT', `/vip-levels/${editVipId}`, d);
    else await api('POST', '/vip-levels', d);
    toast('Đã lưu ✅'); closeModal('modal-vip'); loadVipLevels();
  } catch(e) { toast(e.message, 'err'); }
}

// ─── BROADCAST ────────────────────────────────────────────────────
async function loadBroadcasts() {
  try {
    const list = await api('GET', '/broadcasts');
    $('bc-history').innerHTML = list.length ? list.map(b => `
      <div style="padding:12px;background:var(--surface2);border-radius:8px;margin-bottom:8px">
        <div class="flex-center" style="justify-content:space-between">
          <span class="fw-bold">${b.title}</span>
          <span class="text-sm text-muted">${fmtDate(b.createdAt).slice(0,16)}</span>
        </div>
        <div class="text-sm text-muted mt-8" style="white-space:pre-wrap;max-height:60px;overflow:hidden">${b.content.slice(0,100)}${b.content.length>100?'...':''}</div>
        <div class="flex-center mt-8" style="gap:12px;font-size:12px">
          <span class="text-green">✅ ${b.totalSent} thành công</span>
          ${b.totalFailed?`<span class="text-red">❌ ${b.totalFailed} thất bại</span>`:''}
          <span class="text-muted">📊 ${b.totalTarget} mục tiêu</span>
        </div>
      </div>`).join('') : '<p class="text-muted text-sm">Chưa có broadcast nào</p>';
  } catch(e){}
}
async function sendBroadcast() {
  const content = $('bc-content').value.trim();
  const title = $('bc-title').value.trim() || 'Thông báo';
  const targetGroup = $('bc-target').value;
  if(!content) return toast('Nhập nội dung tin nhắn', 'err');
  if(!confirm(`Gửi tới nhóm "${targetGroup}"?\n\nNội dung: ${content.slice(0,100)}...`)) return;
  try {
    const r = await api('POST', '/broadcast', { title, content, targetGroup });
    toast(`✅ ${r.message}`, 'ok');
    $('bc-content').value = ''; loadBroadcasts();
  } catch(e) { toast(e.message, 'err'); }
}

// ─── DONUT CHART (#8) ─────────────────────────────────────────────
window.drawDonutChart = function(data) {
  const canvas = $('donut-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const colors = { COMPLETED:'#22c55e', PENDING_PAYMENT:'#f59e0b', CANCELLED:'#6b7280', FAILED:'#ef4444', PROCESSING:'#3b82f6' };
  const labels = { COMPLETED:'Hoàn thành', PENDING_PAYMENT:'Chờ TT', CANCELLED:'Đã huỷ', FAILED:'Thất bại', PROCESSING:'Đang xử lý' };
  const filtered = data.filter(d => d.count > 0);
  const total = filtered.reduce((s, d) => s + d.count, 0);
  if (!total) { ctx.fillStyle = '#4a5568'; ctx.font = '12px Inter'; ctx.fillText('Chưa có đơn', 10, 60); return; }

  const cx = 60, cy = 60, r = 50, gap = 0.04;
  let angle = -Math.PI / 2;
  ctx.clearRect(0, 0, 120, 120);

  filtered.forEach(d => {
    const slice = (d.count / total) * (Math.PI * 2 - gap * filtered.length);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = colors[d.status] || '#7c6ff7';
    ctx.fill();
    angle += slice + gap;
  });
  // Hole
  ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#0e111a';
  ctx.fill();
  // Total text
  ctx.fillStyle = '#f1f5f9'; ctx.font = 'bold 14px Inter'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(total, cx, cy);

  // Legend
  const legend = $('donut-legend');
  if (legend) {
    legend.innerHTML = filtered.map(d => `
      <div class="donut-legend-item">
        <span class="donut-legend-dot" style="background:${colors[d.status]||'#7c6ff7'}"></span>
        <span class="donut-legend-label">${labels[d.status]||d.status}</span>
        <span class="donut-legend-val">${d.count}</span>
      </div>`).join('');
  }
};

// ─── EXPORT CSV (#11) ─────────────────────────────────────────────
async function exportCSV(type) {
  try {
    toast(`⏳ Đang xuất ${type}...`);
    const url = `/api/admin/export/${type}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${type}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    toast(`✅ Đã xuất ${type}.csv`);
  } catch(e) { toast(e.message, 'err'); }
}

// ─── DARK / LIGHT MODE (#12) ──────────────────────────────────────
function toggleTheme() {
  const isLight = document.documentElement.classList.toggle('light');
  localStorage.setItem('admin_theme', isLight ? 'light' : 'dark');
  $('theme-toggle').textContent = isLight ? '☀️' : '🌙';
}

// ─── INIT ─────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // Khôi phục theme đã lưu
  if (localStorage.getItem('admin_theme') === 'light') {
    document.documentElement.classList.add('light');
    const btn = $('theme-toggle');
    if (btn) btn.textContent = '☀️';
  }

  if (token) {
    $('login-view').style.display = 'none';
    $('app').style.display = 'flex';
    nav('dashboard');
  }
  $('login-pw').addEventListener('keypress', e => e.key === 'Enter' && doLogin());
  setInterval(() => { $('topbar-time').textContent = new Date().toLocaleString('vi-VN'); }, 1000);
  // Auto-refresh dashboard mỗi 60s
  setInterval(() => { if(currentPage === 'dashboard') loadDashboard(); }, 60000);
});
