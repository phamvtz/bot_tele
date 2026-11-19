const ICON_CDN = "https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons";

const ICON_MAP = [
  { k: ["chatgpt", "chat gpt", "openai"], s: "openai" },
  { k: ["claude"], s: "claude" },
  { k: ["gemini"], s: "google-gemini" },
  { k: ["cursor"], s: "cursor" },
  { k: ["canva"], s: "canva" },
  { k: ["capcut", "cap cut"], s: "capcut" },
  { k: ["adobe photoshop", "photoshop"], s: "adobe-photoshop" },
  { k: ["adobe premiere", "premiere"], s: "adobe-premiere-pro" },
  { k: ["adobe"], s: "adobe" },
  { k: ["netflix"], s: "netflix" },
  { k: ["spotify"], s: "spotify" },
  { k: ["youtube", "yt premium"], s: "youtube" },
  { k: ["midjourney"], s: "midjourney" },
  { k: ["notion"], s: "notion" },
  { k: ["figma"], s: "figma" },
  { k: ["github"], s: "github" },
  { k: ["discord"], s: "discord" },
  { k: ["telegram"], s: "telegram" },
  { k: ["microsoft", "office"], s: "microsoft" },
  { k: ["google"], s: "google" },
  { k: ["nordvpn"], s: "nordvpn" },
  { k: ["expressvpn"], s: "expressvpn" },
  { k: ["steam"], s: "steam" },
];

const DICT = {
  vi: {
    tabShop: "Cửa hàng",
    tabKeys: "API Key",
    tabWallet: "Ví tiền",
    tabOrders: "Đơn hàng",
    tabProfile: "Cá nhân",
    subShop: "Tài khoản số & gói dịch vụ giao tự động 24/7",
    subKeys: "Khởi tạo API Key tự động & theo dõi quota",
    subWallet: "Nạp tiền VietQR / USDT & đổi mã Giftcode",
    subOrders: "Theo dõi trạng thái đơn hàng & nhận tài khoản",
    subProfile: "Cấp VIP, điểm giới thiệu & tùy chọn hiển thị",
    searchPlaceholder: "Tìm tài khoản, phần mềm, gói AI...",
    allCategories: "Tất cả",
    outOfStock: "Hết hàng",
    languageLabel: "Ngôn ngữ hiển thị",
    supportLabel: "Liên hệ Hỗ trợ",
  },
  en: {
    tabShop: "Shop",
    tabKeys: "API Keys",
    tabWallet: "Wallet",
    tabOrders: "Orders",
    tabProfile: "Profile",
    subShop: "Digital accounts & AI plans with instant delivery",
    subKeys: "Instant API key builder & quota management",
    subWallet: "Bank QR / USDT top-up & Giftcode redemption",
    subOrders: "Track orders & sync instant deliveries",
    subProfile: "VIP tier, referral rewards & preferences",
    searchPlaceholder: "Search accounts, software, AI plans...",
    allCategories: "All",
    outOfStock: "Sold out",
    languageLabel: "Language",
    supportLabel: "Customer Support",
  },
  zh: {
    tabShop: "商城",
    tabKeys: "API 密钥",
    tabWallet: "钱包",
    tabOrders: "订单",
    tabProfile: "我的",
    subShop: "24/7 自动发货数字账号与 AI 套餐",
    subKeys: "自助创建 API 密钥并查看额度",
    subWallet: "支持银行二维码 / USDT 充值与兑换码",
    subOrders: "查看订单状态与同步发货记录",
    subProfile: "VIP 等级、邀请奖励与显示设置",
    searchPlaceholder: "搜索账号、软件或 AI 套餐...",
    allCategories: "全部",
    outOfStock: "缺货",
    languageLabel: "界面语言",
    supportLabel: "联系客服",
  },
};

function tr(lang, key) {
  const l = DICT[lang] ? lang : "vi";
  return DICT[l][key] || DICT.vi[key] || key;
}

const state = {
  lang: localStorage.getItem("shop-lang") || "vi",
  deviceMode: localStorage.getItem("shop-device-mode") || "auto",
  sessionToken: localStorage.getItem("shop-tma-session") || "",
  authUser: null,
  vipInfo: null,
  balanceVnd: 0,
  activeTab: "shop",
  shop: null,
  categories: [],
  products: [],
  flashSales: [],
  apiKeyProfiles: [],
  referral: null,

  // Shop tab
  selectedCategory: "",
  search: "",
  sortBy: "default",

  // Product detail sheet
  selectedProduct: null,
  modalQty: 1,
  modalTab: "desc",
  modalCoupon: null,

  // API Key tab
  keysSubTab: "buy",
  apikeyProfileId: null,
  apikeyTokensInput: "10m",
  apikeyRpm: 100,
  apikeyDays: 30,
  lastApikeyPriceVnd: 0,

  // My Keys + Export state
  myKeysFilter: "all",
  myKeysSearch: "",
  myKeysData: null,
  myKeysLoading: false,
  revealedKeys: {},
  revealAllKeys: false,
  webLogin: null,
  webLoginPollTimer: null,

  // Wallet tab
  depositTab: "vietqr",
  amountVnd: "100000",
  amountUsdt: "5",
  selectedNet: "",
  walletTx: [],

  // Orders tab
  orderFilter: "ALL",
  ordersList: [],

  // Profile tab
  redeemMode: "newkey",
};

const $ = (id) => document.getElementById(id);

init();

async function init() {
  const hashTab = String(window.location.hash || "").replace(/^#/, "");
  if (hashTab === "mykeys" || hashTab === "keys-mine") {
    state.activeTab = "keys";
    state.keysSubTab = "mine";
  } else if (["shop", "keys", "wallet", "orders", "profile"].includes(hashTab)) {
    state.activeTab = hashTab;
  }
  applyDeviceMode();
  window.addEventListener("resize", debounce(() => {
    if (state.deviceMode === "auto") applyDeviceMode();
  }, 100));
  applyLanguage();
  await Promise.all([loadCatalog(), bootstrapAuth()]);
  if (state.keysSubTab === "mine") {
    switchKeysSubTab("mine");
  }
}

function resolveEffectiveView() {
  if (["pc", "tablet", "mobile"].includes(state.deviceMode)) {
    return state.deviceMode;
  }
  const w = window.innerWidth || 1280;
  if (w >= 1024) return "pc";
  if (w >= 768) return "tablet";
  return "mobile";
}

function applyDeviceMode() {
  const mode = ["auto", "pc", "tablet", "mobile"].includes(state.deviceMode)
    ? state.deviceMode
    : "auto";
  const resolved = resolveEffectiveView();
  document.body.dataset.deviceMode = mode;
  document.body.dataset.resolvedView = resolved;

  document.querySelectorAll("[data-device-btn]").forEach((btn) => {
    const active = btn.dataset.deviceBtn === mode;
    btn.className = `h-7 px-2.5 rounded-full text-[11.5px] transition-colors flex items-center gap-1 ${
      active
        ? "bg-zinc-100 text-zinc-950 font-semibold"
        : "text-zinc-400 hover:text-zinc-200 font-medium"
    }`;
  });
}

// ============================================================================
// CATALOG LOAD
// ============================================================================

async function loadCatalog() {
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
    }

    const nets = normalizeCryptoNetworks(state.shop?.payments?.cryptoNetworks);
    if (nets.length > 0 && !state.selectedNet) {
      state.selectedNet = nets[0].key;
    }

    renderShopMeta();
    renderFlashSales();
    renderCategories();
    renderProducts();
    renderApiKeyBuilder();
    renderWalletTab();
    renderProfileTab();
    switchTab(state.activeTab, { updateHash: false });
  } catch (err) {
    console.error(err);
    showError();
  }
}

function normalizeCryptoNetworks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    if (typeof item === "string") {
      const k = item.toLowerCase();
      return {
        key: k,
        label: k === "binance_pay" ? "Binance Pay" : k.toUpperCase(),
      };
    }
    return {
      key: String(item.key || item.network || "bep20"),
      label: String(item.label || item.key || "USDT").toUpperCase(),
    };
  });
}

function renderShopMeta() {
  const s = state.shop || {};
  const name = s.name || "Store";
  const botUser = s.botUsername || s.supportUsername || "";

  document.title = name;
  setEl("page-title", name);
  setEl("shop-name-header", name);
  setEl("sidebar-shop-name", name);
  setEl("sidebar-shop-monogram", getProductMonogram({ name }));
  setEl("toolbar-bot-tag", botUser ? `@${botUser}` : name);

  const banner = $("banner-card");
  if (banner) {
    if (s.bannerText) {
      banner.textContent = s.bannerText;
      banner.classList.remove("hidden");
    } else {
      banner.classList.add("hidden");
    }
  }
}

function updateSectionHeader() {
  const titleMap = {
    shop: tr(state.lang, "tabShop"),
    keys: tr(state.lang, "tabKeys"),
    wallet: tr(state.lang, "tabWallet"),
    orders: tr(state.lang, "tabOrders"),
    profile: tr(state.lang, "tabProfile"),
  };
  const subMap = {
    shop: tr(state.lang, "subShop"),
    keys: tr(state.lang, "subKeys"),
    wallet: tr(state.lang, "subWallet"),
    orders: tr(state.lang, "subOrders"),
    profile: tr(state.lang, "subProfile"),
  };
  setEl("pc-section-title", titleMap[state.activeTab] || titleMap.shop);
  setEl("pc-section-subtitle", subMap[state.activeTab] || subMap.shop);
}

// ============================================================================
// TAB SWITCHING (PC Sidebar + Mobile/Tablet BottomNav)
// ============================================================================

function switchTab(tab, { updateHash = true } = {}) {
  const valid = ["shop", "keys", "wallet", "orders", "profile"].includes(tab) ? tab : "shop";
  state.activeTab = valid;

  ["shop", "keys", "wallet", "orders", "profile"].forEach((t) => {
    toggleHidden(`tab-${t}`, t !== valid);
  });

  document.querySelectorAll("[data-tab]").forEach((btn) => {
    const active = btn.dataset.tab === valid;
    if (btn.dataset.navKind === "sidebar") {
      btn.className = `w-full h-10 px-3 rounded-xl flex items-center gap-3 text-[13.5px] transition-colors ${
        active
          ? "bg-zinc-100 text-zinc-950 font-semibold"
          : "text-zinc-400 hover:text-zinc-100 hover:bg-elevated font-medium"
      }`;
    } else {
      btn.className = `relative flex flex-col items-center justify-center gap-1 transition-colors ${
        active ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
      }`;
    }
    const svg = btn.querySelector("svg");
    if (svg) svg.setAttribute("stroke-width", active ? "2" : "1.65");
  });

  updateSectionHeader();

  if (valid === "keys" && state.keysSubTab === "mine") {
    renderMyKeysAuthUI();
    if (isAuthenticated()) loadMyKeys();
  } else if (valid === "orders" && isAuthenticated()) {
    loadOrders();
  } else if (valid === "wallet" && isAuthenticated()) {
    loadWalletDetails();
  }

  if (updateHash) {
    history.replaceState(null, "", `#${valid}`);
  }
  window.scrollTo({ top: 0, behavior: "instant" });
}

// ============================================================================
// TAB 1: SHOP PAGE (1:1 ShopPage.jsx)
// ============================================================================

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
    .map(
      (sale) => `
      <div class="shop-flash-card rounded-2xl bg-card border border-white/10 p-4 flex flex-col justify-between gap-3">
        <div>
          <div class="flex items-center justify-between gap-2 mb-1.5">
            <span class="px-2 py-0.5 rounded-md bg-amber-400/15 text-amber-300 text-[11px] font-mono font-semibold">
              −${escapeHtml(sale.discountPct)}%
            </span>
            ${
              sale.slotsLeft !== null
                ? `<span class="text-[11px] text-zinc-400 font-mono tabular">Còn ${escapeHtml(sale.slotsLeft)}/${escapeHtml(sale.maxSlots)}</span>`
                : ""
            }
          </div>
          <div class="text-[14px] font-medium text-zinc-100 line-clamp-1">
            ${escapeHtml(sale.productName || "Ưu đãi đặc biệt")}
          </div>
          ${
            sale.guideText
              ? `<p class="text-[12px] text-zinc-500 line-clamp-1 mt-0.5">${escapeHtml(sale.guideText)}</p>`
              : ""
          }
        </div>
        <button
          type="button"
          data-action="open-bot-param"
          data-arg="flash_${escapeAttr(sale.id)}"
          class="w-full h-9 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 text-[12.5px] font-semibold"
        >
          Nhận ưu đãi
        </button>
      </div>
    `,
    )
    .join("");
}

function renderCategories() {
  const wrap = $("cat-pills");
  if (!wrap) return;
  const activeCls = "bg-zinc-100 text-zinc-950";
  const idleCls = "bg-card border border-white/[0.07] text-zinc-400 hover:text-zinc-200";

  const pills = [
    `<button type="button" data-action="select-category" data-arg="" class="h-8 px-3.5 rounded-full text-[12.5px] font-medium whitespace-nowrap transition-colors ${state.selectedCategory === "" ? activeCls : idleCls}">${escapeHtml(tr(state.lang, "allCategories"))}</button>`,
    ...state.categories.map(
      (cat) =>
        `<button type="button" data-action="select-category" data-arg="${escapeAttr(cat.id)}" class="h-8 px-3.5 rounded-full text-[12.5px] font-medium whitespace-nowrap transition-colors ${state.selectedCategory === cat.id ? activeCls : idleCls}">${escapeHtml(cat.name)}</button>`,
    ),
  ];
  wrap.innerHTML = pills.join("");
}

function getFilteredProducts() {
  const q = state.search.trim().toLowerCase();
  const list = state.products.filter((p) => {
    const catOk = !state.selectedCategory || p.categoryId === state.selectedCategory;
    const qOk =
      !q ||
      p.name.toLowerCase().includes(q) ||
      (p.code || "").toLowerCase().includes(q) ||
      (p.categoryName || "").toLowerCase().includes(q);
    return catOk && qOk;
  });

  if (state.sortBy === "price_asc") list.sort((a, b) => productPriceVnd(a) - productPriceVnd(b));
  else if (state.sortBy === "price_desc") list.sort((a, b) => productPriceVnd(b) - productPriceVnd(a));
  else if (state.sortBy === "bestseller") list.sort((a, b) => (b.soldCount || 0) - (a.soldCount || 0));

  return list;
}

function renderProducts() {
  const grid = $("product-grid");
  const empty = $("empty-state");
  if (!grid) return;

  const list = getFilteredProducts();
  if (!list.length) {
    grid.innerHTML = "";
    grid.classList.add("hidden");
    if (empty) empty.classList.remove("hidden");
    return;
  }

  grid.className = "shop-product-grid";
  if (empty) empty.classList.add("hidden");

  const rate = usdVndRate();
  grid.innerHTML = list
    .map((p) => {
      const iconUrl = resolveProductIconUrl(p);
      const monogram = getProductMonogram(p);
      const priceVnd = productPriceVnd(p);
      const usd = p.priceUsd ?? Number((priceVnd / rate).toFixed(2));
      const isContact = p.deliveryMode === "CONTACT" || priceVnd <= 0;

      const iconHtml = iconUrl
        ? `<img src="${escapeAttr(iconUrl)}" alt="${escapeAttr(p.name)}" loading="lazy" class="w-5 h-5 object-contain" data-fallback="monogram" data-monogram="${escapeAttr(monogram)}" />`
        : `<span class="font-mono text-[11px] font-semibold text-zinc-300">${escapeHtml(monogram)}</span>`;

      const stockLabel = !p.inStock
        ? tr(state.lang, "outOfStock")
        : p.deliveryMode === "STOCK_LINES"
          ? String(p.stockCount)
          : "Auto";

      return `
        <button
          type="button"
          data-action="open-product"
          data-arg="${escapeAttr(p.id)}"
          class="shop-product-card group text-left rounded-2xl bg-card border p-3.5 flex flex-col justify-between transition-colors active:bg-elevated ${
            p.inStock
              ? "border-white/[0.07] hover:border-white/20"
              : "border-white/[0.04] opacity-55"
          }"
        >
          <div>
            <div class="flex items-start justify-between gap-2 mb-3">
              <div class="w-10 h-10 rounded-xl bg-elevated border border-white/[0.07] flex items-center justify-center overflow-hidden shrink-0">
                ${iconHtml}
              </div>

              <div class="flex items-center gap-1.5">
                <span class="inline-flex items-center gap-1 text-[11px] text-zinc-400 font-mono">
                  <span class="w-1.5 h-1.5 rounded-full ${!p.inStock ? "bg-rose-400" : "bg-emerald-400"}"></span>
                  ${escapeHtml(stockLabel)}
                </span>
              </div>
            </div>

            <div class="text-[13.5px] font-medium text-zinc-100 line-clamp-2 leading-[1.35] min-h-[2.45rem] tracking-[-0.01em]">
              ${escapeHtml(p.name)}
            </div>
          </div>

          <div class="mt-3 pt-2.5 border-t border-white/[0.05]">
            ${
              isContact
                ? `<span class="text-[12.5px] font-medium text-zinc-300">Liên hệ</span>`
                : `<div class="flex items-baseline justify-between gap-1 tabular">
                     <span class="font-mono text-[15px] font-semibold text-zinc-100 tracking-[-0.02em]">${escapeHtml(formatUsd(usd))}</span>
                     <span class="font-mono text-[11px] text-zinc-500">${escapeHtml(formatVnd(priceVnd))}</span>
                   </div>`
            }
          </div>
        </button>
      `;
    })
    .join("");
}

// ============================================================================
// PRODUCT DETAIL SHEET (1:1 ProductDetailSheet.jsx)
// ============================================================================

function openProductModal(productId) {
  const product = findProduct(productId);
  if (!product) return;

  state.selectedProduct = product;
  state.modalQty = 1;
  state.modalTab = "desc";
  state.modalCoupon = null;

  const couponInput = $("modal-coupon-input");
  const couponMsg = $("modal-coupon-msg");
  if (couponInput) couponInput.value = "";
  if (couponMsg) {
    couponMsg.textContent = "";
    couponMsg.className = "hidden text-[12px] mb-2.5";
  }

  const iconUrl = resolveProductIconUrl(product);
  const monogram = getProductMonogram(product);
  setHtml(
    "modal-media",
    iconUrl
      ? `<img src="${escapeAttr(iconUrl)}" alt="${escapeAttr(product.name)}" class="w-7 h-7 object-contain" data-fallback="monogram" data-monogram="${escapeAttr(monogram)}" />`
      : `<span class="font-mono text-[13px] font-semibold text-zinc-300">${escapeHtml(monogram)}</span>`,
  );

  const stockSpan = `<span class="${product.inStock ? "text-emerald-400" : "text-rose-400"}">${
    product.deliveryMode === "STOCK_LINES"
      ? product.inStock
        ? `Còn ${escapeHtml(product.stockCount)}`
        : "Hết hàng"
      : "Tự động"
  }</span>`;
  setHtml(
    "modal-meta-line",
    `<span>${escapeHtml(product.categoryName || "Khác")}</span><span class="text-zinc-600">·</span>${stockSpan}`,
  );
  setEl("modal-title", product.name);

  // Description & Note
  const hasDesc = Boolean(product.description);
  const hasNote = Boolean(product.note);
  toggleHidden("modal-desc-box", !(hasDesc || hasNote));
  toggleHidden("modal-tabs", !(hasDesc && hasNote));
  renderModalDescTab();

  const isContact = product.deliveryMode === "CONTACT" || productPriceVnd(product) <= 0;
  toggleHidden("modal-contact-area", !isContact);
  toggleHidden("modal-purchase-area", isContact);

  if (!isContact) {
    renderModalQtyTiers();
    renderModalSummary();
  }

  const modal = $("product-modal");
  if (modal) {
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }
}

function closeProductModal() {
  const modal = $("product-modal");
  if (modal) modal.classList.add("hidden");
  document.body.style.overflow = "";
}

function renderModalDescTab() {
  const p = state.selectedProduct;
  if (!p) return;
  document.querySelectorAll("#modal-tabs button").forEach((btn) => {
    const active = btn.dataset.arg === state.modalTab;
    btn.className = `px-3 py-1 rounded-md text-[12px] font-medium transition-colors ${
      active ? "bg-zinc-100 text-zinc-950" : "text-zinc-400"
    }`;
  });
  setEl(
    "modal-desc-text",
    state.modalTab === "note" && p.note ? p.note : p.description || p.note || "",
  );
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
    `<span class="text-[12px] text-zinc-400">Ưu đãi số lượng:</span>` +
    tiers
      .map(
        (t) =>
          `<button type="button" data-action="modal-set-qty" data-arg="${escapeAttr(t.minQty)}" class="px-2.5 py-1 rounded-lg bg-elevated border border-white/[0.08] text-[12px] font-mono text-zinc-200 hover:border-white/20">${escapeHtml(t.minQty)}+ (−${escapeHtml(t.discountPercent)}%)</button>`,
      )
      .join("");
}

function renderModalSummary() {
  const p = state.selectedProduct;
  if (!p) return;

  const maxQty = p.deliveryMode === "STOCK_LINES" ? Math.max(1, Number(p.stockCount || 1)) : 99;
  state.modalQty = Math.min(Math.max(1, state.modalQty), maxQty);

  setEl("modal-qty-val", String(state.modalQty));
  const dec = $("modal-qty-dec");
  const inc = $("modal-qty-inc");
  if (dec) dec.disabled = state.modalQty <= 1;
  if (inc) inc.disabled = state.modalQty >= maxQty;

  const grossVnd = productPriceVnd(p) * state.modalQty;
  const qtyPct = getQtyDiscountPercent(p, state.modalQty);
  const qtyDiscVnd = qtyPct > 0 ? Math.floor((grossVnd * qtyPct) / 100) : 0;
  const afterQtyVnd = Math.max(0, grossVnd - qtyDiscVnd);
  const couponDiscVnd = state.modalCoupon ? computeCouponDiscount(state.modalCoupon, afterQtyVnd) : 0;
  const finalVnd = Math.max(0, afterQtyVnd - couponDiscVnd);
  const finalUsd = finalVnd / usdVndRate();

  setEl("modal-sub-label", `Tạm tính (${state.modalQty})`);
  setEl("modal-subtotal", formatVnd(grossVnd));

  toggleHidden("modal-qty-disc-row", qtyDiscVnd <= 0);
  if (qtyDiscVnd > 0) {
    setEl("modal-qty-disc-label", `Giảm theo số lượng (−${qtyPct}%)`);
    setEl("modal-qty-disc-val", `−${formatVnd(qtyDiscVnd)}`);
  }

  toggleHidden("modal-coupon-disc-row", couponDiscVnd <= 0);
  if (couponDiscVnd > 0 && state.modalCoupon) {
    setEl("modal-coupon-disc-label", `Mã ${state.modalCoupon.code}`);
    setEl("modal-coupon-disc-val", `−${formatVnd(couponDiscVnd)}`);
  }

  setEl("modal-total-usd", formatUsd(finalUsd));
  setEl("modal-total-vnd", formatVnd(finalVnd));

  toggleHidden("modal-out-btn", p.inStock);
  toggleHidden("modal-pay-buttons", !p.inStock);

  setEl("modal-topup-btn", `Số dư thiếu ${formatVnd(finalVnd)} · Nạp thêm Ví`);

  const nets = normalizeCryptoNetworks(state.shop?.payments?.cryptoNetworks);
  const cryptoWrap = $("modal-crypto-btns");
  if (cryptoWrap) {
    cryptoWrap.innerHTML = nets
      .map(
        (net) =>
          `<button type="button" data-action="buy-now-from-modal" class="h-10 px-3 rounded-xl bg-elevated hover:bg-subtle border border-white/[0.08] text-zinc-200 font-medium text-[13px]">USDT ${escapeHtml(net.label)}</button>`,
      )
      .join("");
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
    msgEl.className = "hidden text-[12px] mb-2.5";
    renderModalSummary();
    return;
  }

  const grossVnd = productPriceVnd(p) * state.modalQty;
  const qtyPct = getQtyDiscountPercent(p, state.modalQty);
  const afterQtyVnd = Math.max(0, grossVnd - Math.floor((grossVnd * qtyPct) / 100));

  try {
    const res = await fetch(`/api/shop/coupon/${encodeURIComponent(code)}?amount=${Math.round(afterQtyVnd)}`);
    const data = await res.json();
    if (!res.ok || data.error) {
      state.modalCoupon = null;
      msgEl.className = "text-[12px] text-rose-400 mb-2.5";
      msgEl.textContent = data.error || "Mã không hợp lệ";
    } else {
      const type = String(data.discountType || "").toUpperCase();
      state.modalCoupon = {
        code,
        type: type === "PERCENT" ? "percent" : "amount",
        value: type === "PERCENT" ? Number(data.discountValue || 0) : Number(data.discountAmount || 0),
        maxDiscount: Number(data.maxDiscount || 0),
      };
      const disc = computeCouponDiscount(state.modalCoupon, afterQtyVnd);
      msgEl.className = "text-[12px] text-emerald-400 mb-2.5";
      msgEl.textContent = `Đã áp dụng mã ${code} (−${formatVnd(disc)})`;
    }
  } catch {
    state.modalCoupon = null;
    msgEl.className = "text-[12px] text-rose-400 mb-2.5";
    msgEl.textContent = "Lỗi kết nối máy chủ";
  }
  renderModalSummary();
}

// ============================================================================
// TAB 2: API KEYS PAGE (1:1 ApiKeysPage.jsx)
// ============================================================================

function switchKeysSubTab(sub) {
  state.keysSubTab = sub === "mine" ? "mine" : "buy";
  toggleHidden("keys-sub-buy", state.keysSubTab !== "buy");
  toggleHidden("keys-sub-mine", state.keysSubTab !== "mine");

  const btnBuy = $("keys-subbtn-buy");
  const btnMine = $("keys-subbtn-mine");
  if (btnBuy) {
    btnBuy.className = `h-9 rounded-lg text-[13px] transition-colors ${
      state.keysSubTab === "buy" ? "bg-zinc-100 text-zinc-950 font-semibold" : "text-zinc-400 font-medium"
    }`;
  }
  if (btnMine) {
    btnMine.className = `h-9 rounded-lg text-[13px] transition-colors ${
      state.keysSubTab === "mine" ? "bg-zinc-100 text-zinc-950 font-semibold" : "text-zinc-400 font-medium"
    }`;
  }

  if (state.keysSubTab === "mine") {
    renderMyKeysAuthUI();
    if (isAuthenticated()) loadMyKeys();
  }
}

// ============================================================================
// WEB AUTH & ACCOUNT SYNC (Telegram Bot 1-Tap + Personal API Key)
// ============================================================================

function getRawTelegramInitData() {
  return String(window.Telegram?.WebApp?.initData || "").trim();
}

function isAuthenticated() {
  return Boolean(state.authUser && (state.sessionToken || getRawTelegramInitData()));
}

function saveSessionToken(token) {
  state.sessionToken = String(token || "").trim();
  try {
    if (state.sessionToken) localStorage.setItem("shop-tma-session", state.sessionToken);
    else localStorage.removeItem("shop-tma-session");
  } catch {}
}

async function tmaFetch(path, { method = "GET", body = null } = {}) {
  const headers = { Accept: "application/json" };
  const rawInit = getRawTelegramInitData();
  if (state.sessionToken) {
    headers.Authorization = `Bearer ${state.sessionToken}`;
  } else if (rawInit) {
    headers.Authorization = `tma ${rawInit}`;
  }
  if (body !== null) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`/api/tma${path}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    saveSessionToken("");
    state.authUser = null;
    renderAuthBoundState();
  }
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = data.code || "";
    throw err;
  }
  return data;
}

async function bootstrapAuth() {
  const rawInit = getRawTelegramInitData();
  if (!state.sessionToken && !rawInit) {
    renderAuthBoundState();
    return;
  }
  try {
    const res = rawInit
      ? await tmaFetch("/auth", { method: "POST", body: {} })
      : await tmaFetch("/me");
    applyAuthPayload(res);
  } catch {
    renderAuthBoundState();
  }
}

function applyAuthPayload(res) {
  if (!res?.ok) return;
  if (res.sessionToken) saveSessionToken(res.sessionToken);
  state.authUser = res.user || null;
  state.balanceVnd = Number(res.balance ?? 0);
  state.vipInfo = res.vip || null;
  if (res.user?.language && ["vi", "en", "zh"].includes(res.user.language)) {
    state.lang = res.user.language;
    try { localStorage.setItem("shop-lang", state.lang); } catch {}
    applyLanguage();
  }
  renderAuthBoundState();
  if (state.keysSubTab === "mine") loadMyKeys();
  if (state.activeTab === "orders") loadOrders();
  if (state.activeTab === "wallet") loadWalletDetails();
}

function renderAuthBoundState() {
  const authed = isAuthenticated();
  const u = state.authUser;
  const balText = formatVnd(authed ? state.balanceVnd : 0);
  const rate = usdVndRate();

  setEl("header-balance", balText);
  setEl("sidebar-balance", balText);
  setEl("wallet-balance-vnd", balText);
  setEl("wallet-balance-usd", `≈ ${formatUsd((authed ? state.balanceVnd : 0) / rate)}`);

  if (authed && u) {
    const displayName = u.firstName || (u.username ? `@${u.username}` : `ID ${u.telegramId}`);
    setEl("sidebar-account-label", displayName);
    const sAuthBtn = $("sidebar-auth-btn");
    if (sAuthBtn) {
      sAuthBtn.textContent = "Key của tôi";
      sAuthBtn.dataset.action = "go-mykeys";
    }
  } else {
    setEl("sidebar-account-label", "Khách · Chưa đồng bộ");
    const sAuthBtn = $("sidebar-auth-btn");
    if (sAuthBtn) {
      sAuthBtn.textContent = "Đăng nhập";
      sAuthBtn.dataset.action = "go-login";
    }
  }

  renderMyKeysAuthUI();
  renderProfileTab();
  renderOrdersSection();
  renderWalletTxList();
}

function renderMyKeysAuthUI() {
  const authed = isAuthenticated();
  toggleHidden("mykeys-guest-box", authed);
  toggleHidden("mykeys-authed-box", !authed);

  const pending = Boolean(state.webLogin?.token);
  toggleHidden("weblogin-idle-box", pending);
  toggleHidden("weblogin-pending-box", !pending);
  if (pending && state.webLogin?.deepLink) {
    const linkEl = $("weblogin-open-link");
    if (linkEl) linkEl.setAttribute("href", state.webLogin.deepLink);
  }
}

function setWebLoginError(msg) {
  const errEl = $("weblogin-error");
  if (!errEl) return;
  if (!msg) {
    errEl.textContent = "";
    errEl.classList.add("hidden");
  } else {
    errEl.textContent = msg;
    errEl.classList.remove("hidden");
  }
}

function stopWebLoginPolling() {
  if (state.webLoginPollTimer) {
    clearInterval(state.webLoginPollTimer);
    state.webLoginPollTimer = null;
  }
  state.webLogin = null;
}

async function startWebLogin() {
  setWebLoginError("");
  stopWebLoginPolling();
  try {
    const res = await fetch("/api/shop/auth/start", {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    const data = await res.json();
    if (!res.ok || !data.ok || !data.token) {
      throw new Error(data.error || "Không khởi tạo được phiên đăng nhập.");
    }
    const fallbackBot = state.shop?.botUsername || state.shop?.supportUsername || "";
    const deepLink = data.deepLink || (fallbackBot ? `https://t.me/${fallbackBot}?start=weblogin_${data.token}` : "");
    if (!deepLink) {
      throw new Error("Shop chưa cấu hình BOT_USERNAME để đăng nhập qua Telegram.");
    }
    state.webLogin = { token: data.token, deepLink, expiresAt: data.expiresAt };
    renderMyKeysAuthUI();
    window.open(deepLink, "_blank", "noopener,noreferrer");

    state.webLoginPollTimer = setInterval(async () => {
      if (!state.webLogin?.token) {
        stopWebLoginPolling();
        return;
      }
      try {
        const pollRes = await fetch(`/api/shop/auth/poll?token=${encodeURIComponent(state.webLogin.token)}`);
        const p = await pollRes.json();
        if (p.status === "approved" && p.sessionToken) {
          stopWebLoginPolling();
          saveSessionToken(p.sessionToken);
          const me = await tmaFetch("/me");
          applyAuthPayload(me);
          showToast("Đăng nhập & đồng bộ tài khoản thành công", "success");
        } else if (p.status === "rejected") {
          stopWebLoginPolling();
          renderMyKeysAuthUI();
          setWebLoginError("Bạn đã hủy yêu cầu đăng nhập trong Telegram.");
        } else if (p.status === "expired") {
          stopWebLoginPolling();
          renderMyKeysAuthUI();
          setWebLoginError("Phiên đăng nhập đã hết hạn, vui lòng bấm Đăng nhập lại.");
        }
      } catch {}
    }, 1800);
  } catch (err) {
    setWebLoginError(err.message || "Không thể tạo phiên đăng nhập.");
  }
}

async function loginWithApiKey() {
  setWebLoginError("");
  const input = $("weblogin-apikey-input");
  const rawKey = input?.value?.trim() || "";
  if (!rawKey) {
    setWebLoginError("Vui lòng nhập API Key cá nhân (lấy bằng lệnh /api trong bot).");
    return;
  }
  try {
    const res = await fetch("/api/shop/auth/apikey", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ apiKey: rawKey }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok || !data.sessionToken) {
      throw new Error(data.error || "API Key không hợp lệ.");
    }
    if (input) input.value = "";
    stopWebLoginPolling();
    saveSessionToken(data.sessionToken);
    const me = await tmaFetch("/me");
    applyAuthPayload(me);
    showToast("Đồng bộ tài khoản thành công", "success");
  } catch (err) {
    setWebLoginError(err.message || "Đăng nhập thất bại.");
  }
}

function webLogout() {
  stopWebLoginPolling();
  saveSessionToken("");
  state.authUser = null;
  state.balanceVnd = 0;
  state.vipInfo = null;
  state.myKeysData = null;
  state.revealedKeys = {};
  state.revealAllKeys = false;
  state.ordersList = [];
  state.walletTx = [];
  renderAuthBoundState();
  showToast("Đã đăng xuất khỏi trình duyệt", "info");
}

// ============================================================================
// MY KEYS & WEB EXPORT
// ============================================================================

function renderMyKeyFilters() {
  const counts = state.myKeysData?.counts || null;
  const defs = [
    { id: "all", label: "Tất cả", count: counts?.all },
    { id: "active", label: "Đang hoạt động", count: counts?.active },
    { id: "low", label: "Sắp cạn", count: counts?.low },
    { id: "expired", label: "Đã hết", count: counts?.expired },
  ];
  const wrap = $("mykeys-filters");
  if (!wrap) return;
  wrap.innerHTML = defs
    .map((f) => {
      const active = state.myKeysFilter === f.id;
      const countText = typeof f.count === "number" ? ` (${f.count})` : "";
      return `<button type="button" data-action="select-mykey-filter" data-arg="${escapeAttr(f.id)}" class="h-8 px-3.5 rounded-full text-[12.5px] font-medium whitespace-nowrap transition-colors ${
        active
          ? "bg-zinc-100 text-zinc-950"
          : "bg-card border border-white/[0.07] text-zinc-400 hover:text-zinc-200"
      }">${escapeHtml(f.label + countText)}</button>`;
    })
    .join("");
}

async function loadMyKeys(filter = state.myKeysFilter) {
  if (!isAuthenticated()) return;
  state.myKeysFilter = filter || "all";
  state.myKeysLoading = true;
  renderMyKeyFilters();
  toggleHidden("mykeys-loading", false);
  toggleHidden("mykeys-empty", true);
  const icon = $("mykeys-refresh-icon");
  if (icon) icon.classList.add("animate-spin");

  try {
    const res = await tmaFetch(`/apikey/my-keys?filter=${encodeURIComponent(state.myKeysFilter)}`);
    state.myKeysData = res;
    renderMyKeys();
  } catch (err) {
    showToast(err.message || "Không tải được danh sách API Key", "error");
  } finally {
    state.myKeysLoading = false;
    toggleHidden("mykeys-loading", true);
    if (icon) icon.classList.remove("animate-spin");
  }
}

function getVisibleMyKeys() {
  const all = state.myKeysData?.keys || [];
  const q = state.myKeysSearch.trim().toLowerCase();
  if (!q) return all;
  return all.filter((k) => {
    const raw = (state.revealedKeys[k.id] || "").toLowerCase();
    return (
      (k.maskedKey || "").toLowerCase().includes(q) ||
      (k.profileName || "").toLowerCase().includes(q) ||
      raw.includes(q)
    );
  });
}

function formatKeyDate(iso) {
  if (!iso) return "Vĩnh viễn";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Vĩnh viễn";
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function renderMyKeys() {
  renderMyKeyFilters();
  const data = state.myKeysData;
  const endpointBar = $("mykeys-endpoint-bar");
  if (endpointBar) {
    if (data?.endpoint) {
      setEl("mykeys-endpoint-text", data.endpoint);
      endpointBar.classList.remove("hidden");
    } else {
      endpointBar.classList.add("hidden");
    }
  }

  const revealBtn = $("mykeys-reveal-all-btn");
  if (revealBtn) {
    revealBtn.textContent = state.revealAllKeys ? "Ẩn tất cả Key" : "Hiện tất cả Key";
  }

  const rows = getVisibleMyKeys();
  setEl("mykeys-summary-text", `${rows.length} API Key${typeof data?.counts?.all === "number" ? ` · Tổng ${data.counts.all}` : ""}`);

  const listEl = $("mykeys-list");
  const emptyEl = $("mykeys-empty");
  if (!listEl) return;

  if (!rows.length) {
    listEl.innerHTML = "";
    toggleHidden("mykeys-empty", state.myKeysLoading);
    return;
  }
  if (emptyEl) emptyEl.classList.add("hidden");

  listEl.innerHTML = rows
    .map((k) => {
      const fullKey = state.revealedKeys[k.id] || "";
      const showFull = Boolean(fullKey && (state.revealAllKeys || state.revealedKeys[`__open_${k.id}`]));
      const statusColor = k.dead
        ? "text-rose-400"
        : k.usedPct >= 80
          ? "text-amber-400"
          : "text-emerald-400";
      const dotColor = k.dead
        ? "bg-rose-400"
        : k.usedPct >= 80
          ? "bg-amber-400"
          : "bg-emerald-400";
      const barColor = k.dead
        ? "bg-rose-400"
        : k.usedPct >= 80
          ? "bg-amber-400"
          : "bg-zinc-100";
      const statusLabel = k.dead ? "Đã hết" : k.unlimitedQuota ? "Vô hạn" : `${k.usedPct}%`;
      const pctWidth = Math.min(100, Math.max(2, Number(k.usedPct || 0)));

      return `
        <div class="rounded-2xl bg-card border border-white/[0.08] p-4 space-y-3.5">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="font-mono text-[13px] font-medium text-zinc-100 break-all select-all">
                ${escapeHtml(showFull ? fullKey : k.maskedKey)}
              </div>
              <div class="flex items-center gap-2 text-[11.5px] text-zinc-500 font-mono mt-1 flex-wrap">
                ${k.profileName ? `<span>${escapeHtml(k.profileName)}</span><span>·</span>` : ""}
                <span>${escapeHtml(k.rpm || "—")} RPM</span>
                <span>·</span>
                <span>${escapeHtml(formatKeyDate(k.expiresAt))}</span>
              </div>
            </div>
            <span class="inline-flex items-center gap-1.5 text-[11.5px] font-mono shrink-0 ${statusColor}">
              <span class="w-1.5 h-1.5 rounded-full ${dotColor}"></span>
              ${escapeHtml(statusLabel)}
            </span>
          </div>

          ${
            !k.unlimitedQuota
              ? `<div class="space-y-1.5 tabular">
                   <div class="h-1.5 rounded-full bg-bg overflow-hidden">
                     <div class="h-full rounded-full transition-all ${barColor}" style="width: ${pctWidth}%"></div>
                   </div>
                   <div class="flex justify-between text-[11.5px] font-mono text-zinc-400">
                     <span>Đã dùng ${escapeHtml(formatTokensCompact(k.usedTokens))}</span>
                     <span>Hạn mức ${escapeHtml(formatTokensCompact(k.quotaTokens))}</span>
                   </div>
                 </div>`
              : ""
          }

          <div class="flex gap-2 pt-0.5">
            <button
              type="button"
              data-action="copy-mykey"
              data-arg="${escapeAttr(k.id)}"
              class="flex-1 h-9 rounded-xl bg-elevated hover:bg-subtle border border-white/[0.08] text-[12.5px] font-medium text-zinc-200"
            >
              Sao chép
            </button>
            <button
              type="button"
              data-action="toggle-mykey-reveal"
              data-arg="${escapeAttr(k.id)}"
              class="h-9 px-3.5 rounded-xl bg-elevated hover:bg-subtle border border-white/[0.08] text-[12.5px] font-medium text-zinc-300"
            >
              ${showFull ? "Ẩn" : "Hiện"}
            </button>
            ${
              k.canRenew
                ? `<button
                     type="button"
                     data-action="open-bot-param"
                     data-arg="renew_${escapeAttr(k.id)}"
                     class="flex-1 h-9 rounded-xl bg-zinc-100 hover:bg-white text-[12.5px] font-semibold text-zinc-950"
                   >
                     Gia hạn
                   </button>`
                : ""
            }
          </div>
        </div>
      `;
    })
    .join("");
}

async function ensureSingleKeyRevealed(id) {
  if (state.revealedKeys[id]) return state.revealedKeys[id];
  const res = await tmaFetch(`/apikey/keys/${encodeURIComponent(id)}/reveal`);
  if (!res?.key) throw new Error("Không đọc được chuỗi API Key.");
  state.revealedKeys[id] = res.key;
  return res.key;
}

async function toggleRevealSingleKey(id) {
  const isOpen = Boolean(state.revealedKeys[`__open_${id}`]);
  if (isOpen) {
    state.revealedKeys[`__open_${id}`] = false;
    if (state.revealAllKeys) state.revealAllKeys = false;
    renderMyKeys();
    return;
  }
  try {
    await ensureSingleKeyRevealed(id);
    state.revealedKeys[`__open_${id}`] = true;
    renderMyKeys();
  } catch (err) {
    showToast(err.message || "Lỗi lấy key", "error");
  }
}

async function copySingleKey(id) {
  try {
    const full = await ensureSingleKeyRevealed(id);
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(full);
    }
    state.revealedKeys[`__open_${id}`] = true;
    renderMyKeys();
    showToast("Đã sao chép API Key", "success");
  } catch (err) {
    showToast(err.message || "Không sao chép được API Key", "error");
  }
}

async function fetchFullExportKeys() {
  const res = await tmaFetch(`/apikey/my-keys/export?filter=${encodeURIComponent(state.myKeysFilter)}&limit=500`);
  const keys = Array.isArray(res?.keys) ? res.keys : [];
  for (const row of keys) {
    if (row?.id && row?.key) {
      state.revealedKeys[row.id] = row.key;
    }
  }
  const q = state.myKeysSearch.trim().toLowerCase();
  const filtered = q
    ? keys.filter(
        (k) =>
          (k.key || "").toLowerCase().includes(q) ||
          (k.profileName || "").toLowerCase().includes(q),
      )
    : keys;
  return { endpoint: res?.endpoint || state.myKeysData?.endpoint || "", keys: filtered };
}

async function toggleRevealAllKeys() {
  if (state.revealAllKeys) {
    state.revealAllKeys = false;
    for (const k of Object.keys(state.revealedKeys)) {
      if (k.startsWith("__open_")) state.revealedKeys[k] = false;
    }
    renderMyKeys();
    return;
  }
  try {
    await fetchFullExportKeys();
    state.revealAllKeys = true;
    renderMyKeys();
    showToast("Đã mở hiển thị toàn bộ API Key", "success");
  } catch (err) {
    showToast(err.message || "Không tải được danh sách key", "error");
  }
}

function csvCell(value) {
  const s = String(value ?? "");
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replaceAll('"', '""')}"`;
}

function downloadTextFile(filename, content, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportKeys(mode) {
  if (!isAuthenticated()) {
    showToast("Vui lòng đăng nhập để xuất Key", "error");
    return;
  }
  try {
    const { endpoint, keys } = await fetchFullExportKeys();
    renderMyKeys();
    if (!keys.length) {
      showToast("Không có API Key nào để xuất", "error");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const baseName = `api-keys-${state.myKeysFilter}-${stamp}`;

    if (mode === "copy") {
      const lines = keys.map((k) => k.key).filter(Boolean).join("\n");
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(lines);
      }
      showToast(`Đã sao chép ${keys.length} API Key`, "success");
      return;
    }

    if (mode === "txt") {
      const lines = keys.map((k) => k.key).filter(Boolean).join("\n");
      downloadTextFile(`${baseName}.txt`, `${lines}\n`, "text/plain;charset=utf-8");
      showToast(`Đã xuất ${keys.length} key ra ${baseName}.txt`, "success");
      return;
    }

    if (mode === "csv") {
      const headers = ["Key", "MayChu", "TrangThai", "DaDung", "HanMuc", "RPM", "HetHan", "NgayTao", "Endpoint"];
      const rows = keys.map((k) => {
        const status = k.dead ? "DaHet" : k.unlimitedQuota ? "VoHan" : `${k.usedPct}%`;
        return [
          `"${String(k.key || "").replaceAll('"', '""')}"`,
          csvCell(k.profileName || ""),
          csvCell(status),
          csvCell(k.usedTokens || 0),
          csvCell(k.unlimitedQuota ? "Unlimited" : (k.quotaTokens || 0)),
          csvCell(k.rpm || 0),
          csvCell(k.expiresAt || "VinhVien"),
          csvCell(k.createdAt || ""),
          csvCell(endpoint),
        ].join(",");
      });
      const csv = `\uFEFF${headers.join(",")}\n${rows.join("\n")}\n`;
      downloadTextFile(`${baseName}.csv`, csv, "text/csv;charset=utf-8");
      showToast(`Đã xuất ${keys.length} key ra ${baseName}.csv`, "success");
      return;
    }

    if (mode === "json") {
      const payload = {
        exportedAt: new Date().toISOString(),
        filter: state.myKeysFilter,
        endpoint,
        total: keys.length,
        keys: keys.map((k) => ({
          key: k.key,
          profileName: k.profileName,
          rpm: k.rpm,
          usedTokens: k.usedTokens,
          quotaTokens: k.quotaTokens,
          unlimitedQuota: k.unlimitedQuota,
          dead: k.dead,
          expiresAt: k.expiresAt,
          createdAt: k.createdAt,
        })),
      };
      downloadTextFile(`${baseName}.json`, `${JSON.stringify(payload, null, 2)}\n`, "application/json;charset=utf-8");
      showToast(`Đã xuất ${keys.length} key ra ${baseName}.json`, "success");
    }
  } catch (err) {
    showToast(err.message || "Không thể xuất API Key", "error");
  }
}

async function loadWalletDetails() {
  if (!isAuthenticated()) return;
  try {
    const res = await tmaFetch("/wallet");
    if (typeof res.balance === "number") {
      state.balanceVnd = res.balance;
      const balText = formatVnd(state.balanceVnd);
      setEl("header-balance", balText);
      setEl("sidebar-balance", balText);
      setEl("wallet-balance-vnd", balText);
      setEl("wallet-balance-usd", `≈ ${formatUsd(state.balanceVnd / usdVndRate())}`);
    }
    state.walletTx = Array.isArray(res.transactions) ? res.transactions : [];
    renderWalletTxList();
  } catch {}
}

function renderWalletTxList() {
  const wrap = $("wallet-tx-list");
  if (!wrap) return;
  if (!isAuthenticated()) {
    wrap.className = "text-[13px] text-zinc-500 py-6 text-center";
    wrap.textContent = "Đăng nhập Telegram để xem lịch sử giao dịch";
    return;
  }
  if (!state.walletTx.length) {
    wrap.className = "text-[13px] text-zinc-500 py-6 text-center";
    wrap.textContent = "Chưa có giao dịch nào";
    return;
  }
  wrap.className = "divide-y divide-white/[0.05]";
  wrap.innerHTML = state.walletTx
    .slice(0, 20)
    .map((tx) => {
      const plus = ["DEPOSIT", "REFUND", "ADMIN_ADD"].includes(tx.type);
      return `
        <div class="py-2.5 flex items-center justify-between gap-3 text-[12.5px]">
          <div class="min-w-0">
            <div class="text-zinc-200 truncate">${escapeHtml(tx.description || tx.type)}</div>
            <div class="text-[11px] font-mono text-zinc-500 mt-0.5">${escapeHtml(formatKeyDate(tx.createdAt))} · ${escapeHtml(tx.status || "")}</div>
          </div>
          <div class="font-mono font-semibold tabular shrink-0 ${plus ? "text-emerald-400" : "text-zinc-300"}">
            ${plus ? "+" : "−"}${escapeHtml(formatVnd(Math.abs(Number(tx.amount || 0))))}
          </div>
        </div>
      `;
    })
    .join("");
}

async function loadOrders() {
  if (!isAuthenticated()) return;
  try {
    const res = await tmaFetch(`/orders?status=${encodeURIComponent(state.orderFilter)}`);
    state.ordersList = Array.isArray(res.orders) ? res.orders : [];
    renderOrdersSection();
  } catch (err) {
    showToast(err.message || "Không tải được đơn hàng", "error");
  }
}

function renderOrdersSection() {
  const emptyEl = $("orders-empty");
  const listEl = $("orders-list");
  if (!emptyEl || !listEl) return;

  if (!isAuthenticated()) {
    emptyEl.classList.remove("hidden");
    listEl.classList.add("hidden");
    emptyEl.innerHTML = `
      <p class="text-[13.5px] text-zinc-400">Đăng nhập Telegram để đồng bộ và xem đơn hàng của bạn</p>
      <button type="button" data-action="go-login" class="h-9 px-4 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 text-[12.5px] font-semibold">Đăng nhập đồng bộ tài khoản</button>
    `;
    return;
  }

  if (!state.ordersList.length) {
    emptyEl.classList.remove("hidden");
    listEl.classList.add("hidden");
    emptyEl.innerHTML = `<p class="text-[13.5px] text-zinc-400">Chưa có đơn hàng nào trong mục này</p>`;
    return;
  }

  emptyEl.classList.add("hidden");
  listEl.classList.remove("hidden");
  listEl.innerHTML = state.ordersList
    .map((ord) => {
      const stCls =
        ord.status === "DELIVERED"
          ? "text-emerald-400"
          : ord.status === "PENDING"
            ? "text-amber-400"
            : "text-zinc-500";
      return `
        <div class="rounded-2xl bg-card border border-white/[0.08] p-4 flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="text-[13.5px] font-medium text-zinc-100 truncate">
              ${escapeHtml(ord.productName || "Đơn hàng")} ×${escapeHtml(ord.quantity || 1)}
            </div>
            <div class="text-[11.5px] font-mono text-zinc-500 mt-0.5">
              #${escapeHtml(ord.shortId || String(ord.id || "").slice(-8).toUpperCase())} · ${escapeHtml(formatKeyDate(ord.createdAt))}
            </div>
          </div>
          <div class="text-right shrink-0">
            <div class="font-mono text-[13.5px] font-semibold text-zinc-100 tabular">
              ${escapeHtml(formatVnd(ord.finalAmount || 0))}
            </div>
            <div class="text-[11.5px] font-mono mt-0.5 ${stCls}">${escapeHtml(ord.status || "")}</div>
          </div>
        </div>
      `;
    })
    .join("");
}

function getActiveApiKeyProfile() {
  return (
    state.apiKeyProfiles.find((p) => p.profileId === state.apikeyProfileId) ||
    state.apiKeyProfiles[0] ||
    null
  );
}

function renderApiKeyBuilder() {
  const profiles = state.apiKeyProfiles || [];
  const hasAny = profiles.length > 0;
  toggleHidden("apikey-unavailable", hasAny);
  toggleHidden("apikey-builder", !hasAny);
  if (!hasAny) return;

  const active = getActiveApiKeyProfile();
  if (!active) return;

  const serverCard = $("apikey-server-card");
  const serverGrid = $("apikey-server-grid");
  if (serverCard && serverGrid) {
    serverCard.classList.toggle("hidden", profiles.length <= 1);
    serverGrid.innerHTML = profiles
      .map((p) => {
        const isAct = p.profileId === active.profileId;
        return `
          <button
            type="button"
            data-action="select-apikey-profile"
            data-arg="${escapeAttr(p.profileId)}"
            class="p-3 rounded-xl border text-left transition-colors ${
              isAct
                ? "bg-zinc-100 border-zinc-100 text-zinc-950"
                : "bg-bg border-white/[0.07] text-zinc-200 hover:border-white/20"
            }"
          >
            <div class="text-[13px] font-semibold truncate">${escapeHtml(p.name)}</div>
            <div class="text-[11.5px] font-mono mt-0.5 ${isAct ? "text-zinc-700" : "text-zinc-400"}">
              $${escapeHtml(p.usdPerMtoken)} / 1M
            </div>
          </button>
        `;
      })
      .join("");
  }

  setEl("apikey-rate-label", `$${active.usdPerMtoken} / 1M`);
  setEl("apikey-rpm-included", `Mặc định ${active.rpmIncluded || 100} RPM`);

  const presetsWrap = $("apikey-token-presets");
  if (presetsWrap) {
    const presets = (active.buyPresetsM || [5, 10, 20, 50, 100, 200]).slice(0, 6);
    presetsWrap.innerHTML = presets
      .map((m) => {
        const val = `${m}m`;
        const isAct = state.apikeyTokensInput.trim().toLowerCase() === val;
        const label = m >= 1000 ? `${m / 1000}B` : `${m}M`;
        return `
          <button
            type="button"
            data-action="select-apikey-tokens"
            data-arg="${escapeAttr(val)}"
            class="h-10 rounded-xl border text-[13px] font-mono transition-colors ${
              isAct
                ? "bg-zinc-100 border-zinc-100 text-zinc-950 font-semibold"
                : "bg-bg border-white/[0.07] text-zinc-300 hover:border-white/20"
            }"
          >
            ${escapeHtml(label)}
          </button>
        `;
      })
      .join("");
  }

  const tokInput = $("apikey-tokens-input");
  if (tokInput && tokInput.value !== state.apikeyTokensInput) {
    tokInput.value = state.apikeyTokensInput;
  }

  const rpmWrap = $("apikey-rpm-presets");
  if (rpmWrap) {
    const rpms = active.rpmPresets || [100, 300, 600, 1200];
    rpmWrap.innerHTML = rpms
      .map((r) => {
        const isAct = Number(state.apikeyRpm) === Number(r);
        return `
          <button
            type="button"
            data-action="select-apikey-rpm"
            data-arg="${escapeAttr(r)}"
            class="h-9 px-3.5 rounded-xl border text-[12.5px] font-mono whitespace-nowrap transition-colors ${
              isAct
                ? "bg-zinc-100 border-zinc-100 text-zinc-950 font-semibold"
                : "bg-bg border-white/[0.07] text-zinc-300"
            }"
          >
            ${r} RPM
          </button>
        `;
      })
      .join("");
  }

  const daysWrap = $("apikey-days-presets");
  if (daysWrap) {
    const rawDays = Array.isArray(active.daysPresets) ? active.daysPresets : [1, 3, 7, 30, 90];
    const days = rawDays.includes(0) ? rawDays : [...rawDays, 0];
    daysWrap.innerHTML = days
      .map((d) => {
        const isAct = Number(state.apikeyDays) === Number(d);
        return `
          <button
            type="button"
            data-action="select-apikey-days"
            data-arg="${escapeAttr(d)}"
            class="h-9 px-3.5 rounded-xl border text-[12.5px] font-medium transition-colors ${
              isAct
                ? "bg-zinc-100 border-zinc-100 text-zinc-950 font-semibold"
                : "bg-bg border-white/[0.07] text-zinc-300"
            }"
          >
            ${Number(d) === 0 ? "Không giới hạn" : `${d} ngày`}
          </button>
        `;
      })
      .join("");
  }

  const nets = normalizeCryptoNetworks(state.shop?.payments?.cryptoNetworks);
  const cryptoWrap = $("apikey-crypto-btns");
  if (cryptoWrap) {
    cryptoWrap.innerHTML = nets
      .map(
        (net) =>
          `<button type="button" data-action="open-bot-param" data-arg="apikey" class="h-10 px-3 rounded-xl bg-elevated hover:bg-subtle border border-white/[0.08] text-zinc-200 font-medium text-[13px]">USDT ${escapeHtml(net.label)}</button>`,
      )
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
    tokens = Number(s.replace(/[.,]/g, ""));
  }
  if (!Number.isFinite(tokens) || tokens < 1_000_000) {
    return { ok: false, error: "Tối thiểu 1M token (ví dụ: 10m, 100m, 1b)." };
  }
  if (maxTokens && tokens > maxTokens) {
    return { ok: false, error: `Tối đa ${formatTokensCompact(maxTokens)} token.` };
  }
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
      errEl.textContent = parsed?.error || "Số lượng token không hợp lệ";
      errEl.classList.remove("hidden");
    }
    setEl("apikey-quote-spec", "—");
    setEl("apikey-quote-mult", "—");
    setEl("apikey-quote-usd", "...");
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
  const totalUsd = ceilCents((tokens / 1_000_000) * perM * rpmMult * daysMult);
  const totalVnd = Math.round(totalUsd * usdVndRate());
  state.lastApikeyPriceVnd = totalVnd;

  setEl(
    "apikey-quote-spec",
    `${formatTokensCompact(tokens)} · ${rpm} RPM · ${days === 0 ? "Vĩnh viễn" : `${days}d`}`,
  );
  setEl("apikey-quote-mult", `×${rpmMult.toFixed(2)} · ×${daysMult.toFixed(2)}`);
  setEl("apikey-quote-usd", formatUsd(totalUsd));
  setEl("apikey-quote-vnd", formatVnd(totalVnd));
}

// ============================================================================
// TAB 3: WALLET PAGE (1:1 WalletPage.jsx)
// ============================================================================

function renderWalletTab() {
  const rate = usdVndRate();
  setEl("wallet-rate-label", `1 USD ≈ ${formatVnd(rate)}`);
  setEl("sidebar-rate", `${formatVnd(rate)}/$`);

  const vndPresets = [50000, 100000, 200000, 500000, 1000000];
  const vndWrap = $("wallet-vnd-presets");
  if (vndWrap) {
    vndWrap.innerHTML = vndPresets
      .map((val) => {
        const selected = Number(state.amountVnd) === val;
        return `
          <button
            type="button"
            data-action="select-wallet-vnd"
            data-arg="${val}"
            class="h-10 rounded-xl border text-[12.5px] font-mono tabular transition-colors ${
              selected
                ? "bg-zinc-100 border-zinc-100 text-zinc-950 font-semibold"
                : "bg-bg border-white/[0.07] text-zinc-300 hover:border-white/20"
            }"
          >
            ${escapeHtml(formatVnd(val))}
          </button>
        `;
      })
      .join("");
  }

  const vndInput = $("deposit-vnd-input");
  if (vndInput && vndInput.value !== String(state.amountVnd)) {
    vndInput.value = String(state.amountVnd);
  }

  const nets = normalizeCryptoNetworks(state.shop?.payments?.cryptoNetworks);
  const netWrap = $("wallet-crypto-nets");
  if (netWrap) {
    toggleHidden("wallet-crypto-nets", state.depositTab !== "crypto" || !nets.length);
    netWrap.innerHTML = nets
      .map((net) => {
        const active = state.selectedNet === net.key;
        return `
          <button
            type="button"
            data-action="select-wallet-net"
            data-arg="${escapeAttr(net.key)}"
            class="flex-1 h-9 rounded-xl border text-[12.5px] font-mono transition-colors ${
              active
                ? "bg-zinc-100 border-zinc-100 text-zinc-950 font-semibold"
                : "bg-bg border-white/[0.07] text-zinc-300"
            }"
          >
            ${escapeHtml(net.label)}
          </button>
        `;
      })
      .join("");
  }

  const usdtWrap = $("wallet-usdt-presets");
  if (usdtWrap) {
    usdtWrap.innerHTML = [2, 5, 10, 25]
      .map((u) => {
        const selected = Number(state.amountUsdt) === u;
        return `
          <button
            type="button"
            data-action="select-wallet-usdt"
            data-arg="${u}"
            class="h-10 rounded-xl border text-[12.5px] font-mono tabular transition-colors ${
              selected
                ? "bg-zinc-100 border-zinc-100 text-zinc-950 font-semibold"
                : "bg-bg border-white/[0.07] text-zinc-300"
            }"
          >
            ${u} USDT
          </button>
        `;
      })
      .join("");
  }

  const usdtInput = $("deposit-usdt-input");
  if (usdtInput && usdtInput.value !== String(state.amountUsdt)) {
    usdtInput.value = String(state.amountUsdt);
  }
  setEl(
    "deposit-usdt-label",
    `Số lượng USDT (≈ ${formatVnd(Number(state.amountUsdt || 0) * rate)})`,
  );

  ["vietqr", "crypto", "cryptopay"].forEach((t) => {
    const btn = $(`wallet-tab-${t}`);
    if (btn) {
      btn.className = `h-9 rounded-lg text-[12.5px] transition-colors ${
        state.depositTab === t ? "bg-zinc-100 text-zinc-950 font-semibold" : "text-zinc-400 font-medium"
      }`;
    }
  });

  toggleHidden("wallet-view-vietqr", state.depositTab !== "vietqr");
  toggleHidden("wallet-view-crypto", state.depositTab === "vietqr");
}

// ============================================================================
// TAB 5: PROFILE PAGE (1:1 ProfilePage.jsx)
// ============================================================================

function renderProfileTab() {
  const s = state.shop || {};
  const u = state.authUser;
  const vip = state.vipInfo;
  const botUser = s.botUsername || s.supportUsername || "ShopAccountsPreBot";
  const supUser = s.supportUsername || s.botUsername || "";

  if (u) {
    setEl("profile-name", u.firstName || (u.username ? `@${u.username}` : `User ${u.telegramId}`));
    setEl("profile-bot-tag", u.username ? `@${u.username} · ID ${u.telegramId}` : `ID ${u.telegramId}`);
    setEl("profile-vip-badge", `VIP ${vip?.level ?? u.vipLevel ?? 0} · ${vip?.name || "Thường"}`);
    setEl("profile-spent-label", `Tổng chi tiêu: ${formatVnd(u.totalSpent || 0)}`);
    setEl("profile-vip-pct", `−${vip?.discountPercent || 0}%`);
    setEl("profile-ref-pts", `${u.referralPoints || 0} pts`);
    const bar = $("profile-vip-bar");
    if (bar) bar.style.width = `${Math.max(4, Math.min(100, Number(vip?.progress ?? 4)))}%`;
    setEl(
      "profile-vip-hint",
      vip?.nextLevel
        ? `Còn ${formatVnd(vip.remaining || 0)} để lên ${vip.nextLevel.name} (−${vip.nextLevel.discountPercent}%)`
        : "Đã đồng bộ tài khoản Telegram.",
    );
    setEl("ref-link-box", `https://t.me/${botUser}?start=ref${u.telegramId}`);
  } else {
    setEl("profile-name", "Khách hàng");
    setEl("profile-bot-tag", `@${botUser}`);
    setEl("profile-vip-badge", "VIP 0 · Thường");
    setEl("profile-spent-label", "Tổng chi tiêu: 0đ");
    setEl("profile-vip-pct", "−0%");
    setEl("profile-ref-pts", "0 pts");
    const bar = $("profile-vip-bar");
    if (bar) bar.style.width = "4%";
    setEl("profile-vip-hint", "Đăng nhập Telegram để đồng bộ cấp VIP, số dư Ví & danh sách API Key của bạn.");
    setEl("ref-link-box", `https://t.me/${botUser}?start=ref`);
  }

  toggleHidden("profile-login-btn", Boolean(u));
  toggleHidden("profile-logout-btn", !u);

  const ref = state.referral;
  if (ref?.enabled) {
    const friendM = formatTokensCompact(ref.inviteTokenAmount || 20_000_000);
    const minM = formatTokensCompact(ref.inviteReferrerMinTokens || 2_000_000);
    const maxM = formatTokensCompact(ref.inviteReferrerMaxTokens || 7_000_000);
    const perPt = formatTokensCompact(ref.tokenPerPoint || 10_000_000);
    setHtml(
      "ref-desc",
      `Mời bạn bè tham gia để tặng bạn mới API Key <span class="text-zinc-200 font-medium">${escapeHtml(friendM)} token</span> và nhận <span class="text-zinc-200 font-medium">+${escapeHtml(minM)}–${escapeHtml(maxM)} token</span> vào Referral Key ${escapeHtml(ref.inviteReferrerKeyDays || 30)} ngày của bạn.`,
    );
    setEl("ref-rate-hint", `1 pt = ${perPt} token`);
  }

  const supBtn = $("profile-support-btn");
  if (supBtn) {
    supBtn.textContent = supUser
      ? `${tr(state.lang, "supportLabel")} (@${supUser})`
      : tr(state.lang, "supportLabel");
  }
}

function applyLanguage() {
  const l = state.lang;
  setEl("bnav-label-shop", tr(l, "tabShop"));
  setEl("bnav-label-keys", tr(l, "tabKeys"));
  setEl("bnav-label-wallet", tr(l, "tabWallet"));
  setEl("bnav-label-orders", tr(l, "tabOrders"));
  setEl("bnav-label-profile", tr(l, "tabProfile"));
  setEl("snav-label-shop", tr(l, "tabShop"));
  setEl("snav-label-keys", tr(l, "tabKeys"));
  setEl("snav-label-wallet", tr(l, "tabWallet"));
  setEl("snav-label-orders", tr(l, "tabOrders"));
  setEl("snav-label-profile", tr(l, "tabProfile"));
  setEl("lang-label", tr(l, "languageLabel"));
  updateSectionHeader();

  const searchEl = $("search-input");
  if (searchEl) searchEl.placeholder = tr(l, "searchPlaceholder");

  document.querySelectorAll("[data-lang]").forEach((btn) => {
    const active = btn.dataset.lang === l;
    btn.className = `h-7 px-3 rounded-lg text-[12px] transition-colors ${
      active ? "bg-zinc-100 text-zinc-950 font-semibold" : "text-zinc-400 font-medium"
    }`;
  });

  renderCategories();
  renderProducts();
  renderProfileTab();
}

// ============================================================================
// HELPERS
// ============================================================================

function resolveProductIconUrl(product) {
  if (product?.imageUrl) return product.imageUrl;
  if (product?.iconSlug) return `${ICON_CDN}/${product.iconSlug}/default.svg`;
  const hay = `${product?.name || ""} ${product?.code || ""} ${product?.categoryName || ""}`.toLowerCase();
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

function computeCouponDiscount(coupon, baseVnd) {
  if (!coupon || baseVnd <= 0) return 0;
  if (coupon.type === "percent") {
    let disc = Math.floor((baseVnd * coupon.value) / 100);
    if (coupon.maxDiscount > 0 && disc > coupon.maxDiscount) disc = coupon.maxDiscount;
    return Math.min(baseVnd, disc);
  }
  return Math.min(baseVnd, Math.round(coupon.value || 0));
}

function findProduct(id) {
  return state.products.find((p) => String(p.id) === String(id));
}

function usdVndRate() {
  const r = Number(state.shop?.usdVndRate || 26500);
  return Number.isFinite(r) && r > 0 ? r : 26500;
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

function openTelegramBot(startParam = "shop") {
  const s = state.shop || {};
  const target = s.botUsername || s.supportUsername;
  if (!target) {
    showToast("Chưa cấu hình bot Telegram", "error");
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
  if (!target) return;
  window.open(`https://t.me/${target}`, "_blank", "noopener,noreferrer");
}

function showError() {
  const grid = $("product-grid");
  if (grid) {
    grid.className = "rounded-2xl bg-card border border-white/[0.07] py-12 px-6 text-center space-y-2";
    grid.innerHTML = `
      <p class="text-[14px] font-medium text-zinc-300">Không thể tải sản phẩm</p>
      <button type="button" data-action="reload-catalog" class="text-[12.5px] text-zinc-400 underline underline-offset-4 hover:text-zinc-200">Thử lại</button>
    `;
  }
}

function showToast(message, type = "info") {
  const area = $("toast-area");
  if (!area) return;
  const el = document.createElement("div");
  const dotCls =
    type === "error" ? "bg-rose-400" : type === "success" ? "bg-emerald-400" : "bg-zinc-400";
  const borderCls =
    type === "error"
      ? "bg-zinc-900/95 border-rose-500/30 text-zinc-100"
      : "bg-zinc-900/95 border-white/10 text-zinc-100";

  el.className = `pointer-events-auto max-w-sm w-full px-4 py-3 rounded-xl border text-[13px] font-medium shadow-2xl backdrop-blur-xl animate-fade-in flex items-center gap-2.5 ${borderCls}`;
  el.innerHTML = `<span class="w-2 h-2 rounded-full shrink-0 ${dotCls}"></span><span class="leading-snug flex-1">${escapeHtml(message)}</span>`;
  area.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 2800);
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

function debounce(fn, wait = 140) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

// ============================================================================
// CSP-FRIENDLY EVENT DELEGATION
// ============================================================================

const _debouncedRenderProducts = debounce(() => renderProducts(), 140);

const SHOP_ACTIONS = {
  "switch-tab": (arg) => switchTab(arg || "shop"),
  "select-category": (arg) => {
    state.selectedCategory = arg || "";
    renderCategories();
    renderProducts();
  },
  "reset-filters": () => {
    state.selectedCategory = "";
    state.search = "";
    const sEl = $("search-input");
    if (sEl) sEl.value = "";
    renderCategories();
    renderProducts();
  },
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
    renderModalSummary();
  },
  "modal-qty-inc": () => {
    state.modalQty += 1;
    renderModalSummary();
  },
  "modal-set-qty": (arg) => {
    state.modalQty = Math.max(1, Number(arg) || 1);
    renderModalSummary();
  },
  "apply-modal-coupon": () => applyModalCoupon(),
  "buy-now-from-modal": () => {
    const p = state.selectedProduct;
    if (!p) return;
    if (state.modalCoupon?.code && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(state.modalCoupon.code).catch(() => {});
      showToast(`Đã sao chép mã ${state.modalCoupon.code}`, "success");
    }
    openTelegramBot(`product_${p.id}`);
  },
  "modal-go-topup": () => {
    const p = state.selectedProduct;
    if (p) {
      const need = Math.max(10000, Math.ceil((productPriceVnd(p) * state.modalQty) / 1000) * 1000);
      state.amountVnd = String(need);
      renderWalletTab();
    }
    closeProductModal();
    switchTab("wallet");
  },
  "switch-keys-sub": (arg) => switchKeysSubTab(arg),
  "select-apikey-profile": (arg) => {
    const p = state.apiKeyProfiles.find((x) => Number(x.profileId) === Number(arg));
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
  "apikey-go-topup": () => {
    if (state.lastApikeyPriceVnd >= 10000) {
      state.amountVnd = String(Math.ceil(state.lastApikeyPriceVnd / 1000) * 1000);
      renderWalletTab();
    }
    switchTab("wallet");
  },
  "switch-wallet-tab": (arg) => {
    state.depositTab = arg || "vietqr";
    renderWalletTab();
  },
  "select-wallet-vnd": (arg) => {
    state.amountVnd = String(arg || "100000");
    renderWalletTab();
  },
  "select-wallet-net": (arg) => {
    state.selectedNet = arg;
    renderWalletTab();
  },
  "select-wallet-usdt": (arg) => {
    state.amountUsdt = String(arg || "5");
    renderWalletTab();
  },
  "redeem-giftcode": () => {
    const input = $("giftcode-input");
    const code = input?.value?.trim();
    if (!code) {
      showToast("Vui lòng nhập mã Giftcode", "error");
      return;
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code).catch(() => {});
    }
    openTelegramBot("shop");
  },
  "go-login": () => {
    switchTab("keys");
    switchKeysSubTab("mine");
  },
  "go-mykeys": () => {
    switchTab("keys");
    switchKeysSubTab("mine");
  },
  "start-web-login": () => startWebLogin(),
  "cancel-web-login": () => {
    stopWebLoginPolling();
    renderMyKeysAuthUI();
  },
  "login-with-apikey": () => loginWithApiKey(),
  "web-logout": () => webLogout(),
  "select-mykey-filter": (arg) => loadMyKeys(arg || "all"),
  "refresh-mykeys": () => loadMyKeys(state.myKeysFilter),
  "copy-mykeys-endpoint": () => {
    const url = state.myKeysData?.endpoint || "";
    if (!url) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
    showToast("Đã sao chép API Base URL", "success");
  },
  "copy-mykey": (arg) => copySingleKey(arg),
  "toggle-mykey-reveal": (arg) => toggleRevealSingleKey(arg),
  "toggle-reveal-all-keys": () => toggleRevealAllKeys(),
  "export-keys-copy": () => exportKeys("copy"),
  "export-keys-txt": () => exportKeys("txt"),
  "export-keys-csv": () => exportKeys("csv"),
  "export-keys-json": () => exportKeys("json"),
  "refresh-orders": () => {
    if (isAuthenticated()) loadOrders();
    else {
      switchTab("keys");
      switchKeysSubTab("mine");
    }
  },
  "select-order-filter": (arg) => {
    state.orderFilter = arg || "ALL";
    document.querySelectorAll("#order-filters button").forEach((btn) => {
      const active = btn.dataset.arg === state.orderFilter;
      btn.className = `h-8 px-3.5 rounded-full text-[12.5px] font-medium whitespace-nowrap transition-colors ${
        active
          ? "bg-zinc-100 text-zinc-950"
          : "bg-card border border-white/[0.07] text-zinc-400 hover:text-zinc-200"
      }`;
    });
    if (isAuthenticated()) loadOrders();
  },
  "copy-ref-link": () => {
    const link = $("ref-link-box")?.textContent?.trim();
    if (!link) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link).catch(() => {});
    }
    showToast("Đã sao chép liên kết mời", "success");
  },
  "share-ref-link": () => {
    const link = $("ref-link-box")?.textContent?.trim() || "";
    const text = "Tham gia nhận ngay API Key AI miễn phí và tài khoản số tự động.";
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  },
  "switch-ref-mode": (arg) => {
    state.redeemMode = arg === "topup" ? "topup" : "newkey";
    const btnNew = $("ref-mode-newkey");
    const btnTop = $("ref-mode-topup");
    if (btnNew) {
      btnNew.className = `h-8 rounded-lg text-[12px] transition-colors ${
        state.redeemMode === "newkey" ? "bg-zinc-100 text-zinc-950 font-semibold" : "text-zinc-400 font-medium"
      }`;
    }
    if (btnTop) {
      btnTop.className = `h-8 rounded-lg text-[12px] transition-colors ${
        state.redeemMode === "topup" ? "bg-zinc-100 text-zinc-950 font-semibold" : "text-zinc-400 font-medium"
      }`;
    }
  },
  "set-device-mode": (arg) => {
    state.deviceMode = ["auto", "pc", "tablet", "mobile"].includes(arg) ? arg : "auto";
    try { localStorage.setItem("shop-device-mode", state.deviceMode); } catch {}
    applyDeviceMode();
  },
  "set-lang": (arg) => {
    state.lang = ["vi", "en", "zh"].includes(arg) ? arg : "vi";
    try { localStorage.setItem("shop-lang", state.lang); } catch {}
    applyLanguage();
    showToast("Đã lưu tùy chọn ngôn ngữ", "success");
  },
  "open-bot": () => openTelegramBot("shop"),
  "open-bot-param": (arg) => openTelegramBot(arg || "shop"),
  "contact-admin": () => openSupportTelegram(),
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
    state.search = el.value;
    _debouncedRenderProducts();
  } else if (type === "mykeys-search") {
    state.myKeysSearch = el.value;
    renderMyKeys();
  } else if (type === "modal-coupon" || type === "giftcode") {
    el.value = el.value.toUpperCase();
  } else if (type === "apikey-tokens") {
    state.apikeyTokensInput = el.value;
    updateApiKeyQuote();
  } else if (type === "deposit-vnd") {
    state.amountVnd = el.value;
  } else if (type === "deposit-usdt") {
    state.amountUsdt = el.value;
    setEl(
      "deposit-usdt-label",
      `Số lượng USDT (≈ ${formatVnd(Number(state.amountUsdt || 0) * usdVndRate())})`,
    );
  }
});

document.addEventListener("change", (ev) => {
  const el = ev.target;
  if (el.dataset?.input === "sort") {
    state.sortBy = el.value;
    renderProducts();
  }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") closeProductModal();
});

document.addEventListener(
  "error",
  (ev) => {
    const img = ev.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (img.dataset?.fallback !== "monogram") return;
    const span = document.createElement("span");
    span.className = "font-mono text-[11px] font-semibold text-zinc-300";
    span.textContent = img.dataset.monogram || "SP";
    img.replaceWith(span);
  },
  true,
);
