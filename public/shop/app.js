const ICON_CDN = "https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons";

const ICON_MAP = [
  // Streaming / Video
  { k: ["netflix"],                                          s: "netflix" },
  { k: ["spotify"],                                         s: "spotify" },
  { k: ["youtube", "yt premium"],                           s: "youtube" },
  { k: ["twitch"],                                          s: "twitch" },
  { k: ["disney"],                                          s: "disney-plus" },
  { k: ["amazon prime", "prime video"],                     s: "amazon-prime" },
  { k: ["hbo"],                                             s: "hbo" },
  { k: ["crunchyroll"],                                     s: "crunchyroll" },
  { k: ["hulu"],                                            s: "hulu" },
  { k: ["apple tv", "appletv"],                             s: "apple-tv" },
  { k: ["deezer"],                                          s: "deezer" },
  { k: ["soundcloud"],                                      s: "soundcloud" },
  { k: ["apple music"],                                     s: "apple-music" },
  { k: ["tidal"],                                           s: "tidal" },

  // Social
  { k: ["discord"],                                         s: "discord" },
  { k: ["telegram"],                                        s: "telegram" },
  { k: ["instagram"],                                       s: "instagram" },
  { k: ["facebook"],                                        s: "facebook" },
  { k: ["twitter", "x.com"],                                s: "twitter" },
  { k: ["tiktok"],                                          s: "tiktok" },
  { k: ["whatsapp"],                                        s: "whatsapp" },
  { k: ["reddit"],                                          s: "reddit" },
  { k: ["linkedin"],                                        s: "linkedin" },
  { k: ["pinterest"],                                       s: "pinterest" },
  { k: ["snapchat"],                                        s: "snapchat" },
  { k: ["youtube studio"],                                  s: "youtube-studio" },

  // Video editing / Creative tools
  { k: ["capcut", "cap cut"],                               s: "capcut" },
  { k: ["canva"],                                           s: "canva" },
  { k: ["figma"],                                           s: "figma" },
  { k: ["adobe photoshop", "photoshop"],                    s: "adobe-photoshop" },
  { k: ["adobe premiere", "premiere pro"],                  s: "adobe-premiere-pro" },
  { k: ["adobe illustrator", "illustrator"],                s: "adobe-illustrator" },
  { k: ["adobe lightroom", "lightroom"],                    s: "adobe-lightroom" },
  { k: ["adobe after effects", "after effects"],            s: "adobe-after-effects" },
  { k: ["adobe acrobat", "acrobat"],                        s: "adobe-acrobat" },
  { k: ["adobe"],                                           s: "adobe" },
  { k: ["davinci resolve", "davinci"],                      s: "davinci-resolve" },
  { k: ["final cut"],                                       s: "final-cut-pro" },
  { k: ["filmora"],                                         s: "filmora" },
  { k: ["envato"],                                          s: "envato" },
  { k: ["freepik"],                                         s: "freepik" },

  // AI / Productivity
  { k: ["chatgpt", "chat gpt", "openai"],                   s: "openai" },
  { k: ["midjourney"],                                      s: "midjourney" },
  { k: ["claude"],                                          s: "claude" },
  { k: ["gemini"],                                          s: "google-gemini" },
  { k: ["notion"],                                          s: "notion" },
  { k: ["slack"],                                           s: "slack" },
  { k: ["zoom"],                                            s: "zoom" },
  { k: ["dropbox"],                                         s: "dropbox" },
  { k: ["grammarly"],                                       s: "grammarly" },
  { k: ["duolingo"],                                        s: "duolingo" },
  { k: ["udemy"],                                           s: "udemy" },
  { k: ["coursera"],                                        s: "coursera" },
  { k: ["skillshare"],                                      s: "skillshare" },
  { k: ["1password"],                                       s: "1password" },
  { k: ["lastpass"],                                        s: "lastpass" },
  { k: ["trello"],                                          s: "trello" },
  { k: ["asana"],                                           s: "asana" },
  { k: ["monday.com", "monday"],                            s: "monday" },
  { k: ["loom"],                                            s: "loom" },

  // Microsoft / Google
  { k: ["microsoft office", "ms office", "office 365", "microsoft 365", "o365", "m365"], s: "microsoft-office" },
  { k: ["microsoft word", "word"],                          s: "microsoft-word" },
  { k: ["microsoft excel", "excel"],                        s: "microsoft-excel" },
  { k: ["microsoft powerpoint", "powerpoint"],              s: "microsoft-powerpoint" },
  { k: ["microsoft teams", "teams"],                        s: "microsoft-teams" },
  { k: ["microsoft onedrive", "onedrive"],                  s: "microsoft-onedrive" },
  { k: ["windows"],                                         s: "windows" },
  { k: ["microsoft"],                                       s: "microsoft" },
  { k: ["google drive"],                                    s: "google-drive" },
  { k: ["google docs"],                                     s: "google-docs" },
  { k: ["google sheets"],                                   s: "google-sheets" },
  { k: ["google workspace", "gsuite"],                      s: "google-workspace" },
  { k: ["gmail", "google mail"],                            s: "gmail" },
  { k: ["google"],                                          s: "google" },

  // VPN
  { k: ["nordvpn", "nord vpn"],                             s: "nordvpn" },
  { k: ["expressvpn", "express vpn"],                       s: "expressvpn" },
  { k: ["surfshark"],                                       s: "surfshark" },
  { k: ["cyberghost"],                                      s: "cyberghost" },
  { k: ["protonvpn", "proton vpn"],                         s: "protonvpn" },

  // Storage / Cloud
  { k: ["mega"],                                            s: "mega" },
  { k: ["icloud"],                                          s: "icloud" },

  // Games / Gaming
  { k: ["steam"],                                           s: "steam" },
  { k: ["playstation", "ps plus", "ps4", "ps5", "psn"],    s: "playstation" },
  { k: ["xbox"],                                            s: "xbox" },
  { k: ["minecraft"],                                       s: "minecraft" },
  { k: ["roblox"],                                          s: "roblox" },
  { k: ["valorant"],                                        s: "valorant" },
  { k: ["pubg"],                                            s: "pubg" },
  { k: ["epic games", "fortnite"],                          s: "epic-games" },
  { k: ["league of legends", "lol"],                        s: "league-of-legends" },
  { k: ["garena"],                                          s: "garena" },
  { k: ["mobile legends", "mlbb"],                          s: "mobile-legends" },
  { k: ["free fire"],                                       s: "free-fire" },
  { k: ["genshin"],                                         s: "genshin-impact" },
  { k: ["blizzard"],                                        s: "blizzard" },

  // Crypto
  { k: ["bitcoin", "btc"],                                  s: "bitcoin" },
  { k: ["ethereum", "eth"],                                 s: "ethereum" },
  { k: ["binance", "bnb"],                                  s: "binance" },
  { k: ["coinbase"],                                        s: "coinbase" },

  // Other brands
  { k: ["github"],                                          s: "github" },
  { k: ["apple"],                                           s: "apple" },
  { k: ["amazon"],                                          s: "amazon" },
  { k: ["paypal"],                                          s: "paypal" },
  { k: ["shopify"],                                         s: "shopify" },
  { k: ["wordpress"],                                       s: "wordpress" },
  { k: ["docker"],                                          s: "docker" },
  { k: ["vercel"],                                          s: "vercel" },
  { k: ["ebay"],                                            s: "ebay" },
  { k: ["aliexpress"],                                      s: "aliexpress" },
];

function getProductIconUrl(product) {
  if (product.iconSlug) return `${ICON_CDN}/${product.iconSlug}/default.svg`;
  const haystack = `${product.name} ${product.code} ${product.categoryName}`.toLowerCase();
  for (const { k, s } of ICON_MAP) {
    if (k.some((kw) => haystack.includes(kw))) {
      return `${ICON_CDN}/${s}/default.svg`;
    }
  }
  return null;
}

// ===== STATE =====
const state = {
  shop: null,
  categories: [],
  products: [],
  cart: loadCart(),
  selectedCategory: "",
  search: "",
  sortBy: "default",
  priceMin: "",
  priceMax: "",
  selectedProduct: null,
  appliedCoupon: null,
};

const $ = (id) => document.getElementById(id);

// ===== INIT =====
init();

async function init() {
  renderCart();
  await loadCatalog();
}

// ===== CATALOG =====
async function loadCatalog() {
  showLoading();
  try {
    const res = await fetch("/api/shop/catalog", { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("catalog failed");
    const data = await res.json();
    state.shop = data.shop;
    state.categories = data.categories || [];
    state.products = data.products || [];
    normalizeCart();
    renderShopMeta();
    renderStats();
    renderCategories();
    renderProducts();
    renderCart();
    // notify 3D scroll-reveal to pick up newly rendered elements
    document.dispatchEvent(new CustomEvent("shopCatalogLoaded"));
  } catch (e) {
    console.error(e);
    showError();
  }
}

function renderStats() {
  const products = state.products || [];
  const totalOrders = products.reduce((s, p) => s + (p.soldCount || 0), 0);
  const statOrders = $("stat-orders");
  const statProducts = $("stat-products");
  function fmtNum(n) {
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k+";
    return String(n) + "+";
  }
  if (statOrders) statOrders.textContent = fmtNum(Math.max(totalOrders, 0));
  if (statProducts) statProducts.textContent = products.length + "+";
  // trigger animated counters after a short paint delay
  setTimeout(() => _animateStatCounters(totalOrders, products.length), 80);
}

function renderShopMeta() {
  const s = state.shop || {};
  const name = s.name || "Shop Bot";

  document.title = name;
  setEl("page-title", name);
  setEl("shop-name-header", name);
  setEl("hero-shop-name", name);
  setEl("footer-shop-name", name);
  setEl("footer-copy", `© ${new Date().getFullYear()} ${name}.`);

  document.querySelectorAll(".brand-icon").forEach((el) => {
    el.textContent = name.charAt(0).toUpperCase();
  });

  if (s.bannerText) {
    const bar = $("announcement-bar");
    const txt = $("announcement-text");
    if (bar && txt) {
      txt.textContent = s.bannerText;
      bar.classList.remove("hidden");
    }
  }

  const botUsername = s.botUsername || s.supportUsername;
  const supportUsername = s.supportUsername;
  const botLink = $("footer-bot-link");
  const supportLink = $("footer-support-link");
  if (botLink && botUsername) botLink.href = `https://t.me/${botUsername}`;
  if (supportLink && supportUsername) supportLink.href = `https://t.me/${supportUsername}`;

  const bankInfo = $("footer-bank-info");
  if (bankInfo && s.bank) {
    const accountNumber = s.bank.account || s.bank.accountNumber;
    const owner = s.bank.owner || s.bank.accountName;
    const parts = [s.bank.name, accountNumber, owner].filter(Boolean);
    bankInfo.textContent = parts.join(" — ");
  }
}

// ===== CATEGORIES =====
function renderCategories() {
  const scroll = $("cat-scroll");
  if (scroll) {
    scroll.innerHTML = [
      catChip("", "Tất cả", state.selectedCategory === ""),
      ...state.categories.map((c) => catChip(c.id, `${c.icon ? c.icon + " " : ""}${c.name}`, state.selectedCategory === c.id)),
    ].join("");
  }

  const filterList = $("filter-cat-list");
  if (filterList) {
    filterList.innerHTML = [
      filterCatOption("", "Tất cả", state.selectedCategory === ""),
      ...state.categories.map((c) => filterCatOption(c.id, `${c.icon ? c.icon + " " : ""}${c.name}`, state.selectedCategory === c.id)),
    ].join("");
  }
}

function catChip(id, label, active) {
  return `<button class="cat-chip${active ? " active" : ""}" data-action="select-category" data-arg="${escapeAttr(id)}">${escapeHtml(label)}</button>`;
}

function filterCatOption(id, label, selected) {
  return `<label class="filter-option${selected ? " selected" : ""}">
    <input type="radio" name="cat" value="${escapeAttr(id)}" ${selected ? "checked" : ""} data-input="filter-cat">
    ${escapeHtml(label)}
  </label>`;
}

function selectCategory(id) {
  state.selectedCategory = id;
  renderCategories();
  renderProducts();
}

// ===== SEARCH & FILTERS =====
const _renderProductsDebounced = debounce(() => renderProducts(), 150);
function onSearch(value) {
  state.search = value;
  const d = $("search-desktop");
  const m = $("search-mobile");
  if (d && d.value !== value) d.value = value;
  if (m && m.value !== value) m.value = value;
  _renderProductsDebounced();
}

function onSortChange() {
  const sel = $("sort-select");
  if (sel) {
    state.sortBy = sel.value;
    const mob = $("sort-select-mobile");
    if (mob) mob.value = sel.value;
  }
  renderProducts();
}

function onSortChangeMobile() {
  const mob = $("sort-select-mobile");
  if (mob) {
    state.sortBy = mob.value;
    const desk = $("sort-select");
    if (desk) desk.value = mob.value;
  }
  renderProducts();
}

function onPriceFilter() {
  state.priceMin = $("price-min")?.value || "";
  state.priceMax = $("price-max")?.value || "";
  renderProducts();
}

function resetFilters() {
  state.selectedCategory = "";
  state.search = "";
  state.sortBy = "default";
  state.priceMin = "";
  state.priceMax = "";

  const fields = {
    "search-desktop": "", "search-mobile": "",
    "price-min": "", "price-max": "",
    "sort-select": "default", "sort-select-mobile": "default",
  };
  for (const [id, val] of Object.entries(fields)) {
    const el = $(id);
    if (el) el.value = val;
  }

  renderCategories();
  renderProducts();
}

function toggleFilterSidebar() {
  const sidebar = $("filters-sidebar");
  if (sidebar) sidebar.classList.toggle("mobile-open");
}

// ===== PRODUCTS =====
function renderProducts() {
  const grid = $("product-grid");
  const empty = $("empty-state");
  const count = $("products-count");
  if (!grid) return;

  const products = getFilteredProducts();

  if (!products.length) {
    grid.innerHTML = "";
    if (empty) empty.classList.remove("hidden");
    if (count) count.textContent = "0 sản phẩm";
    return;
  }

  if (empty) empty.classList.add("hidden");
  if (count) count.textContent = `${products.length} sản phẩm`;
  grid.innerHTML = products.map(productCard).join("");
}

function productCard(product) {
  const outOfStock = !product.inStock;
  const iconUrl = getProductIconUrl(product);
  const isBestseller = (product.soldCount || 0) > 5;
  const isLowStock = product.deliveryMode === "STOCK_LINES" && product.stockCount > 0 && product.stockCount <= 3;
  const description = product.description || "Sản phẩm số giao tự động qua bot sau thanh toán.";

  const badges = [];
  if (isBestseller) badges.push(`<span class="badge badge-hot">🔥 Bán chạy</span>`);
  if (isLowStock) badges.push(`<span class="badge badge-low">⚠️ Còn ít</span>`);
  if (outOfStock) badges.push(`<span class="badge badge-out">Hết hàng</span>`);

  let mediaContent;
  if (product.imageUrl) {
    mediaContent = `<img class="product-card-img" src="${escapeAttr(product.imageUrl)}" alt="${escapeAttr(product.name)}" loading="lazy" data-fallback="card-img">
      <div class="product-card-icon-wrap" hidden>
        ${iconUrl ? `<img class="product-card-icon-img" src="${escapeAttr(iconUrl)}" alt="" data-fallback="card-icon" data-fallback-text="${escapeAttr(shortProductName(product))}">` : `<span class="product-card-icon-emoji">${escapeHtml(shortProductName(product))}</span>`}
      </div>`;
  } else if (iconUrl) {
    mediaContent = `<img class="product-card-icon-img" src="${escapeAttr(iconUrl)}" alt="${escapeAttr(product.name)}" data-fallback="card-icon" data-fallback-text="${escapeAttr(shortProductName(product))}">`;
  } else {
    mediaContent = `<span class="product-card-icon-emoji">${escapeHtml(shortProductName(product))}</span>`;
  }

  return `
    <article class="product-card${outOfStock ? " out-of-stock" : ""}" data-action="open-product" data-arg="${escapeAttr(product.id)}">
      <div class="product-card-media">
        ${mediaContent}
        ${badges.length ? `<div class="product-card-badges">${badges.join("")}</div>` : ""}
        <div class="media-line"></div>
      </div>
      <div class="product-card-body">
        <p class="product-card-cat">${escapeHtml(product.categoryIcon || "")} ${escapeHtml(product.categoryName || "")}</p>
        <h3 class="product-card-name">${escapeHtml(product.name)}</h3>
        <p class="product-card-desc">${escapeHtml(description)}</p>
        <div class="product-card-price-row">
          <strong class="product-card-price">${formatProductPrice(product)}</strong>
          ${product.soldCount ? `<span class="product-sold">Đã bán: ${product.soldCount}</span>` : ""}
        </div>
        <div class="product-card-actions">
          <button class="btn-detail" data-action="open-product-stop" data-arg="${escapeAttr(product.id)}">Chi tiết</button>
          <button class="btn-add" data-action="add-to-cart-stop" data-arg="${escapeAttr(product.id)}" ${outOfStock ? "disabled" : ""}>
            ${outOfStock ? "Hết hàng" : "+ Giỏ"}
          </button>
        </div>
      </div>
    </article>
  `;
}

// ===== PRODUCT MODAL =====
function openProductModal(productId) {
  const product = findProduct(productId);
  if (!product) return;
  state.selectedProduct = product;
  const outOfStock = !product.inStock;
  const iconUrl = getProductIconUrl(product);

  const img = $("modal-img");
  const icon = $("modal-icon");
  if (product.imageUrl) {
    if (img) { img.src = product.imageUrl; img.alt = product.name; img.classList.remove("hidden"); }
    if (icon) icon.innerHTML = "";
  } else {
    if (img) img.classList.add("hidden");
    if (icon) {
      if (iconUrl) {
        icon.innerHTML = `<img src="${escapeAttr(iconUrl)}" alt="" class="product-modal-icon-img" data-fallback="modal-icon" data-fallback-text="${escapeAttr(shortProductName(product))}">`;
      } else {
        icon.innerHTML = `<span class="product-modal-icon-fallback">${escapeHtml(shortProductName(product))}</span>`;
      }
    }
  }

  const badges = [];
  if (product.categoryName) badges.push(`<span class="badge badge-cat">${escapeHtml(product.categoryIcon || "")} ${escapeHtml(product.categoryName)}</span>`);
  if ((product.soldCount || 0) > 5) badges.push(`<span class="badge badge-hot">🔥 Bán chạy</span>`);
  if (!outOfStock) badges.push(`<span class="badge badge-free">✓ Có sẵn</span>`);
  else badges.push(`<span class="badge badge-out">Hết hàng</span>`);
  setHtml("modal-badges", badges.join(""));

  setEl("modal-title", product.name);
  setEl("modal-price", formatProductPrice(product));

  const vipEl = $("modal-vip-price");
  if (vipEl) vipEl.classList.add("hidden");

  setEl("modal-desc", product.description || "Sản phẩm số được giao tự động qua Telegram bot ngay sau khi thanh toán thành công.");
  setEl("modal-note", "Vui lòng liên hệ hỗ trợ qua Telegram nếu sản phẩm gặp vấn đề trong vòng 24 giờ sau khi nhận.");

  const meta = [stockLabel(product)];
  if (product.soldCount) meta.push(`Đã bán: ${product.soldCount}`);
  setEl("modal-meta", meta.join(" · "));

  const addBtn = $("modal-add-btn");
  if (addBtn) addBtn.disabled = outOfStock;

  document.querySelectorAll(".modal-tab").forEach((t, i) => t.classList.toggle("active", i === 0));
  document.querySelectorAll(".modal-tab-content").forEach((c, i) => c.classList.toggle("active", i === 0));

  const modal = $("product-modal");
  if (modal) {
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
  }
}

function closeProductModal() {
  const modal = $("product-modal");
  if (modal) modal.classList.remove("open");
  document.body.style.overflow = "";
}

function switchModalTab(btn, tabName) {
  document.querySelectorAll(".modal-tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".modal-tab-content").forEach((c) => c.classList.remove("active"));
  btn.classList.add("active");
  const content = $(`modal-tab-${tabName}`);
  if (content) content.classList.add("active");
}

function addToCartFromModal() {
  if (!state.selectedProduct) return;
  addToCart(state.selectedProduct.id);
}

function buyNowFromModal() {
  if (!state.selectedProduct) return;
  addToCart(state.selectedProduct.id);
  closeProductModal();
  openCart();
}

// ===== CART =====
function addToCart(productId) {
  const product = findProduct(productId);
  if (!product) return;
  if (!product.inStock) {
    showToast("Sản phẩm này hiện đã hết hàng.");
    return;
  }
  const max = maxQuantity(product);
  const current = state.cart[productId] || 0;
  if (current >= max) {
    showToast(`Bạn chỉ có thể mua tối đa ${max} sản phẩm.`);
    return;
  }
  state.cart[productId] = current + 1;
  saveCart();
  renderCart();
  showToast("Đã thêm vào giỏ hàng.");
}

function updateCartQuantity(productId, delta) {
  const product = findProduct(productId);
  if (!product) { removeFromCart(productId); return; }
  const next = (state.cart[productId] || 0) + delta;
  if (next <= 0) { removeFromCart(productId); return; }
  state.cart[productId] = Math.min(next, maxQuantity(product));
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
  const count = entries.reduce((s, i) => s + i.quantity, 0);
  const subtotal = entries.reduce((s, i) => s + productPriceVnd(i.product) * i.quantity, 0);

  let discount = 0;
  if (state.appliedCoupon) {
    const { type, value } = state.appliedCoupon;
    discount = type === "percent" ? Math.round(subtotal * value / 100) : Math.min(value, subtotal);
  }
  const total = Math.max(0, subtotal - discount);

  ["cart-count", "cart-count-drawer", "cart-count-bottom"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.textContent = count;
    el.classList.toggle("hidden", count === 0);
  });

  const itemsList = $("cart-items-list");
  const footer = $("cart-footer");
  if (!itemsList) return;

  if (!entries.length) {
    itemsList.innerHTML = `
      <div class="cart-empty">
        <div class="cart-empty-icon">🛒</div>
        <p>Giỏ hàng trống</p>
        <button class="btn-outline" data-action="close-cart">Tiếp tục mua sắm</button>
      </div>`;
    if (footer) footer.style.display = "none";
    return;
  }

  if (footer) footer.style.display = "";

  itemsList.innerHTML = entries.map(({ product, quantity }) => {
    const iconUrl = getProductIconUrl(product);
    const thumbImg = product.imageUrl || iconUrl;
    const objectFitClass = product.imageUrl ? "cart-item-icon-thumb-cover" : "cart-item-icon-thumb-contain";
    const thumbInner = thumbImg
      ? `<img src="${escapeAttr(thumbImg)}" alt="" class="cart-item-thumb ${objectFitClass}" data-fallback="hide">`
      : `<span class="cart-item-icon-fallback">${escapeHtml(shortProductName(product))}</span>`;
    return `
      <div class="cart-item">
        <div class="cart-item-icon">${thumbInner}</div>
        <div class="cart-item-info">
          <div class="cart-item-name">${escapeHtml(product.name)}</div>
          <div class="cart-item-price">${formatProductPrice(product)} / sp</div>
          <div class="cart-item-qty">
            <button class="qty-btn" data-action="qty-dec" data-arg="${escapeAttr(product.id)}">−</button>
            <span class="qty-val">${quantity}</span>
            <button class="qty-btn" data-action="qty-inc" data-arg="${escapeAttr(product.id)}">+</button>
            <button class="cart-item-remove" data-action="remove-from-cart" data-arg="${escapeAttr(product.id)}">×</button>
          </div>
        </div>
      </div>`;
  }).join("");

  setEl("cart-subtotal", formatUsdPrimaryFromVnd(subtotal));
  setEl("cart-total", formatUsdPrimaryFromVnd(total));
  setEl("cart-discount", `-${formatUsdPrimaryFromVnd(discount)}`);

  const discountRow = $("discount-row");
  if (discountRow) discountRow.classList.toggle("hidden", discount === 0);
}

async function applyCoupon() {
  const input = $("coupon-input");
  const resultEl = $("coupon-result");
  if (!input || !resultEl) return;

  const code = input.value.trim().toUpperCase();
  if (!code) return;

  const subtotal = cartEntries().reduce((s, i) => s + productPriceVnd(i.product) * i.quantity, 0);

  resultEl.className = "coupon-result";
  resultEl.textContent = "Đang kiểm tra...";
  resultEl.classList.remove("hidden");

  try {
    const res = await fetch(`/api/shop/coupon/${encodeURIComponent(code)}?amount=${subtotal}`);
    const data = await res.json();
    if (!res.ok || data.error) {
      resultEl.classList.add("error");
      resultEl.textContent = data.error || "Mã không hợp lệ.";
      state.appliedCoupon = null;
    } else {
      resultEl.classList.add("success");
      resultEl.textContent = `✓ ${data.message || `Giảm ${formatUsdPrimaryFromVnd(data.discountAmount)}`}`;
      const couponType = String(data.discountType || "").toUpperCase();
      state.appliedCoupon = {
        code,
        type: couponType === "PERCENT" ? "percent" : "amount",
        value: couponType === "PERCENT" ? Number(data.discountValue || 0) : Number(data.discountAmount || 0),
      };
    }
  } catch {
    resultEl.classList.add("error");
    resultEl.textContent = "Lỗi kết nối. Vui lòng thử lại.";
    state.appliedCoupon = null;
  }
  renderCart();
}

function openCart() {
  const drawer = $("cart-drawer");
  const overlay = $("cart-overlay");
  if (drawer) drawer.classList.add("open");
  if (overlay) overlay.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeCart() {
  const drawer = $("cart-drawer");
  const overlay = $("cart-overlay");
  if (drawer) drawer.classList.remove("open");
  if (overlay) overlay.classList.remove("open");
  document.body.style.overflow = "";
}

function handleCheckout() {
  if (!cartEntries().length) {
    showToast("Giỏ hàng đang trống.");
    return;
  }
  openTelegramBot();
}

function openTelegramBot() {
  const s = state.shop || {};
  const target = s.botUsername || s.supportUsername;
  if (!target) {
    showToast("Chưa cấu hình bot Telegram.");
    return;
  }
  const link = `https://t.me/${target}${s.botUsername ? "?start=shop" : ""}`;
  if (window.Telegram?.WebApp?.openTelegramLink) {
    window.Telegram.WebApp.openTelegramLink(link);
    return;
  }
  window.open(link, "_blank", "noopener,noreferrer");
}

// ===== FAQ =====
function toggleFaq(btn) {
  const item = btn.closest(".faq-item");
  if (!item) return;
  const isOpen = item.classList.contains("open");
  document.querySelectorAll(".faq-item.open").forEach((el) => {
    el.classList.remove("open");
    const a = el.querySelector(".faq-a");
    if (a) a.classList.remove("open");
    const icon = el.querySelector(".faq-icon");
    if (icon) icon.textContent = "+";
  });
  if (!isOpen) {
    item.classList.add("open");
    const a = item.querySelector(".faq-a");
    if (a) a.classList.add("open");
    const icon = item.querySelector(".faq-icon");
    if (icon) icon.textContent = "−";
  }
}

// ===== FILTERING & SORTING =====
function getFilteredProducts() {
  const search = state.search.trim().toLocaleLowerCase("vi-VN");
  const min = state.priceMin ? Number(state.priceMin) : null;
  const max = state.priceMax ? Number(state.priceMax) : null;

  let products = state.products.filter((p) => {
    const catMatch = !state.selectedCategory || p.categoryId === state.selectedCategory;
    const searchMatch =
      !search ||
      p.name.toLocaleLowerCase("vi-VN").includes(search) ||
      (p.code || "").toLocaleLowerCase("vi-VN").includes(search) ||
      (p.categoryName || "").toLocaleLowerCase("vi-VN").includes(search);
    const usdPrice = productPriceUsd(p);
    const priceMatch = (min === null || usdPrice >= min) && (max === null || usdPrice <= max);
    return catMatch && searchMatch && priceMatch;
  });

  switch (state.sortBy) {
    case "price_asc":    products.sort((a, b) => productPriceUsd(a) - productPriceUsd(b)); break;
    case "price_desc":   products.sort((a, b) => productPriceUsd(b) - productPriceUsd(a)); break;
    case "newest":       products.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)); break;
    case "bestseller":   products.sort((a, b) => (b.soldCount || 0) - (a.soldCount || 0)); break;
  }

  return products;
}

// ===== CART HELPERS =====
function cartEntries() {
  return Object.entries(state.cart)
    .map(([id, quantity]) => ({ product: findProduct(id), quantity }))
    .filter((i) => i.product && i.quantity > 0);
}

function normalizeCart() {
  const normalized = {};
  for (const [id, qty] of Object.entries(state.cart)) {
    const p = findProduct(id);
    if (!p || !p.inStock) continue;
    normalized[id] = Math.min(Number(qty) || 1, maxQuantity(p));
  }
  state.cart = normalized;
  saveCart();
}

function findProduct(id) {
  return state.products.find((p) => p.id === id);
}

function maxQuantity(product) {
  if (product.deliveryMode === "STOCK_LINES") return Math.max(0, product.stockCount || 0);
  return 99;
}

function stockLabel(product) {
  if (product.deliveryMode !== "STOCK_LINES") return "Giao tự động";
  if (!product.stockCount) return "Hết hàng";
  return `Còn ${product.stockCount}`;
}

// ===== UI HELPERS =====
function showLoading() {
  const grid = $("product-grid");
  if (grid) grid.innerHTML = Array(6).fill(`<div class="product-card skeleton-card"></div>`).join("");
  const empty = $("empty-state");
  if (empty) empty.classList.add("hidden");
  const count = $("products-count");
  if (count) count.textContent = "Đang tải...";
}

function showError() {
  const grid = $("product-grid");
  if (grid) grid.innerHTML = `
    <div class="shop-error">
      <p>Không thể tải sản phẩm. Vui lòng thử lại.</p>
      <button class="btn-outline" data-action="reload-catalog">Thử lại</button>
    </div>`;
  const count = $("products-count");
  if (count) count.textContent = "Lỗi tải dữ liệu";
}

function showToast(message) {
  const area = $("toast-area");
  if (!area) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  area.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    toast.style.transition = ".3s";
    setTimeout(() => toast.remove(), 300);
  }, 2400);
}

function setEl(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function setHtml(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
}

function shortProductName(product) {
  const code = (product.code || "").replace(/[^a-zA-Z0-9]/g, "");
  if (code) return code.slice(0, 5).toUpperCase();
  return product.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function formatVnd(amount) {
  return new Intl.NumberFormat("vi-VN").format(Number(amount || 0)) + "đ";
}

function usdVndRate() {
  const rate = Number(state.shop?.usdVndRate || 26500);
  return Number.isFinite(rate) && rate > 0 ? rate : 26500;
}

function isUsdProduct(product) {
  return ["USD", "USDT"].includes(String(product?.currency || "VND").toUpperCase());
}

function productPriceVnd(product) {
  return isUsdProduct(product)
    ? Math.round(Number(product?.price || 0) * usdVndRate())
    : Math.round(Number(product?.price || 0));
}

function productPriceUsd(product) {
  return isUsdProduct(product)
    ? Number(product?.price || 0)
    : Number(product?.price || 0) / usdVndRate();
}

function formatUsd(amount) {
  return `$${Number(amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatUsdPrimaryFromVnd(amountVnd) {
  return `${formatUsd(Number(amountVnd || 0) / usdVndRate())} (≈ ${formatVnd(amountVnd)})`;
}

function formatProductPrice(product) {
  return `${formatUsd(productPriceUsd(product))} (≈ ${formatVnd(productPriceVnd(product))})`;
}

function loadCart() {
  try { return JSON.parse(localStorage.getItem("shop-cart") || "{}"); }
  catch { return {}; }
}

function saveCart() {
  localStorage.setItem("shop-cart", JSON.stringify(state.cart));
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
  // Escape đầy đủ các ký tự nguy hiểm trong attribute, kể cả khi attribute
  // được wrap bằng dấu nháy đơn ('...') trong template literal.
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replaceAll("`", "&#096;");
}

function debounce(fn, wait = 200) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}


// ============================================================
// EVENT DELEGATION (CSP-friendly, no inline handlers)
// ============================================================

// Map data-action → handler function. Add new actions here.
const SHOP_ACTIONS = {
  "close-announcement": (_, btn) => {
    const bar = btn.closest(".announcement-bar");
    if (bar) bar.style.display = "none";
  },
  "open-cart": () => openCart(),
  "close-cart": () => closeCart(),
  "open-bot": () => openTelegramBot(),
  "scroll-products": () => {
    const el = $("products-section");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  },
  "select-category": (arg) => selectCategory(arg || ""),
  "reset-filters": () => resetFilters(),
  "toggle-filter-sidebar": () => toggleFilterSidebar(),
  "open-product": (arg) => openProductModal(arg),
  "open-product-stop": (arg, _btn, ev) => { ev.stopPropagation(); openProductModal(arg); },
  "add-to-cart": (arg) => addToCart(arg),
  "add-to-cart-stop": (arg, _btn, ev) => { ev.stopPropagation(); addToCart(arg); },
  "qty-dec": (arg) => updateCartQuantity(arg, -1),
  "qty-inc": (arg) => updateCartQuantity(arg, 1),
  "remove-from-cart": (arg) => removeFromCart(arg),
  "apply-coupon": () => applyCoupon(),
  "checkout": () => handleCheckout(),
  "close-modal-on-backdrop": (_, el, ev) => { if (ev.target === el) closeProductModal(); },
  "close-product-modal": () => closeProductModal(),
  "switch-modal-tab": (arg, btn) => switchModalTab(btn, arg),
  "add-to-cart-from-modal": () => addToCartFromModal(),
  "buy-now-from-modal": () => buyNowFromModal(),
  "toggle-faq": (_, btn) => toggleFaq(btn),
  "reload-catalog": () => loadCatalog(),
};

document.addEventListener("click", (ev) => {
  const target = ev.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  const handler = SHOP_ACTIONS[action];
  if (!handler) return;
  const arg = target.dataset.arg ?? "";
  handler(arg, target, ev);
});

// Delegated input handler — for search and filter inputs
document.addEventListener("input", (ev) => {
  const el = ev.target;
  const inputType = el.dataset?.input;
  if (!inputType) return;

  if (inputType === "search") {
    onSearch(el.value);
  } else if (inputType === "price-min" || inputType === "price-max") {
    onPriceFilter();
  } else if (inputType === "coupon") {
    el.value = el.value.toUpperCase();
  }
});

document.addEventListener("change", (ev) => {
  const el = ev.target;
  const inputType = el.dataset?.input;
  if (!inputType) return;

  if (inputType === "sort-desktop") {
    onSortChange();
  } else if (inputType === "sort-mobile") {
    onSortChangeMobile();
  } else if (inputType === "filter-cat") {
    selectCategory(el.value || "");
  }
});

// Image fallback handling — replace failed images via data-fallback
document.addEventListener(
  "error",
  (ev) => {
    const img = ev.target;
    if (!(img instanceof HTMLImageElement)) return;
    const fallback = img.dataset?.fallback;
    if (!fallback) return;

    if (fallback === "hide") {
      img.style.display = "none";
      return;
    }

    if (fallback === "card-img") {
      // Hide failing main image, show icon wrap (next sibling)
      img.style.display = "none";
      const wrap = img.nextElementSibling;
      if (wrap) {
        wrap.hidden = false;
        wrap.style.display = "flex";
      }
      return;
    }

    if (fallback === "card-icon" || fallback === "modal-icon") {
      const text = img.dataset.fallbackText || "";
      const span = document.createElement("span");
      span.className = fallback === "modal-icon" ? "product-modal-icon-fallback" : "product-card-icon-emoji";
      span.textContent = text;
      img.replaceWith(span);
    }
  },
  true,
);

// ============================================================
// 3D ENHANCEMENTS — card tilt, stat counters, scroll reveal
// ============================================================

// --- Animated stat counter helper (called by renderStats) ---
function _animateStatCounters(totalOrders, totalProducts) {
  function countUp(el, to, duration, suffix) {
    if (!el || isNaN(to) || to <= 0) return;
    const start = performance.now();
    (function step(now) {
      const p = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3); // cubic ease-out
      el.textContent = Math.round(to * ease) + suffix;
      if (p < 1) requestAnimationFrame(step);
    })(performance.now());
  }
  countUp($("stat-orders"),   totalOrders,   1800, "+");
  countUp($("stat-products"), totalProducts, 1200, "+");
}

// --- 3D Card Tilt via mouse tracking on the product grid ---
(function initCardTilt() {
  // Use event delegation on document so it works after grid re-renders
  document.addEventListener("mousemove", (e) => {
    const card = e.target.closest && e.target.closest(".product-card");
    if (!card) return;
    const r   = card.getBoundingClientRect();
    const x   = e.clientX - r.left;
    const y   = e.clientY - r.top;
    const cx  = r.width  / 2;
    const cy  = r.height / 2;
    const tiltX = ((y - cy) / cy) * -9;
    const tiltY = ((x - cx) / cx) *  13;
    card.style.setProperty("--tilt-x", tiltX.toFixed(2) + "deg");
    card.style.setProperty("--tilt-y", tiltY.toFixed(2) + "deg");
    card.style.setProperty("--tilt-z", "10px");
    card.style.setProperty("--glow-x", ((x / r.width)  * 100).toFixed(1) + "%");
    card.style.setProperty("--glow-y", ((y / r.height) * 100).toFixed(1) + "%");
    const nx = (x - cx) / cx;
    const ny = (y - cy) / cy;
    card.style.boxShadow = [
      `${(nx * -18).toFixed(1)}px ${(ny * -10).toFixed(1)}px 40px rgba(139,92,246,.3)`,
      `0 24px 64px rgba(0,0,0,.7)`,
      `0 0 0 1px rgba(139,92,246,.28)`,
    ].join(", ");
  });

  // Reset when mouse leaves a card
  document.addEventListener("mouseout", (e) => {
    const card = e.target.closest && e.target.closest(".product-card");
    if (!card) return;
    // only reset when truly leaving the card (not entering a child)
    if (card.contains(e.relatedTarget)) return;
    card.style.setProperty("--tilt-x", "0deg");
    card.style.setProperty("--tilt-y", "0deg");
    card.style.setProperty("--tilt-z", "0px");
    card.style.boxShadow = "";
  });
})();

// --- 3D Scroll reveal (multi-variant, staggered) ---
(function initScrollReveal() {
  if (!("IntersectionObserver" in window)) return;

  const io = new IntersectionObserver((entries) => {
    entries.forEach(({ target, isIntersecting }) => {
      if (!isIntersecting) return;
      const delay = parseInt(target.dataset.revealDelay || "0");
      const reveal = () => target.classList.add("revealed");
      delay > 0 ? setTimeout(reveal, delay) : reveal();
      io.unobserve(target);
    });
  }, { threshold: 0.05, rootMargin: "0px 0px -24px 0px" });

  function getVariant(el, idx) {
    if (el.matches(".product-card, .showcase-card")) return "reveal-zoom";
    if (el.matches(".section-title"))               return "reveal-title";
    if (el.matches(".cat-chip"))                    return "reveal-fast";
    if (el.matches(".stat-item"))  return idx % 2 === 0 ? "reveal-left" : "reveal-right";
    if (el.matches(".faq-item"))   return idx % 2 === 0 ? "reveal-left" : "reveal-right";
    // trust-card handled by CSS override (blur only, animation paused)
    return "";
  }

  function getDelay(el, idx) {
    if (el.matches(".product-card"))   return idx * 55;
    if (el.matches(".cat-chip"))       return idx * 35;
    if (el.matches(".trust-card"))     return idx * 125;
    if (el.matches(".showcase-card"))  return idx * 140;
    if (el.matches(".stat-item"))      return idx * 95;
    if (el.matches(".faq-item"))       return idx * 70;
    return idx * 70;
  }

  const SELECTORS = [
    ".trust-card", ".stat-item", ".showcase-card",
    ".faq-item", ".product-card", ".section-title", ".cat-chip",
  ];

  function observeRevealTargets() {
    const groups = new Map();
    SELECTORS.forEach((sel) => {
      document.querySelectorAll(sel + ":not(.reveal-ready)").forEach((el) => {
        const p = el.parentElement;
        if (!groups.has(p)) groups.set(p, []);
        groups.get(p).push(el);
      });
    });
    groups.forEach((els) => {
      els.forEach((el, i) => {
        const v = getVariant(el, i);
        if (v) el.classList.add(v);
        el.dataset.revealDelay = String(getDelay(el, i));
        el.classList.add("reveal-ready");
        io.observe(el);
      });
    });
  }

  observeRevealTargets();
  document.addEventListener("shopCatalogLoaded", observeRevealTargets);
})();

// ============================================================
// HERO CANVAS — warp-speed starfield (fallback when Three.js absent)
// ============================================================
(function initHeroCanvas() {
  if (typeof THREE !== "undefined") return; // Three.js handles the canvas
  const canvas = document.getElementById("hero-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H, stars, raf;
  const COUNT = 220;
  const SPEED = 3.5;
  const COLORS = [
    [167, 139, 250],  // violet-400
    [216, 180, 254],  // violet-300
    [232, 121, 249],  // fuchsia-400
    [255, 255, 255],  // white
    [129, 140, 248],  // indigo-400
  ];

  function mkStar() {
    const c = COLORS[Math.floor(Math.random() * COLORS.length)];
    return {
      x: (Math.random() - 0.5) * 2,   // normalized -1..1
      y: (Math.random() - 0.5) * 2,
      z: Math.random(),                // 0..1 (depth)
      pz: 0,
      color: c,
      size: Math.random() * 1.4 + 0.3,
    };
  }

  function resize() {
    const section = canvas.closest(".hero") || canvas.parentElement;
    W = canvas.width  = section.offsetWidth;
    H = canvas.height = section.offsetHeight;
  }

  function init() {
    resize();
    stars = Array.from({ length: COUNT }, mkStar);
    stars.forEach((s) => { s.pz = s.z; });
  }

  function project(x, y, z) {
    return {
      sx: (x / z) * W * 0.5 + W * 0.5,
      sy: (y / z) * H * 0.5 + H * 0.5,
    };
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const dt = SPEED / W;

    for (const s of stars) {
      s.pz = s.z;
      s.z -= dt;

      if (s.z <= 0.001) {
        s.x  = (Math.random() - 0.5) * 2;
        s.y  = (Math.random() - 0.5) * 2;
        s.z  = 1;
        s.pz = 1;
        continue;
      }

      const cur  = project(s.x, s.y, s.z);
      const prev = project(s.x, s.y, s.pz);

      // Skip if outside canvas
      if (cur.sx < -10 || cur.sx > W + 10 || cur.sy < -10 || cur.sy > H + 10) continue;

      const opacity  = Math.min(1, (1 - s.z) * 1.3);
      const lineSize = Math.max(0.3, s.size * (1 - s.z) * 2);
      const [r, g, b] = s.color;

      ctx.strokeStyle = `rgba(${r},${g},${b},${opacity * 0.8})`;
      ctx.lineWidth   = lineSize;
      ctx.beginPath();
      ctx.moveTo(prev.sx, prev.sy);
      ctx.lineTo(cur.sx,  cur.sy);
      ctx.stroke();
    }

    raf = requestAnimationFrame(draw);
  }

  init();
  draw();

  window.addEventListener("resize", () => { cancelAnimationFrame(raf); init(); draw(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else { raf = requestAnimationFrame(draw); }
  });
})();

// ============================================================
// THREE.JS WEBGL HERO — metallic torus knot + orbiting lights
// ============================================================
(function initThreeJS() {
  if (typeof THREE === "undefined") return;
  if (window.innerWidth <= 900) return;

  const canvas = document.getElementById("hero-canvas");
  if (!canvas) return;
  const hero = canvas.closest(".hero") || canvas.parentElement;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.5;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 80);
  camera.position.set(0, 0, 7);

  function resize() {
    const w = hero.offsetWidth;
    const h = hero.offsetHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // ── Torus knot — star of the show ──
  const knot = new THREE.Mesh(
    new THREE.TorusKnotGeometry(1.8, 0.5, 200, 32, 2, 3),
    new THREE.MeshStandardMaterial({
      color: 0x8b5cf6,
      emissive: 0x3b0764,
      emissiveIntensity: 0.8,
      metalness: 0.95,
      roughness: 0.08,
    })
  );
  scene.add(knot);

  // ── Lights ──
  scene.add(new THREE.AmbientLight(0x6d28d9, 0.6));
  const orbitLights = [
    [0xa78bfa, 6.0, 0,    0.80],
    [0xf0abfc, 5.0, 2.09, 1.20],
    [0x818cf8, 5.5, 4.19, 0.55],
  ].map(([color, intensity, phase, speed]) => {
    const l = new THREE.PointLight(color, intensity, 15);
    scene.add(l);
    return { l, phase, speed };
  });

  // ── Particles ──
  function mkPts(count, spread, size, color, opacity) {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = spread * 0.35 + Math.random() * spread;
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color, size, sizeAttenuation: true,
      transparent: true, opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    return new THREE.Points(geo, mat);
  }
  scene.add(mkPts(1400, 20, 0.05, 0xc4b5fd, 0.50));
  scene.add(mkPts(700,  9,  0.03, 0xf0abfc, 0.65));

  // ── Mouse parallax ──
  let mx = 0, my = 0, cx = 0, cy = 0;
  document.addEventListener("mousemove", (e) => {
    mx = e.clientX / window.innerWidth  - 0.5;
    my = e.clientY / window.innerHeight - 0.5;
  });

  // Fade the canvas in elegantly
  canvas.style.opacity = "0";
  canvas.style.transition = "opacity 1.6s ease";
  requestAnimationFrame(() => requestAnimationFrame(() => { canvas.style.opacity = "0.88"; }));

  let t = 0, raf;
  function frame() {
    raf = requestAnimationFrame(frame);
    t += 0.007;

    knot.rotation.x = t * 0.35;
    knot.rotation.y = t * 0.55;
    knot.rotation.z = t * 0.12;

    orbitLights.forEach(({ l, phase, speed }) => {
      const a = t * speed + phase;
      l.position.set(
        Math.cos(a) * 6,
        Math.sin(a * 0.65) * 4,
        Math.sin(a) * 5.5,
      );
    });

    cx += (mx * 2.0 - cx) * 0.055;
    cy += (-my * 1.2 - cy) * 0.055;
    camera.position.x = cx;
    camera.position.y = cy;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  }

  resize();
  frame();

  window.addEventListener("resize", () => {
    resize();
    if (window.innerWidth <= 900) {
      cancelAnimationFrame(raf);
      canvas.style.opacity = "0.65";
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else frame();
  });
})();
