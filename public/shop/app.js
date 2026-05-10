const ICON_CDN = "https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons";

const ICON_MAP = [
  { k: ["netflix"],                           s: "netflix" },
  { k: ["spotify"],                           s: "spotify" },
  { k: ["youtube", "yt premium"],             s: "youtube" },
  { k: ["twitch"],                            s: "twitch" },
  { k: ["disney"],                            s: "disney-plus" },
  { k: ["amazon prime", "prime video"],       s: "amazon-prime" },
  { k: ["hbo"],                               s: "hbo" },
  { k: ["crunchyroll"],                       s: "crunchyroll" },
  { k: ["discord"],                           s: "discord" },
  { k: ["telegram"],                          s: "telegram" },
  { k: ["instagram"],                         s: "instagram" },
  { k: ["facebook"],                          s: "facebook" },
  { k: ["twitter", "x.com"],                  s: "twitter" },
  { k: ["tiktok"],                            s: "tiktok" },
  { k: ["whatsapp"],                          s: "whatsapp" },
  { k: ["reddit"],                            s: "reddit" },
  { k: ["linkedin"],                          s: "linkedin" },
  { k: ["pinterest"],                         s: "pinterest" },
  { k: ["snapchat"],                          s: "snapchat" },
  { k: ["github"],                            s: "github" },
  { k: ["microsoft office", "ms office", "office 365", "microsoft 365", "o365", "m365"], s: "microsoft-office" },
  { k: ["windows"],                           s: "windows" },
  { k: ["microsoft"],                         s: "microsoft" },
  { k: ["adobe photoshop", "photoshop"],      s: "adobe-photoshop" },
  { k: ["adobe premiere", "premiere pro"],    s: "adobe-premiere-pro" },
  { k: ["adobe illustrator", "illustrator"],  s: "adobe-illustrator" },
  { k: ["adobe lightroom", "lightroom"],      s: "adobe-lightroom" },
  { k: ["adobe after effects", "after effects"], s: "adobe-after-effects" },
  { k: ["adobe"],                             s: "adobe" },
  { k: ["chatgpt", "chat gpt", "openai"],     s: "openai" },
  { k: ["midjourney"],                        s: "midjourney" },
  { k: ["canva"],                             s: "canva" },
  { k: ["figma"],                             s: "figma" },
  { k: ["notion"],                            s: "notion" },
  { k: ["slack"],                             s: "slack" },
  { k: ["zoom"],                              s: "zoom" },
  { k: ["dropbox"],                           s: "dropbox" },
  { k: ["grammarly"],                         s: "grammarly" },
  { k: ["nordvpn", "nord vpn"],               s: "nordvpn" },
  { k: ["expressvpn", "express vpn"],         s: "expressvpn" },
  { k: ["surfshark"],                         s: "surfshark" },
  { k: ["steam"],                             s: "steam" },
  { k: ["playstation", "ps plus", "ps4", "ps5", "psn"], s: "playstation" },
  { k: ["xbox"],                              s: "xbox" },
  { k: ["minecraft"],                         s: "minecraft" },
  { k: ["roblox"],                            s: "roblox" },
  { k: ["valorant"],                          s: "valorant" },
  { k: ["pubg"],                              s: "pubg" },
  { k: ["bitcoin", "btc"],                    s: "bitcoin" },
  { k: ["ethereum", "eth"],                   s: "ethereum" },
  { k: ["binance", "bnb"],                    s: "binance" },
  { k: ["gmail", "google mail"],              s: "gmail" },
  { k: ["google"],                            s: "google" },
  { k: ["apple"],                             s: "apple" },
  { k: ["amazon"],                            s: "amazon" },
  { k: ["paypal"],                            s: "paypal" },
  { k: ["shopify"],                           s: "shopify" },
  { k: ["wordpress"],                         s: "wordpress" },
  { k: ["docker"],                            s: "docker" },
  { k: ["vercel"],                            s: "vercel" },
];

function getProductIconUrl(product) {
  const haystack = `${product.name} ${product.code} ${product.categoryName}`.toLowerCase();
  for (const { k, s } of ICON_MAP) {
    if (k.some((kw) => haystack.includes(kw))) {
      return `${ICON_CDN}/${s}/default.svg`;
    }
  }
  return null;
}

const state = {
  shop: null,
  categories: [],
  products: [],
  cart: loadCart(),
  selectedCategory: "all",
  search: "",
  selectedProduct: null,
};

const els = {
  shopName: document.querySelector("#shopName"),
  bankName: document.querySelector("#bankName"),
  supportName: document.querySelector("#supportName"),
  desktopSearch: document.querySelector("#desktopSearchInput"),
  mobileSearch: document.querySelector("#mobileSearchInput"),
  categoryTabs: document.querySelector("#categoryTabs"),
  resultCount: document.querySelector("#resultCount"),
  productGrid: document.querySelector("#productGrid"),
  loadingState: document.querySelector("#loadingState"),
  errorState: document.querySelector("#errorState"),
  emptyState: document.querySelector("#emptyState"),
  retryButton: document.querySelector("#retryButton"),
  cartButton: document.querySelector("#cartButton"),
  heroCartButton: document.querySelector("#heroCartButton"),
  bottomCartButton: document.querySelector("#bottomCartButton"),
  bottomCheckoutButton: document.querySelector("#bottomCheckoutButton"),
  cartDrawer: document.querySelector("#cartDrawer"),
  drawerBackdrop: document.querySelector("#drawerBackdrop"),
  closeCartButton: document.querySelector("#closeCartButton"),
  cartItems: document.querySelector("#cartItems"),
  cartCount: document.querySelector("#cartCount"),
  bottomCartCount: document.querySelector("#bottomCartCount"),
  drawerTitle: document.querySelector("#drawerTitle"),
  cartSubtotal: document.querySelector("#cartSubtotal"),
  cartTotal: document.querySelector("#cartTotal"),
  checkoutButton: document.querySelector("#checkoutButton"),
  checkoutNote: document.querySelector("#checkoutNote"),
  ordersButton: document.querySelector("#ordersButton"),
  toast: document.querySelector("#toast"),
  modal: document.querySelector("#productModal"),
  closeModalButton: document.querySelector("#closeModalButton"),
  modalVisual: document.querySelector("#modalVisual"),
  modalCategory: document.querySelector("#modalCategory"),
  modalName: document.querySelector("#modalName"),
  modalDescription: document.querySelector("#modalDescription"),
  modalPrice: document.querySelector("#modalPrice"),
  modalStock: document.querySelector("#modalStock"),
  modalAddButton: document.querySelector("#modalAddButton"),
  modalBuyButton: document.querySelector("#modalBuyButton"),
};

init();

async function init() {
  bindEvents();
  renderCart();
  await loadCatalog();
}

function bindEvents() {
  els.retryButton.addEventListener("click", loadCatalog);
  els.desktopSearch.addEventListener("input", onSearch);
  els.mobileSearch.addEventListener("input", onSearch);
  els.categoryTabs.addEventListener("click", onCategoryClick);
  els.productGrid.addEventListener("click", onProductClick);

  [els.cartButton, els.heroCartButton, els.bottomCartButton].forEach((button) => {
    button.addEventListener("click", openCart);
  });

  els.bottomCheckoutButton.addEventListener("click", () => {
    openCart();
    handleCheckout();
  });
  els.closeCartButton.addEventListener("click", closeCart);
  els.drawerBackdrop.addEventListener("click", closeCart);
  els.cartItems.addEventListener("click", onCartClick);
  els.checkoutButton.addEventListener("click", handleCheckout);
  els.ordersButton.addEventListener("click", openTelegramBot);
  els.closeModalButton.addEventListener("click", () => els.modal.close());
  els.modalAddButton.addEventListener("click", () => {
    if (!state.selectedProduct) return;
    addToCart(state.selectedProduct.id);
  });
  els.modalBuyButton.addEventListener("click", () => {
    if (!state.selectedProduct) return;
    addToCart(state.selectedProduct.id);
    els.modal.close();
    openCart();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeCart();
    }
  });
}

async function loadCatalog() {
  showLoading();

  try {
    const response = await fetch("/api/shop/catalog", {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error("Catalog request failed");
    }

    const data = await response.json();
    state.shop = data.shop;
    state.categories = data.categories || [];
    state.products = data.products || [];

    normalizeCart();
    renderShopMeta();
    renderCategories();
    renderProducts();
    renderCart();
  } catch (error) {
    console.error(error);
    showError();
  }
}

function renderShopMeta() {
  const shopName = state.shop?.name || "Shop Bot Tele";
  els.shopName.textContent = shopName;
  document.title = shopName;
  els.bankName.textContent = state.shop?.bank?.name || "MB Bank";
  els.supportName.textContent = state.shop?.supportUsername
    ? `@${state.shop.supportUsername}`
    : "Hỗ trợ nhanh";
}

function renderCategories() {
  const allCount = state.products.length;
  const tabs = [
    categoryButton({ id: "all", name: "Tất cả", icon: "", productCount: allCount }),
    ...state.categories.map(categoryButton),
  ];

  els.categoryTabs.innerHTML = tabs.join("");
}

function categoryButton(category) {
  const active = state.selectedCategory === category.id ? " active" : "";
  return `
    <button class="category-tab${active}" type="button" data-category="${escapeAttr(category.id)}">
      ${category.icon ? `<span>${escapeHtml(category.icon)}</span>` : ""}
      <span>${escapeHtml(category.name)}</span>
      <small>${category.productCount}</small>
    </button>
  `;
}

function renderProducts() {
  const products = getFilteredProducts();

  els.loadingState.classList.add("hidden");
  els.errorState.classList.add("hidden");

  if (!products.length) {
    els.productGrid.innerHTML = "";
    const hasSearch = state.search.trim().length > 0;
    els.emptyState.querySelector("strong").textContent = hasSearch
      ? "Không tìm thấy sản phẩm"
      : "Chưa có sản phẩm";
    els.emptyState.querySelector("p").textContent = hasSearch
      ? "Thử đổi từ khóa hoặc chọn danh mục khác."
      : "Shop chưa có sản phẩm khả dụng trong danh mục này.";
    els.emptyState.classList.remove("hidden");
  } else {
    els.emptyState.classList.add("hidden");
    els.productGrid.innerHTML = products.map(productCard).join("");
  }

  els.resultCount.textContent = `${products.length} sản phẩm`;
}

function productCard(product) {
  const outOfStock = !product.inStock;
  const description = product.description || "Sản phẩm số giao nhanh qua bot sau khi thanh toán.";
  const stockText = stockLabel(product);
  const iconUrl = getProductIconUrl(product);

  return `
    <article class="product-card" data-product="${escapeAttr(product.id)}">
      <div class="product-visual">
        <div class="badge-row">
          <span class="badge">${escapeHtml(product.categoryIcon || product.categoryName || "SP")}</span>
          <span class="badge ${outOfStock ? "danger" : "success-badge"}">${outOfStock ? "Hết hàng" : "Có sẵn"}</span>
        </div>
        ${iconUrl
          ? `<img class="product-icon" src="${escapeAttr(iconUrl)}" alt="${escapeAttr(product.name)}"
              onload="this.closest('.product-visual').classList.add('has-icon')"
              onerror="this.remove()">`
          : ""}
        <span class="product-initial">${escapeHtml(shortProductName(product))}</span>
      </div>
      <div class="product-body">
        <span class="product-category">${escapeHtml(product.categoryName)}</span>
        <h2 class="product-title">${escapeHtml(product.name)}</h2>
        <p class="product-description">${escapeHtml(description)}</p>
        <div class="price-row">
          <strong class="price">${formatVnd(product.price)}</strong>
          <span class="stock-label ${outOfStock ? "out" : ""}">${stockText}</span>
        </div>
      </div>
      <div class="card-actions">
        <button class="secondary-button" type="button" data-action="detail" data-id="${escapeAttr(product.id)}">Chi tiết</button>
        <button class="primary-button" type="button" data-action="add" data-id="${escapeAttr(product.id)}" ${outOfStock ? "disabled" : ""}>
          ${outOfStock ? "Hết hàng" : "Thêm vào giỏ"}
        </button>
      </div>
    </article>
  `;
}

function renderCart() {
  const entries = cartEntries();
  const count = entries.reduce((sum, item) => sum + item.quantity, 0);
  const total = entries.reduce((sum, item) => sum + item.product.price * item.quantity, 0);

  els.cartCount.textContent = count;
  els.bottomCartCount.textContent = count;
  els.drawerTitle.textContent = `${count} sản phẩm`;
  els.cartSubtotal.textContent = formatVnd(total);
  els.cartTotal.textContent = formatVnd(total);

  if (!entries.length) {
    els.cartItems.innerHTML = `
      <div class="state-panel">
        <strong>Giỏ hàng trống</strong>
        <p>Chọn sản phẩm bạn muốn mua, giỏ hàng sẽ lưu tạm trên thiết bị này.</p>
      </div>
    `;
    els.checkoutButton.disabled = true;
    return;
  }

  els.checkoutButton.disabled = false;
  els.cartItems.innerHTML = entries.map(({ product, quantity }) => {
    const thumbIcon = getProductIconUrl(product);
    const thumbInner = thumbIcon
      ? `<img class="cart-thumb-icon" src="${escapeAttr(thumbIcon)}" alt="${escapeAttr(product.name)}"
            onload="this.closest('.cart-thumb').classList.add('has-icon')"
            onerror="this.remove()">
         <span class="cart-thumb-fallback">${escapeHtml(shortProductName(product))}</span>`
      : escapeHtml(shortProductName(product));
    return `
    <div class="cart-item" data-id="${escapeAttr(product.id)}">
      <div class="cart-thumb">${thumbInner}</div>
      <div class="cart-info">
        <strong>${escapeHtml(product.name)}</strong>
        <small>${formatVnd(product.price)} / sản phẩm</small>
        <div class="cart-controls">
          <div class="quantity-control" aria-label="Số lượng">
            <button type="button" data-cart-action="decrease" data-id="${escapeAttr(product.id)}">-</button>
            <span>${quantity}</span>
            <button type="button" data-cart-action="increase" data-id="${escapeAttr(product.id)}">+</button>
          </div>
          <button class="remove-button" type="button" data-cart-action="remove" data-id="${escapeAttr(product.id)}">Xóa</button>
        </div>
      </div>
    </div>
  `;
  }).join("");
}

function onSearch(event) {
  state.search = event.target.value;
  if (event.target === els.desktopSearch) {
    els.mobileSearch.value = state.search;
  } else {
    els.desktopSearch.value = state.search;
  }
  renderProducts();
}

function onCategoryClick(event) {
  const button = event.target.closest("[data-category]");
  if (!button) return;

  state.selectedCategory = button.dataset.category;
  renderCategories();
  renderProducts();
}

function onProductClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const product = findProduct(button.dataset.id);
  if (!product) return;

  if (button.dataset.action === "add") {
    addToCart(product.id);
  }

  if (button.dataset.action === "detail") {
    openProductModal(product);
  }
}

function onCartClick(event) {
  const button = event.target.closest("[data-cart-action]");
  if (!button) return;

  const id = button.dataset.id;
  const action = button.dataset.cartAction;

  if (action === "increase") updateCartQuantity(id, 1);
  if (action === "decrease") updateCartQuantity(id, -1);
  if (action === "remove") removeFromCart(id);
}

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
    showToast(`Bạn chỉ có thể mua tối đa ${max} sản phẩm hiện có.`);
    return;
  }

  state.cart[productId] = current + 1;
  saveCart();
  renderCart();
  showToast("Đã thêm vào giỏ hàng.");
}

function updateCartQuantity(productId, delta) {
  const product = findProduct(productId);
  if (!product) {
    removeFromCart(productId);
    return;
  }

  const next = (state.cart[productId] || 0) + delta;

  if (next <= 0) {
    removeFromCart(productId);
    return;
  }

  const max = maxQuantity(product);
  state.cart[productId] = Math.min(next, max);
  saveCart();
  renderCart();
}

function removeFromCart(productId) {
  delete state.cart[productId];
  saveCart();
  renderCart();
}

function openProductModal(product) {
  state.selectedProduct = product;
  const outOfStock = !product.inStock;

  const iconUrl = getProductIconUrl(product);
  els.modalVisual.className = "modal-visual";
  els.modalVisual.innerHTML = `
    <div class="badge-row">
      <span class="badge">${escapeHtml(product.categoryIcon || product.categoryName || "SP")}</span>
      <span class="badge ${outOfStock ? "danger" : "success-badge"}">${outOfStock ? "Hết hàng" : "Có sẵn"}</span>
    </div>
    ${iconUrl
      ? `<img class="product-icon" src="${escapeAttr(iconUrl)}" alt="${escapeAttr(product.name)}"
            onload="this.closest('.modal-visual').classList.add('has-icon')"
            onerror="this.remove()">`
      : ""}
    <span class="product-initial">${escapeHtml(shortProductName(product))}</span>
  `;
  els.modalCategory.textContent = product.categoryName;
  els.modalName.textContent = product.name;
  els.modalDescription.textContent = product.description || "Sản phẩm số được giao qua bot sau khi thanh toán thành công.";
  els.modalPrice.textContent = formatVnd(product.price);
  els.modalStock.textContent = stockLabel(product);
  els.modalStock.classList.toggle("out", outOfStock);
  els.modalAddButton.disabled = outOfStock;
  els.modalBuyButton.disabled = outOfStock;

  if (typeof els.modal.showModal === "function") {
    els.modal.showModal();
  } else {
    showToast(`${product.name} - ${formatVnd(product.price)}`);
  }
}

function openCart() {
  els.cartDrawer.classList.remove("hidden");
  els.drawerBackdrop.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeCart() {
  els.cartDrawer.classList.add("hidden");
  els.drawerBackdrop.classList.add("hidden");
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
  const botUsername = state.shop?.botUsername;
  const supportUsername = state.shop?.supportUsername;
  const target = botUsername || supportUsername;

  if (!target) {
    showToast("Chưa cấu hình bot Telegram để tiếp tục thanh toán.");
    return;
  }

  const link = `https://t.me/${target}${botUsername ? "?start=shop" : ""}`;

  if (window.Telegram?.WebApp?.openTelegramLink) {
    window.Telegram.WebApp.openTelegramLink(link);
    return;
  }

  window.open(link, "_blank", "noopener,noreferrer");
}

function getFilteredProducts() {
  const search = state.search.trim().toLocaleLowerCase("vi-VN");

  return state.products.filter((product) => {
    const categoryMatch = state.selectedCategory === "all" || product.categoryId === state.selectedCategory;
    const searchMatch = !search
      || product.name.toLocaleLowerCase("vi-VN").includes(search)
      || product.code.toLocaleLowerCase("vi-VN").includes(search)
      || product.categoryName.toLocaleLowerCase("vi-VN").includes(search);

    return categoryMatch && searchMatch;
  });
}

function cartEntries() {
  return Object.entries(state.cart)
    .map(([id, quantity]) => ({ product: findProduct(id), quantity }))
    .filter((item) => item.product && item.quantity > 0);
}

function normalizeCart() {
  const normalized = {};

  for (const [id, quantity] of Object.entries(state.cart)) {
    const product = findProduct(id);
    if (!product || !product.inStock) continue;
    normalized[id] = Math.min(Number(quantity) || 1, maxQuantity(product));
  }

  state.cart = normalized;
  saveCart();
}

function findProduct(id) {
  return state.products.find((product) => product.id === id);
}

function maxQuantity(product) {
  if (product.deliveryMode === "STOCK_LINES") {
    return Math.max(0, product.stockCount || 0);
  }
  return 99;
}

function stockLabel(product) {
  if (product.deliveryMode !== "STOCK_LINES") return "Giao tự động";
  if (!product.stockCount) return "Hết hàng";
  return `Còn ${product.stockCount}`;
}

function shortProductName(product) {
  const code = (product.code || "").replace(/[^a-zA-Z0-9]/g, "");
  if (code) return code.slice(0, 5).toUpperCase();
  return product.name.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

function showLoading() {
  els.loadingState.classList.remove("hidden");
  els.errorState.classList.add("hidden");
  els.emptyState.classList.add("hidden");
  els.productGrid.innerHTML = "";
  els.resultCount.textContent = "Đang tải...";
}

function showError() {
  els.loadingState.classList.add("hidden");
  els.emptyState.classList.add("hidden");
  els.errorState.classList.remove("hidden");
  els.resultCount.textContent = "Lỗi tải dữ liệu";
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    els.toast.classList.add("hidden");
  }, 2400);
}

function formatVnd(amount) {
  return new Intl.NumberFormat("vi-VN").format(Number(amount || 0)) + "đ";
}

function loadCart() {
  try {
    return JSON.parse(localStorage.getItem("shop-cart") || "{}");
  } catch {
    return {};
  }
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
