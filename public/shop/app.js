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
    renderCategories();
    renderProducts();
    renderCart();
  } catch (e) {
    console.error(e);
    showError();
  }
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
    const parts = [s.bank.name, s.bank.accountNumber].filter(Boolean);
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
  return `<button class="cat-chip${active ? " active" : ""}" onclick="selectCategory('${escapeAttr(id)}')">${escapeHtml(label)}</button>`;
}

function filterCatOption(id, label, selected) {
  return `<label class="filter-option${selected ? " selected" : ""}">
    <input type="radio" name="cat" value="${escapeAttr(id)}" ${selected ? "checked" : ""} onchange="selectCategory('${escapeAttr(id)}')">
    ${escapeHtml(label)}
  </label>`;
}

function selectCategory(id) {
  state.selectedCategory = id;
  renderCategories();
  renderProducts();
}

// ===== SEARCH & FILTERS =====
function onSearch(value) {
  state.search = value;
  const d = $("search-desktop");
  const m = $("search-mobile");
  if (d && d.value !== value) d.value = value;
  if (m && m.value !== value) m.value = value;
  renderProducts();
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
    mediaContent = `<img class="product-card-img" src="${escapeAttr(product.imageUrl)}" alt="${escapeAttr(product.name)}" loading="lazy"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <div class="product-card-icon-wrap" style="display:none">
        ${iconUrl ? `<img class="product-card-icon-img" src="${escapeAttr(iconUrl)}" alt="" onerror="this.outerHTML='<span class=product-card-icon-emoji>${escapeHtml(shortProductName(product))}</span>'">` : `<span class="product-card-icon-emoji">${escapeHtml(shortProductName(product))}</span>`}
      </div>`;
  } else if (iconUrl) {
    mediaContent = `<img class="product-card-icon-img" src="${escapeAttr(iconUrl)}" alt="${escapeAttr(product.name)}"
        onerror="this.outerHTML='<span class=product-card-icon-emoji>${escapeHtml(shortProductName(product))}</span>'">`;
  } else {
    mediaContent = `<span class="product-card-icon-emoji">${escapeHtml(shortProductName(product))}</span>`;
  }

  return `
    <article class="product-card${outOfStock ? " out-of-stock" : ""}" style="cursor:pointer" onclick="openProductModal('${escapeAttr(product.id)}')">
      <div class="product-card-media">
        ${mediaContent}
        ${badges.length ? `<div class="product-card-badges">${badges.join("")}</div>` : ""}
      </div>
      <div class="product-card-body">
        <p class="product-card-cat">${escapeHtml(product.categoryIcon || "")} ${escapeHtml(product.categoryName || "")}</p>
        <h3 class="product-card-name">${escapeHtml(product.name)}</h3>
        <p class="product-card-desc">${escapeHtml(description)}</p>
        <div class="product-card-price-row">
          <strong class="product-card-price">${formatVnd(product.price)}</strong>
          ${product.soldCount ? `<span class="product-sold">Đã bán: ${product.soldCount}</span>` : ""}
        </div>
        <div class="product-card-actions">
          <button class="btn-detail" onclick="event.stopPropagation();openProductModal('${escapeAttr(product.id)}')">Chi tiết</button>
          <button class="btn-add" onclick="event.stopPropagation();addToCart('${escapeAttr(product.id)}')" ${outOfStock ? "disabled" : ""}>
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
        icon.innerHTML = `<img src="${escapeAttr(iconUrl)}" alt="" style="width:80px;height:80px;object-fit:contain"
            onerror="this.outerHTML='<span style=font-size:64px>${escapeHtml(shortProductName(product))}</span>'">`;
      } else {
        icon.innerHTML = `<span style="font-size:64px;font-weight:700;color:#2563eb">${escapeHtml(shortProductName(product))}</span>`;
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
  setEl("modal-price", formatVnd(product.price));

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
  const subtotal = entries.reduce((s, i) => s + i.product.price * i.quantity, 0);

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
        <button class="btn-outline" onclick="closeCart()">Tiếp tục mua sắm</button>
      </div>`;
    if (footer) footer.style.display = "none";
    return;
  }

  if (footer) footer.style.display = "";

  itemsList.innerHTML = entries.map(({ product, quantity }) => {
    const iconUrl = getProductIconUrl(product);
    const thumbImg = product.imageUrl || iconUrl;
    const thumbInner = thumbImg
      ? `<img src="${escapeAttr(thumbImg)}" alt="" style="width:100%;height:100%;object-fit:${product.imageUrl ? "cover" : "contain"};border-radius:10px"
            onerror="this.style.display='none'">`
      : `<span style="font-size:18px;font-weight:700;color:#2563eb">${escapeHtml(shortProductName(product))}</span>`;
    return `
      <div class="cart-item">
        <div class="cart-item-icon">${thumbInner}</div>
        <div class="cart-item-info">
          <div class="cart-item-name">${escapeHtml(product.name)}</div>
          <div class="cart-item-price">${formatVnd(product.price)} / sp</div>
          <div class="cart-item-qty">
            <button class="qty-btn" onclick="updateCartQuantity('${escapeAttr(product.id)}',-1)">−</button>
            <span class="qty-val">${quantity}</span>
            <button class="qty-btn" onclick="updateCartQuantity('${escapeAttr(product.id)}',1)">+</button>
            <button class="cart-item-remove" onclick="removeFromCart('${escapeAttr(product.id)}')">×</button>
          </div>
        </div>
      </div>`;
  }).join("");

  setEl("cart-subtotal", formatVnd(subtotal));
  setEl("cart-total", formatVnd(total));
  setEl("cart-discount", `-${formatVnd(discount)}`);

  const discountRow = $("discount-row");
  if (discountRow) discountRow.classList.toggle("hidden", discount === 0);
}

async function applyCoupon() {
  const input = $("coupon-input");
  const resultEl = $("coupon-result");
  if (!input || !resultEl) return;

  const code = input.value.trim().toUpperCase();
  if (!code) return;

  const subtotal = cartEntries().reduce((s, i) => s + i.product.price * i.quantity, 0);

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
      resultEl.textContent = `✓ ${data.message || `Giảm ${formatVnd(data.discountAmount)}`}`;
      state.appliedCoupon = {
        code,
        type: data.discountType === "percent" ? "percent" : "amount",
        value: data.discountType === "percent" ? data.discountPercent : data.discountAmount,
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
    const priceMatch = (min === null || p.price >= min) && (max === null || p.price <= max);
    return catMatch && searchMatch && priceMatch;
  });

  switch (state.sortBy) {
    case "price_asc":    products.sort((a, b) => a.price - b.price); break;
    case "price_desc":   products.sort((a, b) => b.price - a.price); break;
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
    <div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:#64748b">
      <p style="margin-bottom:16px">Không thể tải sản phẩm. Vui lòng thử lại.</p>
      <button class="btn-outline" onclick="loadCatalog()">Thử lại</button>
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
  return escapeHtml(value);
}
