const API = '/api/admin';
let token = localStorage.getItem('admin_token') || '';
let currentPage = 'dashboard';

// ─── UTILS ────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmt = n => new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND'}).format(n||0);
const fmtDate = d => new Date(d).toLocaleString('vi-VN');
const debounce = (f, t) => { let id; return (...a) => { clearTimeout(id); id=setTimeout(()=>f(...a), t); }; };

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
        <td>${p.isActive?'<span class="badge badge-green">Đang bán</span>':'<span class="badge badge-red">Đã ẩn</span>'}</td>
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
  $('p-cat').value = p?.categoryId||''; $('p-desc').value = p?.shortDesc||'';
  showModal('modal-product');
}

async function saveProduct() {
  const d = {
    name: $('p-name').value, slug: $('p-slug').value, thumbnailEmoji: $('p-emoji').value,
    basePrice: Number($('p-price').value), vipPrice: $('p-vip').value ? Number($('p-vip').value) : null,
    productType: $('p-type').value, deliveryType: $('p-deltype').value, stockMode: $('p-stockmode').value,
    categoryId: $('p-cat').value || null, shortDescription: $('p-desc').value
  };
  try {
    if(editProdId) await api('PUT', `/products/${editProdId}`, d);
    else await api('POST', '/products', d);
    toast('Đã lưu sản phẩm');
    closeModal('modal-product');
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
        <td>${u.totalOrders}</td>
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

// ─── INIT ─────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (token) {
    $('login-view').style.display = 'none';
    $('app').style.display = 'flex';
    nav('dashboard');
  }
  
  $('login-pw').addEventListener('keypress', e => e.key === 'Enter' && doLogin());
  
  setInterval(() => {
    const d = new Date();
    $('topbar-time').textContent = d.toLocaleString('vi-VN');
  }, 1000);
});
