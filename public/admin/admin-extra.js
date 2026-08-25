// Extension: load stock selector + dashboard recent orders
// Loaded AFTER app.js so showPage/loadDashboard/api/fmt/statusBadge/fmtDate are available

(function() {
  const _origShowPage = window.showPage;
  if (typeof _origShowPage === 'function') {
    window.showPage = function(name) {
      _origShowPage(name);
      if (name === 'stock') {
        api('GET', '/products?page=0&limit=200').then(d => {
          const sel = document.getElementById('stock-select-prod') || document.getElementById('stock-prod-sel');
          if (!sel) return;
          const cur = window.stockProdId;
          sel.innerHTML = '<option value="">-- Chọn sản phẩm --</option>' +
            (d.products || d).map(p => `<option value="${p.id}" ${p.id===cur?'selected':''}>${p.thumbnailEmoji||'📦'} ${p.name}</option>`).join('');
          if (cur && typeof loadStock === 'function') loadStock(0);
        }).catch(() => {});
      }
    };
  }

  const _origDash = window.loadDashboard;
  if (typeof _origDash === 'function') {
    window.loadDashboard = async function() {
      await _origDash();
      try {
        const d = await api('GET', '/orders?page=0&limit=8');
        const el = document.getElementById('dash-orders') || document.getElementById('dash-orders-table');
        if (el) {
          el.innerHTML = d.orders.length ?
            d.orders.map(o => `<tr>
              <td><code>${o.orderCode}</code></td>
              <td>${o.user?.firstName||''} ${o.user?.username?'@'+o.user.username:''}</td>
              <td><span class="truncate" style="display:block">${o.items?.[0]?.productNameSnapshot||'—'}</span></td>
              <td class="fw-bold">${fmt(o.finalAmount)}</td>
              <td>${typeof getOrdBadge === 'function' ? getOrdBadge(o.status) : (typeof statusBadge === 'function' ? statusBadge(o.status) : o.status)}</td>
              <td class="mono" style="font-size:11px;color:var(--text-muted)">${fmtDate(o.createdAt)}</td>
            </tr>`).join('') : '<tr><td colspan="6" class="empty-state"><p>Chưa có đơn hàng</p></td></tr>';
        }
      } catch(e) {}
    };
  }
})();
