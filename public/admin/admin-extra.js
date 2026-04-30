// Extension: load stock selector + dashboard recent orders
// Loaded AFTER app.js so showPage/loadDashboard/api/fmt/statusBadge/fmtDate are available

(function() {
  const _origShowPage = window.showPage;
  window.showPage = function(name) {
    _origShowPage(name);
    if (name === 'stock') {
      api('GET', '/products?page=0&limit=200').then(d => {
        const sel = document.getElementById('stock-select-prod');
        const cur = window.stockProdId;
        sel.innerHTML = '<option value="">-- Chọn sản phẩm --</option>' +
          d.products.map(p => `<option value="${p.id}" ${p.id===cur?'selected':''}>${p.thumbnailEmoji||'📦'} ${p.name}</option>`).join('');
        if (cur) loadStock(0);
      }).catch(() => {});
    }
  };

  const _origDash = window.loadDashboard;
  window.loadDashboard = async function() {
    await _origDash();
    try {
      const d = await api('GET', '/orders?page=0&limit=8');
      document.getElementById('dash-orders').innerHTML = d.orders.length ?
        d.orders.map(o => `<tr>
          <td><code>${o.orderCode}</code></td>
          <td>${o.user?.firstName||''} ${o.user?.username?'@'+o.user.username:''}</td>
          <td>${o.items?.[0]?.productNameSnapshot||'—'}</td>
          <td>${fmt(o.finalAmount)}</td>
          <td>${statusBadge(o.status)}</td>
          <td>${fmtDate(o.createdAt)}</td>
        </tr>`).join('') : '<tr><td colspan="6" class="empty">Chưa có đơn hàng</td></tr>';
    } catch(e) {}
  };
})();
