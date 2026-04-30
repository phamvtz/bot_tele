const API = '/api/admin';
let token = localStorage.getItem('admin_token') || '';
let currentPage = 'dashboard';
let pages = {};

const $ = id => document.getElementById(id);
const fmt = n => new Intl.NumberFormat('vi-VN').format(n) + 'đ';
const fmtDate = d => d ? new Date(d).toLocaleDateString('vi-VN', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '-';

function toast(msg, ok=true) {
  const el = document.createElement('div');
  el.className = `toast ${ok?'toast-ok':'toast-err'}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

async function api(method, path, body) {
  const r = await fetch(API + path, {
    method, headers: {'Content-Type':'application/json','Authorization':'Bearer '+token},
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Lỗi API');
  return data;
}

function statusBadge(s) {
  const map = {COMPLETED:'green',PAID:'green',PENDING_PAYMENT:'yellow',CANCELLED:'red',FAILED:'red',ACTIVE:'green',BANNED:'red',AVAILABLE:'green',DELIVERED:'blue',RESERVED:'yellow'};
  const c = map[s] || 'gray';
  const label = {COMPLETED:'Hoàn thành',PAID:'Đã thanh toán',PENDING_PAYMENT:'Chờ TT',CANCELLED:'Đã huỷ',FAILED:'Thất bại',AVAILABLE:'Có sẵn',DELIVERED:'Đã giao',RESERVED:'Đang giữ'}[s] || s;
  return `<span class="badge badge-${c}">${label}</span>`;
}

function paginator(total, page, limit, cb) {
  const tp = Math.ceil(total/limit);
  return `<div class="pagination"><span>${page*limit+1}-${Math.min((page+1)*limit,total)} / ${total}</span>
    <button onclick="(${cb})(${page-1})" ${page<=0?'disabled':''}>◀</button>
    <button onclick="(${cb})(${page+1})" ${page>=tp-1?'disabled':''}>▶</button></div>`;
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
async function loadDashboard() {
  const s = await api('GET','/stats');
  $('stat-rev-today').textContent = fmt(s.todayRevenue);
  $('stat-orders-today').textContent = s.todayOrders;
  $('stat-users').textContent = s.totalUsers;
  $('stat-low').textContent = s.lowStockCount;
  $('stat-rev-month').textContent = 'Tháng: ' + fmt(s.monthRevenue);
  $('stat-orders-month').textContent = 'Tháng: ' + s.monthOrders;
  $('stat-users-new').textContent = 'Hôm nay: +' + s.newUsers;
  $('stat-total-prod').textContent = s.totalProducts + ' sản phẩm';
}

// ─── PRODUCTS ────────────────────────────────────────────────────────────────
let prodPage = 0;
async function loadProducts(page=0) {
  prodPage = page;
  const d = await api('GET', `/products?page=${page}&limit=15`);
  const cats = await api('GET', '/categories');
  const catMap = {};
  cats.forEach(c => catMap[c.id] = c.name);
  $('products-table').innerHTML = d.products.length ? d.products.map(p => `
    <tr>
      <td>${p.thumbnailEmoji||'📦'} ${p.name}</td>
      <td>${catMap[p.categoryId]||'—'}</td>
      <td>${fmt(p.basePrice)}</td>
      <td>${p.stockMode==='UNLIMITED'?'∞':p.stockCount}</td>
      <td>${p.isActive ? '<span class="badge badge-green">Bán</span>' : '<span class="badge badge-red">Ẩn</span>'}</td>
      <td><div class="actions">
        <button class="btn btn-sm btn-blue" onclick="openEditProduct('${p.id}')">Sửa</button>
        <button class="btn btn-sm btn-gray" onclick="openStock('${p.id}','${p.name}')">Kho</button>
        <button class="btn btn-sm ${p.isActive?'btn-red':'btn-green'}" onclick="toggleProduct('${p.id}')">${p.isActive?'Ẩn':'Hiện'}</button>
      </div></td>
    </tr>`).join('') : '<tr><td colspan="6" class="empty">Chưa có sản phẩm</td></tr>';
  $('products-pager').innerHTML = paginator(d.total, page, 15, 'loadProducts');
}

async function toggleProduct(id) {
  try { await api('PUT', `/products/${id}/toggle`); toast('Đã cập nhật'); loadProducts(prodPage); }
  catch(e) { toast(e.message, false); }
}

let editProdId = null;
async function openEditProduct(id) {
  editProdId = id;
  const cats = await api('GET', '/categories');
  let p = {};
  if (id) { const d = await api('GET', `/products?page=0&limit=200`); p = d.products.find(x=>x.id===id)||{}; }
  $('prod-modal-title').textContent = id ? 'Sửa sản phẩm' : 'Thêm sản phẩm';
  $('prod-name').value = p.name||'';
  $('prod-slug').value = p.slug||'';
  $('prod-emoji').value = p.thumbnailEmoji||'';
  $('prod-price').value = p.basePrice||'';
  $('prod-vip').value = p.vipPrice||'';
  $('prod-desc').value = p.shortDescription||'';
  $('prod-stock-mode').value = p.stockMode||'TRACKED';
  $('prod-type').value = p.productType||'AUTO_DELIVERY';
  $('prod-del-type').value = p.deliveryType||'DIGITAL_CODE';
  $('prod-cat').innerHTML = '<option value="">-- Không có --</option>' + cats.map(c=>`<option value="${c.id}" ${c.id===p.categoryId?'selected':''}>${c.emoji||''} ${c.name}</option>`).join('');
  showModal('product-modal');
}

async function saveProduct() {
  const body = {
    name: $('prod-name').value, slug: $('prod-slug').value,
    thumbnailEmoji: $('prod-emoji').value, basePrice: $('prod-price').value,
    vipPrice: $('prod-vip').value||undefined, shortDescription: $('prod-desc').value,
    stockMode: $('prod-stock-mode').value, productType: $('prod-type').value,
    deliveryType: $('prod-del-type').value, categoryId: $('prod-cat').value||undefined,
  };
  try {
    if (editProdId) await api('PUT', `/products/${editProdId}`, body);
    else await api('POST', '/products', body);
    toast('Đã lưu!'); closeModal('product-modal'); loadProducts(prodPage);
  } catch(e) { toast(e.message, false); }
}

// ─── STOCK ───────────────────────────────────────────────────────────────────
let stockProdId='', stockProdName='', stockPage=0;
async function openStock(id, name) {
  stockProdId = id; stockProdName = name;
  $('stock-prod-name').textContent = '🗝️ Kho: ' + name;
  loadStock();
  showPage('stock');
}

async function loadStock(page=0) {
  stockPage = page;
  if (!stockProdId) return;
  const d = await api('GET', `/products/${stockProdId}/stock?page=${page}&limit=30`);
  $('stock-available').textContent = d.available;
  $('stock-delivered').textContent = d.delivered;
  $('stock-total').textContent = d.total;
  $('stock-table').innerHTML = d.items.length ? d.items.map(i=>`
    <tr>
      <td style="font-family:monospace;font-size:12px;word-break:break-all">${i.content}</td>
      <td>${statusBadge(i.status)}</td>
      <td>${fmtDate(i.createdAt)}</td>
      <td>${i.status==='AVAILABLE'?`<button class="btn btn-sm btn-red" onclick="delStock('${i.id}')">Xóa</button>`:'—'}</td>
    </tr>`).join('') : '<tr><td colspan="4" class="empty">Kho trống</td></tr>';
  $('stock-pager').innerHTML = paginator(d.total, page, 30, 'loadStock');
}

async function addKeys() {
  const raw = $('keys-input').value.trim();
  if (!raw) return toast('Nhập keys vào!', false);
  const keys = raw.split('\n').map(s=>s.trim()).filter(Boolean);
  try {
    const r = await api('POST', `/products/${stockProdId}/stock`, {keys});
    toast(`Đã thêm ${r.added} keys`); $('keys-input').value=''; loadStock(0);
  } catch(e) { toast(e.message, false); }
}

async function delStock(id) {
  if (!confirm('Xóa key này?')) return;
  try { await api('DELETE', `/stock/${id}`); toast('Đã xóa'); loadStock(stockPage); }
  catch(e) { toast(e.message, false); }
}

// ─── CATEGORIES ──────────────────────────────────────────────────────────────
async function loadCategories() {
  const cats = await api('GET', '/categories');
  $('cats-table').innerHTML = cats.length ? cats.map(c=>`
    <tr>
      <td>${c.emoji||''} ${c.name}</td>
      <td><code>${c.slug}</code></td>
      <td>${c.description||'—'}</td>
      <td>${c.isActive ? '<span class="badge badge-green">Bật</span>' : '<span class="badge badge-red">Tắt</span>'}</td>
      <td><div class="actions">
        <button class="btn btn-sm btn-blue" onclick="openEditCat('${c.id}','${c.name.replace(/'/g,'\\'')}','${c.slug}','${c.emoji||''}','${(c.description||'').replace(/'/g,'\\'')}',${c.isActive})">Sửa</button>
        <button class="btn btn-sm btn-red" onclick="deleteCat('${c.id}')">Xóa</button>
      </div></td>
    </tr>`).join('') : '<tr><td colspan="5" class="empty">Chưa có danh mục</td></tr>';
}

let editCatId = null;
function openEditCat(id,name,slug,emoji,desc,active) {
  editCatId = id||null;
  $('cat-modal-title').textContent = id ? 'Sửa danh mục' : 'Thêm danh mục';
  $('cat-name').value = name||''; $('cat-slug').value = slug||'';
  $('cat-emoji').value = emoji||''; $('cat-desc').value = desc||'';
  $('cat-active').checked = active !== false;
  showModal('cat-modal');
}

async function saveCat() {
  const body = {name:$('cat-name').value, slug:$('cat-slug').value, emoji:$('cat-emoji').value, description:$('cat-desc').value, isActive:$('cat-active').checked};
  try {
    if (editCatId) await api('PUT', `/categories/${editCatId}`, body);
    else await api('POST', '/categories', body);
    toast('Đã lưu!'); closeModal('cat-modal'); loadCategories();
  } catch(e) { toast(e.message, false); }
}

async function deleteCat(id) {
  if (!confirm('Xóa danh mục này?')) return;
  try { await api('DELETE', `/categories/${id}`); toast('Đã xóa'); loadCategories(); }
  catch(e) { toast(e.message, false); }
}

// ─── ORDERS ──────────────────────────────────────────────────────────────────
let ordPage = 0, ordStatus = '';
async function loadOrders(page=0) {
  ordPage = page;
  const qs = ordStatus ? `&status=${ordStatus}` : '';
  const d = await api('GET', `/orders?page=${page}&limit=20${qs}`);
  $('orders-table').innerHTML = d.orders.length ? d.orders.map(o=>`
    <tr>
      <td><code>${o.orderCode}</code></td>
      <td>${o.user?.firstName||''} ${o.user?.username?'@'+o.user.username:''}</td>
      <td>${o.items?.[0]?.productNameSnapshot||'—'}</td>
      <td>${fmt(o.finalAmount)}</td>
      <td>${statusBadge(o.status)}</td>
      <td>${fmtDate(o.createdAt)}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="empty">Không có đơn hàng</td></tr>';
  $('orders-pager').innerHTML = paginator(d.total, page, 20, 'loadOrders');
}

// ─── USERS ───────────────────────────────────────────────────────────────────
let usrPage = 0;
async function loadUsers(page=0) {
  usrPage = page;
  const d = await api('GET', `/users?page=${page}&limit=20`);
  $('users-table').innerHTML = d.users.length ? d.users.map(u=>`
    <tr>
      <td>${u.firstName||''} ${u.lastName||''}</td>
      <td>${u.username?'@'+u.username:'—'}</td>
      <td>${fmt(u.wallet?.balance||0)}</td>
      <td>${u.totalOrders||0}</td>
      <td>${u.status==='BANNED' ? '<span class="badge badge-red">Banned</span>' : '<span class="badge badge-green">OK</span>'}</td>
      <td><button class="btn btn-sm ${u.status==='BANNED'?'btn-green':'btn-red'}" onclick="banUser('${u.id}','${u.status}')">${u.status==='BANNED'?'Bỏ ban':'Ban'}</button></td>
    </tr>`).join('') : '<tr><td colspan="6" class="empty">Không có người dùng</td></tr>';
  $('users-pager').innerHTML = paginator(d.total, page, 20, 'loadUsers');
}

async function banUser(id, status) {
  const isBanned = status === 'BANNED';
  if (!confirm(`${isBanned?'Bỏ ban':'Ban'} user này?`)) return;
  try { await api('PUT', `/users/${id}/ban`); toast('Đã cập nhật'); loadUsers(usrPage); }
  catch(e) { toast(e.message, false); }
}

// ─── ROUTING ─────────────────────────────────────────────────────────────────
function showPage(name) {
  currentPage = name;
  document.querySelectorAll('.page').forEach(p => p.style.display='none');
  const el = $('page-'+name);
  if (el) el.style.display='block';
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page===name));
  $('page-title').textContent = {dashboard:'📊 Dashboard',products:'📦 Sản phẩm',categories:'📂 Danh mục',stock:'🗝️ Quản lý kho',orders:'🧾 Đơn hàng',users:'👥 Người dùng'}[name]||'Admin';
  if (name==='dashboard') loadDashboard();
  if (name==='products') loadProducts(0);
  if (name==='categories') loadCategories();
  if (name==='orders') loadOrders(0);
  if (name==='users') loadUsers(0);
}

function showModal(id) { $(id).classList.add('show'); }
function closeModal(id) { $(id).classList.remove('show'); }

// ─── LOGIN ───────────────────────────────────────────────────────────────────
async function login() {
  const pw = $('login-pw').value;
  try {
    const r = await fetch(API+'/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})});
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    token = d.token; localStorage.setItem('admin_token', token);
    $('login').style.display='none'; $('app').style.display='flex';
    showPage('dashboard');
  } catch(e) { $('login-err').textContent = e.message; }
}

function logout() { token=''; localStorage.removeItem('admin_token'); location.reload(); }

// ─── INIT ────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (token) { $('login').style.display='none'; $('app').style.display='flex'; showPage('dashboard'); }
  $('login-pw').addEventListener('keypress', e => e.key==='Enter' && login());
});
