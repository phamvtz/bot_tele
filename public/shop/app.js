const ICON_CDN = "https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons";

const ICON_MAP = [
  { k: ["chatgpt", "chat gpt", "openai"], s: "openai" },
  { k: ["claude"], s: "claude" },
  { k: ["gemini"], s: "google-gemini" },
  { k: ["cursor"], s: "cursor" },
  { k: ["midjourney"], s: "midjourney" },
  { k: ["canva"], s: "canva" },
  { k: ["capcut", "cap cut"], s: "capcut" },
  { k: ["adobe photoshop", "photoshop"], s: "adobe-photoshop" },
  { k: ["adobe premiere", "premiere"], s: "adobe-premiere-pro" },
  { k: ["adobe illustrator", "illustrator"], s: "adobe-illustrator" },
  { k: ["adobe lightroom", "lightroom"], s: "adobe-lightroom" },
  { k: ["adobe after effects", "after effects"], s: "adobe-after-effects" },
  { k: ["adobe"], s: "adobe" },
  { k: ["netflix"], s: "netflix" },
  { k: ["spotify"], s: "spotify" },
  { k: ["youtube", "yt premium"], s: "youtube" },
  { k: ["notion"], s: "notion" },
  { k: ["figma"], s: "figma" },
  { k: ["github"], s: "github" },
  { k: ["discord"], s: "discord" },
  { k: ["telegram"], s: "telegram" },
  { k: ["microsoft office", "ms office", "office 365", "microsoft 365", "o365", "m365"], s: "microsoft-office" },
  { k: ["microsoft", "office", "windows"], s: "microsoft" },
  { k: ["google"], s: "google" },
  { k: ["nordvpn", "nord vpn"], s: "nordvpn" },
  { k: ["expressvpn", "express vpn"], s: "expressvpn" },
  { k: ["surfshark"], s: "surfshark" },
  { k: ["steam"], s: "steam" },
  { k: ["apple", "icloud"], s: "apple" },
  { k: ["zoom"], s: "zoom" },
  { k: ["duolingo"], s: "duolingo" },
  { k: ["grammarly"], s: "grammarly" },
  { k: ["binance", "bnb"], s: "binance" },
];

const state = {
  activeTab: "shop",
  shop: null,
  categories: [],
  products: [],
  flashSales: [],
  apiKeyProfiles: [],
  referral: null,

  // Shop filters
  selectedCategory: "",
  search: "",
  sortBy: "default",

  // Product detail modal
  selectedProduct: null,
  modalQty: 1,
  modalTab: "desc",
  modalCoupon: null,

  // API Key builder
  apikeyProfileId: null,
  apikeyTokensInput: "10m",
  apikeyRpm: 100,
  apikeyDays: 30,

  // Cart
  cart: loadCart(),
  cartCoupon: null,
};

const $ = (id) => document.getElementById(id);

init();

async function init() {
  const hashTab = String(window.location.hash || "").replace(/^#/, "");
  if (["shop", "keys", "info"].includes(hashTab)) {
    state.activeTab = hashTab;
  }
  renderCart();
  await loadCatalog();
}

// ============================================================================
// CATALOG LOAD
// ============================================================================

async function loadCatalog() {
  showLoading();
  try {
    const res = await fetch("/api/shop/catalog", { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("catalog failed");
    const data = await res.json();

    state.shop = data.shop || {};
    state.categories = data.categories || [];
    state.products = data.products || [];
    state.flashSales = data.flashSales || [];
    state.apiKeyProfiles = data.apiKeyProfiles || [];
    state.referral = data.referral || null;

    if (state.apiKeyProfiles.length > 0 && state.apikeyProfileId === null) {
      const first = state.apiKeyProfiles[0];
      state.apikeyProfileId = first.profileId;
      state.apikeyRpm = Number(first.defaultRpm) || 100;
      state.apikeyDays = Number(first.defaultValidDays ?? 30);
      const firstPreset = (first.buyPresetsM || [10])[0] || 10;
      state.apikeyTokensInput = `${firstPreset}m`;
    } else if (!state.apiKeyProfiles.length && state.activeTab === "keys") {
      state.activeTab = "shop";
    }

    normalizeCart();
    renderShopMeta();
    renderNavVisibility();
    renderStats();
    renderFlashSales();
    renderCategories();
    renderProducts();
    renderApiKeyBuilder();
    renderInfoTab();
    renderCart();
    switchTab(state.activeTab, { updateHash: false });
  } catch (err) {
    console.error(err);
    showError();
  }
}

function renderNavVisibility() {
  const hasApiKeys = state.apiKeyProfiles.length > 0;
  toggleHidden("nav-tab-keys", !hasApiKeys);
  toggleHidden("bnav-tab-keys", !hasApiKeys);
  toggleHidden("quick-apikey-card", !hasApiKeys);
  const bnavGrid = $("bottom-nav-grid");
  if (bnavGrid) bnavGrid.classList.toggle("cols-4", hasApiKeys);
}

function renderShopMeta() {
  const s = state.shop || {};
  const name = s.name || "Store";

  document.title = name;
  setEl("page-title", name);
  setEl("shop-name-header", name);
  setEl("footer-shop-name", name);
  setEl("footer-copy", `© ${new Date().getFullYear()} ${name}`);
  setEl("brand-mark", name.trim().charAt(0).toUpperCase() || "S");

  const bannerCard = $("banner-card");
  if (s.bannerText && bannerCard) {
    setEl("banner-text", s.bannerText);
    bannerCard.classList.remove("hidden");
  }

  const botTarget = s.botUsername || s.supportUsername || "";
  const supportTarget = s.supportUsername || s.botUsername || "";

  const botHref = botTarget ? `https://t.me/${botTarget}` : "#";
  const supportHref = supportTarget ? `https://t.me/${supportTarget}` : "#";

  const footerBot = $("footer-bot-link");
  const footerSup = $("footer-support-link");
  const supportBtn = $("support-link-btn");
  if (footerBot) footerBot.href = botHref;
  if (footerSup) footerSup.href = supportHref;
  if (supportBtn) supportBtn.href = supportHref;
}

function renderStats() {
  const products = state.products || [];
  const totalOrders = products.reduce((sum, p) => sum + (Number(p.soldCount) || 0), 0);
  setEl("stat-products", String(products.length));
  setEl("stat-orders", totalOrders >= 1000 ? `${(totalOrders / 1000).toFixed(1).replace(/\.0$/, "")}k+` : String(totalOrders));

  const networks = state.shop?.payments?.cryptoNetworks || [];
  const methods = ["VietQR", "Ví"];
  if (networks.length > 0) methods.push("USDT");
  setEl("stat-payments", methods.join(" · "));
}

function renderFlashSales() {
  const sec = $("flash-section");
  const strip = $("flash-strip");
  if (!sec || !strip) return;

  if (!state.flashSales.length) {
    sec.classList.add("hidden");
    return;
  }

  sec.classList.remove("hidden");
  strip.innerHTML = state.flashSales
    .map((sale) => {
      const slotsText = sale.slotsLeft !== null ? `Còn ${sale.slotsLeft}/${sale.maxSlots}` : "";
      return `
        <div class="flash-card">
          <div>
            <div class="flash-badge-row">
              <span class="flash-pct">−${escapeHtml(sale.discountPct)}%</span>
              ${slotsText ? `<span class="flash-slots tabular">${escapeHtml(slotsText)}</span>` : ""}
            </div>
            <div class="flash-name">${escapeHtml(sale.productName || "Ưu đãi đặc biệt")}</div>
            ${sale.guideText ? `<p class="flash-guide">${escapeHtml(sale.guideText)}</p>` : ""}
          </div>
          <button type="button" class="flash-cta" data-action="open-bot-param" data-arg="flash_${escapeAttr(sale.id)}">
            Nhận ưu đãi trên Bot
          </button>
        </div>
      `;
    })
    .join("");
}

// ============================================================================
// TABS
// ============================================================================

function switchTab(tab, { updateHash = true } = {}) {
  const validTab = tab === "keys" && !state.apiKeyProfiles.length ? "shop" : tab;
  state.activeTab = validTab;

  document.querySelectorAll(".tab-view").forEach((el) => {
    el.classList.toggle("active", el.id === `view-${validTab}`);
  });
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === validTab);
  });

  if (updateHash) {
    history.replaceState(null, "", `#${validTab}`);
  }
  window.scrollTo({ top: 0, behavior: "instant" });
}

// ============================================================================
// SHOP: CATEGORIES & PRODUCTS
// ============================================================================

function renderCategories() {
  const wrap = $("cat-pills");
  if (!wrap) return;
  const pills = [
    `<button type="button" class="cat-pill${state.selectedCategory === "" ? " active" : ""}" data-action="select-category" data-arg="">Tất cả</button>`,
    ...state.categories.map(
      (c) =>
        `<button type="button" class="cat-pill${state.selectedCategory === c.id ? " active" : ""}" data-action="select-category" data-arg="${escapeAttr(c.id)}">${escapeHtml(c.name)}</button>`,
    ),
  ];
  wrap.innerHTML = pills.join("");
}

function selectCategory(id) {
  state.selectedCategory = id;
  renderCategories();
  renderProducts();
}

const _debouncedRenderProducts = debounce(() => renderProducts(), 140);

function onSearch(val) {
  state.search = val;
  _debouncedRenderProducts();
}

function onSort(val) {
  state.sortBy = val;
  renderProducts();
}

function resetFilters() {
  state.selectedCategory = "";
  state.search = "";
  state.sortBy = "default";
  const searchEl = $("search-input");
  const sortEl = $("sort-select");
  if (searchEl) searchEl.value = "";
  if (sortEl) sortEl.value = "default";
  renderCategories();
  renderProducts();
}

function getFilteredProducts() {
  const q = state.search.trim().toLocaleLowerCase("vi-VN");
  const list = state.products.filter((p) => {
    const catOk = !state.selectedCategory || p.categoryId === state.selectedCategory;
    const qOk =
      !q ||
      p.name.toLocaleLowerCase("vi-VN").includes(q) ||
      (p.code || "").toLocaleLowerCase("vi-VN").includes(q) ||
      (p.categoryName || "").toLocaleLowerCase("vi-VN").includes(q);
    return catOk && qOk;
  });

  if (state.sortBy === "price_asc") list.sort((a, b) => productPriceVnd(a) - productPriceVnd(b));
  else if (state.sortBy === "price_desc") list.sort((a, b) => productPriceVnd(b) - productPriceVnd(a));
  else if (state.sortBy === "bestseller") list.sort((a, b) => (b.soldCount || 0) - (a.soldCount || 0));
  else if (state.sortBy === "newest") list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  return list;
}

function renderProducts() {
  const grid = $("product-grid");
  const empty = $("empty-state");
  const countEl = $("products-count");
  if (!grid) return;

  const list = getFilteredProducts();
  if (countEl) countEl.textContent = `${list.length} sản phẩm`;

  if (!list.length) {
    grid.innerHTML = "";
    if (empty) empty.classList.remove("hidden");
    return;
  }

  if (empty) empty.classList.add("hidden");
  grid.innerHTML = list.map(renderProductCard).join("");
}

function renderProductIconHtml(product) {
  const monogram = getProductMonogram(product);
  if (product.imageUrl) {
    return `<img class="card-thumb-img" src="${escapeAttr(product.imageUrl)}" alt="${escapeAttr(product.name)}" loading="lazy" data-fallback="monogram" data-monogram="${escapeAttr(monogram)}" />`;
  }
  const iconUrl = getProductIconUrl(product);
  if (iconUrl) {
    return `<img class="card-icon-img" src="${escapeAttr(iconUrl)}" alt="${escapeAttr(product.name)}" loading="lazy" data-fallback="monogram" data-monogram="${escapeAttr(monogram)}" />`;
  }
  return `<span class="card-monogram">${escapeHtml(monogram)}</span>`;
}

function renderProductCard(p) {
  const out = !p.inStock;
  const priceVnd = productPriceVnd(p);
  const priceUsd = productPriceUsd(p);
  const isContact = p.deliveryMode === "CONTACT" || priceVnd <= 0;

  const statusText = out
    ? "Hết hàng"
    : p.deliveryMode === "STOCK_LINES"
      ? String(p.stockCount)
      : "Auto";

  const subParts = [];
  if (p.categoryName) subParts.push(p.categoryName);
  if (p.soldCount > 0) subParts.push(`Đã bán ${p.soldCount}`);

  return `
    <button type="button" class="product-card${out ? " out-of-stock" : ""}" data-action="open-product" data-arg="${escapeAttr(p.id)}">
      <div>
        <div class="card-top">
          <div class="card-icon-box">${renderProductIconHtml(p)}</div>
          <div class="card-status-wrap">
            <span class="status-dot-pill">
              <span class="dot ${out ? "dot-rose" : "dot-emerald"}"></span>
              ${escapeHtml(statusText)}
            </span>
          </div>
        </div>
        <div class="card-name">${escapeHtml(p.name)}</div>
        ${subParts.length ? `<div class="card-sub-meta">${escapeHtml(subParts.join(" · "))}</div>` : ""}
      </div>

      <div class="card-footer tabular">
        ${
          isContact
            ? `<span class="card-contact-label">Liên hệ</span>`
            : `<span class="card-price-usd">${escapeHtml(formatUsd(priceUsd))}</span>
               <span class="card-price-vnd">${escapeHtml(formatVnd(priceVnd))}</span>`
        }
      </div>
    </button>
  `;
}

// ============================================================================
// PRODUCT DETAIL SHEET (mirrors ProductDetailSheet.jsx)
// ============================================================================

function openProductModal(productId) {
  const product = findProduct(productId);
  if (!product) return;

  state.selectedProduct = product;
  state.modalQty = 1;
  state.modalTab = product.description ? "desc" : product.note ? "note" : "desc";
  state.modalCoupon = null;

  const couponInput = $("modal-coupon-input");
  const couponMsg = $("modal-coupon-msg");
  if (couponInput) couponInput.value = "";
  if (couponMsg) {
    couponMsg.textContent = "";
    couponMsg.className = "coupon-msg hidden";
  }

  // Media
  setHtml("modal-media", renderProductIconHtml(product));

  // Meta line: Category · Stock · Sold
  const stockHtml = product.deliveryMode === "STOCK_LINES"
    ? (product.inStock ? `<span class="text-emerald">Còn ${product.stockCount}</span>` : `<span class="text-rose">Hết hàng</span>`)
    : `<span class="text-emerald">Tự động</span>`;
  const metaParts = [escapeHtml(product.categoryName || "Sản phẩm"), stockHtml];
  if (product.soldCount > 0) metaParts.push(`Đã bán ${product.soldCount}`);
  setHtml("modal-meta-line", metaParts.join(`<span class="sheet-meta-sep">·</span>`));

  setEl("modal-title", product.name);

  // Description & Note tabs
  const descBox = $("modal-desc-box");
  const tabsEl = $("modal-tabs");
  const hasDesc = Boolean(product.description);
  const hasNote = Boolean(product.note);
  if (descBox) {
    if (hasDesc || hasNote) {
      descBox.classList.remove("hidden");
      if (tabsEl) tabsEl.classList.toggle("hidden", !(hasDesc && hasNote));
      renderModalDescTab();
    } else {
      descBox.classList.add("hidden");
    }
  }

  // Contact vs Purchase
  const isContact = product.deliveryMode === "CONTACT" || productPriceVnd(product) <= 0;
  toggleHidden("modal-purchase-area", isContact);
  toggleHidden("modal-contact-area", !isContact);

  if (!isContact) {
    renderModalQtyTiers();
    renderModalSummary();
  } else {
    toggleHidden("modal-qty-tiers", true);
  }

  const overlay = $("product-modal");
  if (overlay) {
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
}

function closeProductModal() {
  const overlay = $("product-modal");
  if (overlay) {
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
  }
  if (!$("cart-drawer")?.classList.contains("open")) {
    document.body.style.overflow = "";
  }
}

function renderModalDescTab() {
  const p = state.selectedProduct;
  if (!p) return;
  document.querySelectorAll("#modal-tabs .seg-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.arg === state.modalTab);
  });
  const text = state.modalTab === "note" && p.note ? p.note : p.description || p.note || "";
  setEl("modal-desc-text", text);
}

function renderModalQtyTiers() {
  const p = state.selectedProduct;
  const wrap = $("modal-qty-tiers");
  if (!wrap || !p) return;

  const tiers = Array.isArray(p.quantityTiers) ? p.quantityTiers : [];
  if (!tiers.length) {
    wrap.classList.add("hidden");
    wrap.innerHTML = "";
    return;
  }

  wrap.classList.remove("hidden");
  wrap.innerHTML =
    `<span class="tier-label">Ưu đãi số lượng:</span>` +
    tiers
      .map((t) => {
        const minQ = Number(t.minQty) || 1;
        const pct = Number(t.discountPercent) || 0;
        const active = state.modalQty >= minQ;
        return `<button type="button" class="tier-chip${active ? " active" : ""}" data-action="modal-set-qty" data-arg="${escapeAttr(minQ)}">${minQ}+ (−${pct}%)</button>`;
      })
      .join("");
}

function renderModalSummary() {
  const p = state.selectedProduct;
  if (!p) return;

  const max = Math.max(1, maxQuantity(p));
  state.modalQty = Math.min(Math.max(1, state.modalQty), max);

  setEl("modal-qty-val", String(state.modalQty));
  const decBtn = $("modal-qty-dec");
  const incBtn = $("modal-qty-inc");
  if (decBtn) decBtn.disabled = state.modalQty <= 1;
  if (incBtn) incBtn.disabled = state.modalQty >= max || !p.inStock;

  const unitVnd = productPriceVnd(p);
  const grossVnd = unitVnd * state.modalQty;

  const qtyPct = getQtyDiscountPercent(p, state.modalQty);
  const qtyDiscVnd = qtyPct > 0 ? Math.floor((grossVnd * qtyPct) / 100) : 0;
  const afterQtyVnd = Math.max(0, grossVnd - qtyDiscVnd);

  let couponDiscVnd = 0;
  if (state.modalCoupon) {
    couponDiscVnd = computeCouponDiscount(state.modalCoupon, afterQtyVnd);
  }
  const finalVnd = Math.max(0, afterQtyVnd - couponDiscVnd);
  const finalUsd = finalVnd / usdVndRate();

  setEl("modal-sub-label", `Tạm tính (${state.modalQty})`);
  setEl("modal-subtotal", formatVnd(grossVnd));

  toggleHidden("modal-qty-disc-row", qtyDiscVnd <= 0);
  if (qtyDiscVnd > 0) {
    setEl("modal-qty-disc-label", `Giảm số lượng (−${qtyPct}%)`);
    setEl("modal-qty-disc-val", `−${formatVnd(qtyDiscVnd)}`);
  }

  toggleHidden("modal-coupon-disc-row", couponDiscVnd <= 0);
  if (couponDiscVnd > 0 && state.modalCoupon) {
    setEl("modal-coupon-disc-label", `Mã ${state.modalCoupon.code}`);
    setEl("modal-coupon-disc-val", `−${formatVnd(couponDiscVnd)}`);
  }

  setEl("modal-total-usd", formatUsd(finalUsd));
  setEl("modal-total-vnd", formatVnd(finalVnd));

  const buyBtn = $("modal-buy-now-btn");
  const addBtn = $("modal-add-btn");
  if (!p.inStock) {
    if (buyBtn) {
      buyBtn.disabled = true;
      buyBtn.textContent = "Tạm hết hàng";
    }
    if (addBtn) addBtn.disabled = true;
  } else {
    if (buyBtn) {
      buyBtn.disabled = false;
      buyBtn.textContent = "Mua ngay trên Telegram";
    }
    if (addBtn) addBtn.disabled = false;
  }
}

async function applyModalCoupon() {
  const p = state.selectedProduct;
  const input = $("modal-coupon-input");
  const msgEl = $("modal-coupon-msg");
  if (!p || !input || !msgEl) return;

  const code = input.value.trim().toUpperCase();
  if (!code) {
    state.modalCoupon = null;
    msgEl.className = "coupon-msg hidden";
    renderModalSummary();
    return;
  }

  const grossVnd = productPriceVnd(p) * state.modalQty;
  const qtyPct = getQtyDiscountPercent(p, state.modalQty);
  const afterQtyVnd = Math.max(0, grossVnd - Math.floor((grossVnd * qtyPct) / 100));

  msgEl.className = "coupon-msg info";
  msgEl.textContent = "Đang kiểm tra mã...";

  const res = await checkCouponApi(code, afterQtyVnd);
  if (!res.ok) {
    state.modalCoupon = null;
    msgEl.className = "coupon-msg error";
    msgEl.textContent = res.error;
  } else {
    state.modalCoupon = res.coupon;
    msgEl.className = "coupon-msg success";
    msgEl.textContent = `Đã áp dụng mã ${code} (−${formatVnd(computeCouponDiscount(res.coupon, afterQtyVnd))})`;
  }
  renderModalSummary();
}

function addToCartFromModal() {
  const p = state.selectedProduct;
  if (!p || !p.inStock) return;
  addToCart(p.id, state.modalQty);
  closeProductModal();
}

function buyNowFromModal() {
  const p = state.selectedProduct;
  if (!p || !p.inStock) return;
  if (state.modalCoupon?.code) {
    copyTextSilent(state.modalCoupon.code);
    showToast(`Đã sao chép mã ${state.modalCoupon.code} — dán trong Bot`, "success");
  }
  openTelegramBot(`product_${p.id}`);
}

// ============================================================================
// API KEY BUILDER (mirrors ApiKeysPage.jsx + src/apikey-pricing.js)
// ============================================================================

function getActiveApiKeyProfile() {
  return state.apiKeyProfiles.find((p) => p.profileId === state.apikeyProfileId) || state.apiKeyProfiles[0] || null;
}

function renderApiKeyBuilder() {
  const profiles = state.apiKeyProfiles || [];
  const hasAny = profiles.length > 0;
  toggleHidden("apikey-unavailable", hasAny);
  toggleHidden("apikey-builder", !hasAny);
  if (!hasAny) return;

  const active = getActiveApiKeyProfile();
  if (!active) return;

  // Server cards (only if > 1 server)
  const serverCard = $("apikey-server-card");
  const serverGrid = $("apikey-server-grid");
  if (serverCard && serverGrid) {
    serverCard.classList.toggle("hidden", profiles.length <= 1);
    serverGrid.innerHTML = profiles
      .map((p) => {
        const isAct = p.profileId === active.profileId;
        return `
          <button type="button" class="server-btn${isAct ? " active" : ""}" data-action="select-apikey-profile" data-arg="${escapeAttr(p.profileId)}">
            <div class="server-btn-name">${escapeHtml(p.name)}</div>
            <div class="server-btn-rate">$${escapeHtml(p.usdPerMtoken)} / 1M</div>
          </button>
        `;
      })
      .join("");
  }

  setEl("apikey-rate-label", `$${active.usdPerMtoken} / 1M`);
  setEl("apikey-rpm-included", `Mặc định ${active.rpmIncluded || 100} RPM`);

  // Token presets
  const presetsWrap = $("apikey-token-presets");
  const presets = (active.buyPresetsM || [5, 10, 20, 50, 100, 200]).slice(0, 6);
  if (presetsWrap) {
    presetsWrap.innerHTML = presets
      .map((m) => {
        const val = `${m}m`;
        const isAct = state.apikeyTokensInput.trim().toLowerCase() === val;
        const label = m >= 1000 ? `${m / 1000}B` : `${m}M`;
        return `<button type="button" class="preset-btn${isAct ? " active" : ""}" data-action="select-apikey-tokens" data-arg="${escapeAttr(val)}">${escapeHtml(label)}</button>`;
      })
      .join("");
  }
  const tokInput = $("apikey-tokens-input");
  if (tokInput && tokInput.value !== state.apikeyTokensInput) {
    tokInput.value = state.apikeyTokensInput;
  }

  // RPM presets
  const rpmWrap = $("apikey-rpm-presets");
  if (rpmWrap) {
    const rpms = active.rpmPresets || [100, 300, 600, 1200];
    rpmWrap.innerHTML = rpms
      .map((r) => {
        const isAct = Number(state.apikeyRpm) === Number(r);
        return `<button type="button" class="opt-pill mono${isAct ? " active" : ""}" data-action="select-apikey-rpm" data-arg="${escapeAttr(r)}">${r} RPM</button>`;
      })
      .join("");
  }

  // Days presets
  const daysWrap = $("apikey-days-presets");
  if (daysWrap) {
    const rawDays = Array.isArray(active.daysPresets) ? active.daysPresets : [1, 3, 7, 30, 90];
    const days = rawDays.includes(0) ? rawDays : [...rawDays, 0];
    daysWrap.innerHTML = days
      .map((d) => {
        const isAct = Number(state.apikeyDays) === Number(d);
        const label = Number(d) === 0 ? "Không giới hạn" : `${d} ngày`;
        return `<button type="button" class="opt-pill${isAct ? " active" : ""}" data-action="select-apikey-days" data-arg="${escapeAttr(d)}">${escapeHtml(label)}</button>`;
      })
      .join("");
  }

  // Models
  const modelsWrap = $("apikey-models-wrap");
  const modelsList = $("apikey-models-list");
  if (modelsWrap && modelsList) {
    const models = Array.isArray(active.models) ? active.models : [];
    modelsWrap.classList.toggle("hidden", !models.length);
    modelsList.innerHTML = models
      .slice(0, 12)
      .map((m) => `<span class="mono-chip">${escapeHtml(m)}</span>`)
      .join("");
  }

  updateApiKeyQuote();
}

function parseTokensClient(raw, maxTokens) {
  const s = String(raw || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  let tokens = NaN;
  if (/^\d+([.,]\d+)?b$/.test(s)) {
    tokens = Math.round(Number(s.slice(0, -1).replace(",", ".")) * 1_000_000_000);
  } else if (/^\d+([.,]\d+)?m$/.test(s)) {
    tokens = Math.round(Number(s.slice(0, -1).replace(",", ".")) * 1_000_000);
  } else if (/^\d+([.,]\d+)?k$/.test(s)) {
    tokens = Math.round(Number(s.slice(0, -1).replace(",", ".")) * 1_000);
  } else if (/^[\d.,]+$/.test(s)) {
    const digits = s.replace(/[.,]/g, "");
    tokens = Number(digits);
  }
  if (!Number.isFinite(tokens) || tokens < 1_000_000) return { ok: false, error: "Tối thiểu 1M token (ví dụ: 10m, 100m, 1b)." };
  if (maxTokens && tokens > maxTokens) return { ok: false, error: `Tối đa ${formatTokensCompact(maxTokens)} token mỗi key.` };
  return { ok: true, tokens };
}

function ceilCents(usd) {
  return Math.ceil(Number((Number(usd) * 100).toFixed(6))) / 100;
}

function updateApiKeyQuote() {
  const active = getActiveApiKeyProfile();
  if (!active) return;

  const errEl = $("apikey-token-error");
  const parsed = parseTokensClient(state.apikeyTokensInput, active.maxBuyTokens);

  if (!parsed || !parsed.ok) {
    if (errEl) {
      errEl.textContent = parsed?.error || "Nhập lượng token hợp lệ (vd: 10m, 50m, 1b).";
      errEl.classList.remove("hidden");
    }
    setEl("apikey-quote-spec", "—");
    setEl("apikey-quote-mult", "—");
    setEl("apikey-quote-usd", "—");
    setEl("apikey-quote-vnd", "");
    return;
  }

  if (errEl) errEl.classList.add("hidden");

  const tokens = parsed.tokens;
  const rpm = Math.max(10, Number(state.apikeyRpm) || active.defaultRpm || 100);
  const days = Number(state.apikeyDays) || 0;
  const rpmIncluded = Math.max(1, Number(active.rpmIncluded) || 100);
  const rpmSurchargePct = Math.max(0, Number(active.rpmSurchargePct) || 0);
  const daySurchargePct = Math.max(0, Number(active.daySurchargePct) || 0);
  const noExpiryMult = Math.max(1, Number(active.noExpiryMult) || 1);
  const perM = Number(active.usdPerMtoken) || 0.01;

  const rpmMult = 1 + (Math.max(0, rpm - rpmIncluded) / rpmIncluded) * (rpmSurchargePct / 100);
  const daysMult = days > 0 ? 1 + Math.max(0, days - 1) * (daySurchargePct / 100) : noExpiryMult;
  const baseUsd = (tokens / 1_000_000) * perM;
  const totalUsd = ceilCents(baseUsd * rpmMult * daysMult);
  const totalVnd = Math.round(totalUsd * usdVndRate());

  setEl(
    "apikey-quote-spec",
    `${formatTokensCompact(tokens)} · ${rpm} RPM · ${days === 0 ? "Vĩnh viễn" : `${days} ngày`}`,
  );
  setEl("apikey-quote-mult", `×${rpmMult.toFixed(2)} · ×${daysMult.toFixed(2)}`);
  setEl("apikey-quote-usd", formatUsd(totalUsd));
  setEl("apikey-quote-vnd", formatVnd(totalVnd));
}

// ============================================================================
// INFO TAB (REFERRAL + PAYMENT + FAQ)
// ============================================================================

function renderInfoTab() {
  // Referral summary
  const ref = state.referral;
  const refCard = $("referral-card");
  const refDetails = $("ref-card-details");
  if (refCard && refDetails && ref?.enabled) {
    refCard.classList.remove("hidden");
    const minM = formatTokensCompact(ref.inviteReferrerMinTokens || 2_000_000);
    const maxM = formatTokensCompact(ref.inviteReferrerMaxTokens || 7_000_000);
    const friendM = formatTokensCompact(ref.inviteTokenAmount || 20_000_000);
    const rows = [];

    if (ref.inviteTokenEnabled) {
      rows.push(["Bạn nhận mỗi lượt mời", `+${minM}–${maxM} vào Key ${ref.inviteReferrerKeyDays || 30}d`]);
      rows.push(["Người được mời nhận", `Key ${friendM} (${ref.inviteTokenDays > 0 ? `${ref.inviteTokenDays} ngày` : "vô hạn"})`]);
    }
    if (ref.milestoneEnabled) {
      rows.push([
        "Thưởng mốc 5 / 10 / 20",
        `+${formatTokensCompact(ref.milestone5Tokens)} · +${formatTokensCompact(ref.milestone10Tokens)} · +${formatTokensCompact(ref.milestone20Tokens)}`,
      ]);
    }
    if (ref.dailyTopEnabled) {
      rows.push([
        "Top 1–2–3 mỗi ngày",
        `${formatTokensCompact(ref.dailyTop1Tokens)} / ${formatTokensCompact(ref.dailyTop2Tokens)} / ${formatTokensCompact(ref.dailyTop3Tokens)}`,
      ]);
    }
    if (ref.pointJoinChannel > 0 || ref.tokenPerPoint > 0) {
      rows.push(["Đổi điểm tích lũy", `1 điểm = ${formatTokensCompact(ref.tokenPerPoint || 10_000_000)} token`]);
    }

    refDetails.innerHTML = rows
      .map(
        ([label, val]) =>
          `<div class="ref-row"><span class="ref-row-label">${escapeHtml(label)}</span><span class="ref-row-val">${escapeHtml(val)}</span></div>`,
      )
      .join("");
  }

  // Payment methods
  const payWrap = $("payment-methods-list");
  if (payWrap) {
    const chips = ["VietQR 24/7", "Ví nội bộ"];
    const nets = state.shop?.payments?.cryptoNetworks || [];
    nets.forEach((n) => {
      const lbl = String(n).toUpperCase().replace("_", " ");
      chips.push(lbl);
    });
    payWrap.innerHTML = chips.map((c) => `<span class="mono-chip">${escapeHtml(c)}</span>`).join("");
  }

  // Bank box
  const bank = state.shop?.bank;
  const bankBox = $("bank-info-box");
  if (bankBox && bank && (bank.account || bank.accountNumber)) {
    bankBox.classList.remove("hidden");
    setEl("bank-name", bank.name || "Ngân hàng");
    setEl("bank-owner", bank.owner || bank.accountName || "");
    setEl("bank-account", bank.account || bank.accountNumber || "");
  }
}

// ============================================================================
// CART
// ============================================================================

function addToCart(productId, qtyToAdd = 1) {
  const p = findProduct(productId);
  if (!p) return;
  if (!p.inStock) {
    showToast("Sản phẩm hiện tạm hết hàng.", "error");
    return;
  }
  const max = maxQuantity(p);
  const current = state.cart[productId] || 0;
  const next = Math.min(max, current + Math.max(1, Number(qtyToAdd) || 1));
  if (next === current && current >= max) {
    showToast(`Chỉ còn tối đa ${max} sản phẩm trong kho.`, "error");
    return;
  }
  state.cart[productId] = next;
  saveCart();
  renderCart();
  showToast("Đã thêm vào giỏ hàng", "success");
}

function updateCartQuantity(productId, delta) {
  const p = findProduct(productId);
  if (!p) {
    removeFromCart(productId);
    return;
  }
  const next = (state.cart[productId] || 0) + delta;
  if (next <= 0) {
    removeFromCart(productId);
    return;
  }
  state.cart[productId] = Math.min(next, maxQuantity(p));
  saveCart();
  renderCart();
}

function removeFromCart(productId) {
  delete state.cart[productId];
  saveCart();
  renderCart();
}

function renderCart() {
  const entries = cartEntries();
  const count = entries.reduce((sum, i) => sum + i.quantity, 0);

  let subtotalVnd = 0;
  let qtyDiscVnd = 0;
  for (const { product, quantity } of entries) {
    const gross = productPriceVnd(product) * quantity;
    subtotalVnd += gross;
    const pct = getQtyDiscountPercent(product, quantity);
    if (pct > 0) qtyDiscVnd += Math.floor((gross * pct) / 100);
  }
  const afterQtyVnd = Math.max(0, subtotalVnd - qtyDiscVnd);
  const couponDiscVnd = state.cartCoupon ? computeCouponDiscount(state.cartCoupon, afterQtyVnd) : 0;
  const totalVnd = Math.max(0, afterQtyVnd - couponDiscVnd);
  const totalUsd = totalVnd / usdVndRate();

  // Header & Bottom badges
  const cartBtn = $("cart-btn");
  if (cartBtn) cartBtn.classList.toggle("has-items", count > 0);
  setEl("cart-count", String(count));
  setEl("cart-count-drawer", String(count));
  setEl("header-cart-total", count > 0 ? formatUsd(totalUsd) : "Giỏ hàng");

  const bottomBadge = $("cart-count-bottom");
  if (bottomBadge) {
    bottomBadge.textContent = String(count);
    bottomBadge.classList.toggle("hidden", count === 0);
  }

  const listEl = $("cart-items-list");
  const footerEl = $("cart-footer");
  if (!listEl) return;

  if (!entries.length) {
    listEl.innerHTML = `
      <div class="empty-card">
        <p class="empty-title">Giỏ hàng đang trống</p>
        <p class="empty-sub">Chọn sản phẩm bất kỳ để xem chi tiết hoặc thêm vào giỏ.</p>
        <button type="button" class="btn-link" data-action="close-cart">Tiếp tục xem sản phẩm</button>
      </div>`;
    if (footerEl) footerEl.classList.add("hidden");
    return;
  }

  if (footerEl) footerEl.classList.remove("hidden");

  listEl.innerHTML = entries
    .map(({ product, quantity }) => {
      const unitUsd = productPriceUsd(product);
      const unitVnd = productPriceVnd(product);
      return `
        <div class="cart-item">
          <div class="card-icon-box">${renderProductIconHtml(product)}</div>
          <div class="cart-item-info">
            <div class="cart-item-name">${escapeHtml(product.name)}</div>
            <div class="cart-item-price tabular">${escapeHtml(formatUsd(unitUsd))} · ${escapeHtml(formatVnd(unitVnd))}</div>
            <div class="cart-item-controls">
              <button type="button" class="qty-mini-btn" data-action="qty-dec" data-arg="${escapeAttr(product.id)}" aria-label="Giảm">−</button>
              <span class="qty-mini-val tabular">${quantity}</span>
              <button type="button" class="qty-mini-btn" data-action="qty-inc" data-arg="${escapeAttr(product.id)}" aria-label="Tăng">+</button>
              <button type="button" class="qty-remove-btn" data-action="remove-from-cart" data-arg="${escapeAttr(product.id)}">Xóa</button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  setEl("cart-subtotal", formatVnd(subtotalVnd));
  toggleHidden("cart-qty-disc-row", qtyDiscVnd <= 0);
  setEl("cart-qty-disc", `−${formatVnd(qtyDiscVnd)}`);
  toggleHidden("discount-row", couponDiscVnd <= 0);
  setEl("cart-discount", `−${formatVnd(couponDiscVnd)}`);
  setEl("cart-total-usd", formatUsd(totalUsd));
  setEl("cart-total-vnd", formatVnd(totalVnd));
}

async function applyCartCoupon() {
  const input = $("coupon-input");
  const resultEl = $("coupon-result");
  if (!input || !resultEl) return;

  const code = input.value.trim().toUpperCase();
  if (!code) {
    state.cartCoupon = null;
    resultEl.className = "coupon-msg hidden";
    renderCart();
    return;
  }

  let afterQty = 0;
  for (const { product, quantity } of cartEntries()) {
    const gross = productPriceVnd(product) * quantity;
    const pct = getQtyDiscountPercent(product, quantity);
    afterQty += Math.max(0, gross - Math.floor((gross * pct) / 100));
  }

  resultEl.className = "coupon-msg info";
  resultEl.textContent = "Đang kiểm tra mã...";

  const res = await checkCouponApi(code, afterQty);
  if (!res.ok) {
    state.cartCoupon = null;
    resultEl.className = "coupon-msg error";
    resultEl.textContent = res.error;
  } else {
    state.cartCoupon = res.coupon;
    resultEl.className = "coupon-msg success";
    resultEl.textContent = `Đã áp dụng mã ${code} (−${formatVnd(computeCouponDiscount(res.coupon, afterQty))})`;
  }
  renderCart();
}

function openCart() {
  const drawer = $("cart-drawer");
  const overlay = $("cart-overlay");
  if (drawer) drawer.classList.add("open");
  if (overlay) {
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
  }
  document.body.style.overflow = "hidden";
}

function closeCart() {
  const drawer = $("cart-drawer");
  const overlay = $("cart-overlay");
  if (drawer) drawer.classList.remove("open");
  if (overlay) {
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
  }
  if (!$("product-modal")?.classList.contains("open")) {
    document.body.style.overflow = "";
  }
}

function handleCheckout() {
  const entries = cartEntries();
  if (!entries.length) {
    showToast("Giỏ hàng đang trống.", "error");
    return;
  }
  if (state.cartCoupon?.code) {
    copyTextSilent(state.cartCoupon.code);
    showToast(`Đã sao chép mã ${state.cartCoupon.code} — dán trong Bot`, "success");
  }
  const param = entries.length === 1 ? `product_${entries[0].product.id}` : "shop";
  openTelegramBot(param);
}

// ============================================================================
// TELEGRAM & COUPON HELPERS
// ============================================================================

async function checkCouponApi(code, amountVnd) {
  try {
    const res = await fetch(`/api/shop/coupon/${encodeURIComponent(code)}?amount=${Math.round(amountVnd)}`);
    const data = await res.json();
    if (!res.ok || data.error) {
      return { ok: false, error: data.error || "Mã giảm giá không hợp lệ." };
    }
    const type = String(data.discountType || "").toUpperCase();
    return {
      ok: true,
      coupon: {
        code,
        type: type === "PERCENT" ? "percent" : "amount",
        value: type === "PERCENT" ? Number(data.discountValue || 0) : Number(data.discountAmount || 0),
        maxDiscount: Number(data.maxDiscount || 0),
      },
    };
  } catch {
    return { ok: false, error: "Không kết nối được máy chủ. Vui lòng thử lại." };
  }
}

function computeCouponDiscount(coupon, baseVnd) {
  if (!coupon || baseVnd <= 0) return 0;
  if (coupon.type === "percent") {
    let disc = Math.floor((baseVnd * coupon.value) / 100);
    if (coupon.maxDiscount > 0 && disc > coupon.maxDiscount) disc = coupon.maxDiscount;
    return Math.min(baseVnd, disc);
  }
  return Math.min(baseVnd, Math.round(coupon.value || 0));
}

function openTelegramBot(startParam = "shop") {
  const s = state.shop || {};
  const target = s.botUsername || s.supportUsername;
  if (!target) {
    showToast("Chưa cấu hình bot Telegram.", "error");
    return;
  }
  const suffix = s.botUsername && startParam ? `?start=${encodeURIComponent(startParam)}` : "";
  const link = `https://t.me/${target}${suffix}`;
  if (window.Telegram?.WebApp?.openTelegramLink) {
    window.Telegram.WebApp.openTelegramLink(link);
    return;
  }
  window.open(link, "_blank", "noopener,noreferrer");
}

function openSupportTelegram() {
  const s = state.shop || {};
  const target = s.supportUsername || s.botUsername;
  if (!target) {
    showToast("Chưa cấu hình liên hệ hỗ trợ.", "error");
    return;
  }
  window.open(`https://t.me/${target}`, "_blank", "noopener,noreferrer");
}

function toggleFaq(btn) {
  const item = btn.closest(".faq-item");
  if (!item) return;
  const wasOpen = item.classList.contains("open");
  document.querySelectorAll(".faq-item.open").forEach((el) => {
    el.classList.remove("open");
    const plus = el.querySelector(".faq-plus");
    if (plus) plus.textContent = "+";
  });
  if (!wasOpen) {
    item.classList.add("open");
    const plus = item.querySelector(".faq-plus");
    if (plus) plus.textContent = "−";
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getProductIconUrl(product) {
  if (product.iconSlug) return `${ICON_CDN}/${product.iconSlug}/default.svg`;
  const hay = `${product.name || ""} ${product.code || ""} ${product.categoryName || ""}`.toLowerCase();
  for (const { k, s } of ICON_MAP) {
    if (k.some((kw) => hay.includes(kw))) return `${ICON_CDN}/${s}/default.svg`;
  }
  return null;
}

function getProductMonogram(product) {
  const raw = String(product?.name || product?.code || "SP").trim();
  const words = raw.replace(/[^a-zA-Z0-9\s]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return (words[0] || "SP").slice(0, 2).toUpperCase();
}

function getQtyDiscountPercent(product, qty) {
  if (!product || qty < 2) return 0;
  const tiers = Array.isArray(product.quantityTiers) ? product.quantityTiers : [];
  let best = 0;
  for (const t of tiers) {
    const minQ = Number(t.minQty) || 0;
    const pct = Number(t.discountPercent) || 0;
    if (qty >= minQ && pct > best) best = pct;
  }
  return Math.min(100, Math.max(0, best));
}

function cartEntries() {
  return Object.entries(state.cart)
    .map(([id, quantity]) => ({ product: findProduct(id), quantity }))
    .filter((i) => i.product && i.quantity > 0);
}

function normalizeCart() {
  const next = {};
  for (const [id, qty] of Object.entries(state.cart)) {
    const p = findProduct(id);
    if (!p || !p.inStock) continue;
    next[id] = Math.min(Math.max(1, Number(qty) || 1), maxQuantity(p));
  }
  state.cart = next;
  saveCart();
}

function findProduct(id) {
  return state.products.find((p) => String(p.id) === String(id));
}

function maxQuantity(product) {
  if (product.deliveryMode === "STOCK_LINES") return Math.max(0, Number(product.stockCount) || 0);
  return 99;
}

function usdVndRate() {
  const rate = Number(state.shop?.usdVndRate || 26500);
  return Number.isFinite(rate) && rate > 0 ? rate : 26500;
}

function isUsdProduct(product) {
  return ["USD", "USDT"].includes(String(product?.currency || "VND").toUpperCase());
}

function productPriceVnd(product) {
  if (typeof product?.priceVnd === "number") return product.priceVnd;
  return isUsdProduct(product)
    ? Math.round(Number(product?.price || 0) * usdVndRate())
    : Math.round(Number(product?.price || 0));
}

function productPriceUsd(product) {
  if (typeof product?.priceUsd === "number") return product.priceUsd;
  return isUsdProduct(product)
    ? Number(product?.price || 0)
    : Number(product?.price || 0) / usdVndRate();
}

function formatVnd(amount) {
  return `${new Intl.NumberFormat("vi-VN").format(Math.round(Number(amount || 0)))}đ`;
}

function formatUsd(amount) {
  return `$${Number(amount || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatTokensCompact(tokens) {
  const n = Number(tokens || 0);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000_000) {
    const b = n / 1_000_000_000;
    return `${Number.isInteger(b) ? b : b.toFixed(1).replace(/\.0$/, "")}B`;
  }
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function showLoading() {
  const grid = $("product-grid");
  if (grid) grid.innerHTML = Array(8).fill(`<div class="skeleton-card"></div>`).join("");
  toggleHidden("empty-state", true);
}

function showError() {
  const grid = $("product-grid");
  if (grid) {
    grid.innerHTML = `
      <div class="empty-card" style="grid-column: 1 / -1">
        <p class="empty-title">Không tải được danh sách sản phẩm</p>
        <p class="empty-sub">Vui lòng kiểm tra kết nối và thử lại.</p>
        <button type="button" class="btn-link" data-action="reload-catalog">Thử lại</button>
      </div>`;
  }
}

function showToast(message, type = "") {
  const area = $("toast-area");
  if (!area) return;
  const el = document.createElement("div");
  el.className = `toast${type ? ` ${type}` : ""}`;
  el.textContent = message;
  area.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(-6px)";
    setTimeout(() => el.remove(), 260);
  }, 2400);
}

function copyTextSilent(text) {
  if (!text) return;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(String(text)).catch(() => {});
  }
}

function setEl(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function setHtml(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
}

function toggleHidden(id, hide) {
  const el = $(id);
  if (el) el.classList.toggle("hidden", Boolean(hide));
}

function loadCart() {
  try { return JSON.parse(localStorage.getItem("shop-cart") || "{}"); }
  catch { return {}; }
}

function saveCart() {
  try { localStorage.setItem("shop-cart", JSON.stringify(state.cart)); } catch {}
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replaceAll("`", "&#096;");
}

function debounce(fn, wait = 160) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

// ============================================================================
// CSP-FRIENDLY EVENT DELEGATION
// ============================================================================

const SHOP_ACTIONS = {
  "switch-tab": (arg, _el, ev) => {
    ev.preventDefault();
    switchTab(arg || "shop");
  },
  "close-banner": () => toggleHidden("banner-card", true),
  "open-cart": () => openCart(),
  "close-cart": () => closeCart(),
  "open-bot": () => openTelegramBot("shop"),
  "open-bot-param": (arg) => openTelegramBot(arg || "shop"),
  "contact-admin": () => openSupportTelegram(),
  "select-category": (arg) => selectCategory(arg || ""),
  "reset-filters": () => resetFilters(),
  "reload-catalog": () => loadCatalog(),
  "open-product": (arg) => openProductModal(arg),
  "close-modal-on-backdrop": (_arg, el, ev) => {
    if (ev.target === el) closeProductModal();
  },
  "close-product-modal": () => closeProductModal(),
  "switch-modal-tab": (arg) => {
    state.modalTab = arg || "desc";
    renderModalDescTab();
  },
  "modal-qty-dec": () => {
    state.modalQty = Math.max(1, state.modalQty - 1);
    renderModalQtyTiers();
    renderModalSummary();
  },
  "modal-qty-inc": () => {
    state.modalQty += 1;
    renderModalQtyTiers();
    renderModalSummary();
  },
  "modal-set-qty": (arg) => {
    state.modalQty = Math.max(1, Number(arg) || 1);
    renderModalQtyTiers();
    renderModalSummary();
  },
  "apply-modal-coupon": () => applyModalCoupon(),
  "add-to-cart-from-modal": () => addToCartFromModal(),
  "buy-now-from-modal": () => buyNowFromModal(),
  "qty-dec": (arg) => updateCartQuantity(arg, -1),
  "qty-inc": (arg) => updateCartQuantity(arg, 1),
  "remove-from-cart": (arg) => removeFromCart(arg),
  "apply-coupon": () => applyCartCoupon(),
  "checkout": () => handleCheckout(),
  "select-apikey-profile": (arg) => {
    const id = Number(arg);
    const p = state.apiKeyProfiles.find((x) => Number(x.profileId) === id);
    if (!p) return;
    state.apikeyProfileId = p.profileId;
    state.apikeyRpm = Number(p.defaultRpm) || 100;
    state.apikeyDays = Number(p.defaultValidDays ?? 30);
    renderApiKeyBuilder();
  },
  "select-apikey-tokens": (arg) => {
    state.apikeyTokensInput = arg || "10m";
    renderApiKeyBuilder();
  },
  "select-apikey-rpm": (arg) => {
    state.apikeyRpm = Number(arg) || 100;
    renderApiKeyBuilder();
  },
  "select-apikey-days": (arg) => {
    state.apikeyDays = Number(arg);
    renderApiKeyBuilder();
  },
  "copy-bank": () => {
    const acc = state.shop?.bank?.account || state.shop?.bank?.accountNumber || "";
    if (!acc) return;
    copyTextSilent(acc);
    showToast(`Đã sao chép STK: ${acc}`, "success");
  },
  "toggle-faq": (_arg, btn) => toggleFaq(btn),
};

document.addEventListener("click", (ev) => {
  const target = ev.target.closest("[data-action]");
  if (!target) return;
  const handler = SHOP_ACTIONS[target.dataset.action];
  if (!handler) return;
  handler(target.dataset.arg ?? "", target, ev);
});

document.addEventListener("input", (ev) => {
  const el = ev.target;
  const type = el.dataset?.input;
  if (!type) return;
  if (type === "search") {
    onSearch(el.value);
  } else if (type === "coupon" || type === "modal-coupon") {
    el.value = el.value.toUpperCase();
  } else if (type === "apikey-tokens") {
    state.apikeyTokensInput = el.value;
    document.querySelectorAll("#apikey-token-presets .preset-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.arg === el.value.trim().toLowerCase());
    });
    updateApiKeyQuote();
  }
});

document.addEventListener("change", (ev) => {
  const el = ev.target;
  if (el.dataset?.input === "sort") onSort(el.value);
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    closeProductModal();
    closeCart();
  }
});

// Replace failed brand SVG / product image with clean Geist Mono monogram
document.addEventListener(
  "error",
  (ev) => {
    const img = ev.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (img.dataset?.fallback !== "monogram") return;
    const span = document.createElement("span");
    span.className = "card-monogram";
    span.textContent = img.dataset.monogram || "SP";
    img.replaceWith(span);
  },
  true,
);
