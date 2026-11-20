import React, { useCallback, useEffect, useState } from "react";
import {
  initTelegramApp,
  getRawInitData,
  getStartParam,
  getWebApp,
  openTelegramUrl,
} from "./lib/telegram.js";
import { tmaFetch, onChannelGateRequired, getSavedSessionToken } from "./lib/api.js";
import { tr } from "./lib/i18n.js";
import { ToastProvider, useToast } from "./components/Toast.jsx";
import BottomNav from "./components/BottomNav.jsx";
import ChannelGateSheet from "./components/ChannelGateSheet.jsx";
import PaymentSheet from "./components/PaymentSheet.jsx";
import DeliverySuccessModal from "./components/DeliverySuccessModal.jsx";
import ProductDetailSheet from "./components/ProductDetailSheet.jsx";
import ShopPage from "./pages/ShopPage.jsx";
import ApiKeysPage from "./pages/ApiKeysPage.jsx";
import WalletPage from "./pages/WalletPage.jsx";
import OrdersPage from "./pages/OrdersPage.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";

function MiniAppShell() {
  const [booting, setBooting] = useState(true);
  const [outsideTelegram, setOutsideTelegram] = useState(false);
  const [publicBotUsername, setPublicBotUsername] = useState("");
  const [authData, setAuthData] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [flashSales, setFlashSales] = useState([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);

  const [activeTab, setActiveTab] = useState("shop");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [paymentSession, setPaymentSession] = useState(null);
  const [deliveryModal, setDeliveryModal] = useState(null);
  const [channelGate, setChannelGate] = useState(null);
  const [suggestedTopupVnd, setSuggestedTopupVnd] = useState(0);
  const [keysSubTab, setKeysSubTab] = useState("buy");
  const [renewKeyId, setRenewKeyId] = useState("");
  const [handledStartParam, setHandledStartParam] = useState(false);

  const { showToast } = useToast();
  const lang = authData?.user?.language || "vi";
  const balanceVnd = authData?.balance ?? 0;

  useEffect(() => {
    initTelegramApp();
    onChannelGateRequired((gatePayload) => {
      setChannelGate(gatePayload);
    });
  }, []);

  const loadShopAndFlash = useCallback(async () => {
    setLoadingCatalog(true);
    try {
      const [catRes, flashRes] = await Promise.all([
        tmaFetch("/catalog"),
        tmaFetch("/flash-sales").catch(() => ({ sales: [] })),
      ]);
      setCatalog(catRes);
      setFlashSales(flashRes.sales || []);
      return catRes;
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  const bootstrap = useCallback(async () => {
    setBooting(true);
    const rawInit = getRawInitData();
    const savedSess = getSavedSessionToken();

    if (!rawInit && !savedSess) {
      setOutsideTelegram(true);
      try {
        const pub = await fetch("/api/shop/catalog").then((r) => r.json());
        if (pub?.shop?.botUsername) setPublicBotUsername(pub.shop.botUsername);
      } catch {}
      setBooting(false);
      return;
    }

    try {
      const startParam = getStartParam();
      const auth = await tmaFetch("/auth", {
        method: "POST",
        body: { startParam },
      });
      setAuthData(auth);
      setOutsideTelegram(false);
      const cat = await loadShopAndFlash();

      const sp = startParam || auth.startParam || "";
      if (sp && !handledStartParam) {
        setHandledStartParam(true);
        if (sp.startsWith("product_")) {
          const pid = sp.replace("product_", "");
          const target = (cat?.products || []).find((p) => String(p.id) === pid);
          if (target) setSelectedProduct(target);
        } else if (sp.startsWith("renew_")) {
          setRenewKeyId(sp.replace("renew_", ""));
          setKeysSubTab("mine");
          setActiveTab("keys");
        } else if (sp === "apikey" || sp === "mykey" || sp === "api") {
          setKeysSubTab(sp === "mykey" ? "mine" : sp === "api" ? "api" : "buy");
          setActiveTab("keys");
        } else if (sp === "wallet") {
          setActiveTab("wallet");
        } else if (sp.startsWith("ref")) {
          setActiveTab("profile");
        }
      }
    } catch (err) {
      if (err.status === 401) {
        setOutsideTelegram(true);
      } else {
        showToast(err.message, "error");
      }
    } finally {
      setBooting(false);
    }
  }, [handledStartParam, loadShopAndFlash, showToast]);

  useEffect(() => {
    bootstrap();
  }, []);

  useEffect(() => {
    const twa = getWebApp();
    const bb = twa?.BackButton;
    if (!bb) return undefined;

    const hasOverlay = Boolean(
      channelGate || deliveryModal || paymentSession || selectedProduct || activeTab !== "shop",
    );

    if (hasOverlay) bb.show();
    else bb.hide();

    const onBack = () => {
      if (channelGate) setChannelGate(null);
      else if (deliveryModal) setDeliveryModal(null);
      else if (paymentSession) setPaymentSession(null);
      else if (selectedProduct) setSelectedProduct(null);
      else if (activeTab !== "shop") setActiveTab("shop");
    };

    bb.onClick(onBack);
    return () => {
      bb.offClick(onBack);
    };
  }, [channelGate, deliveryModal, paymentSession, selectedProduct, activeTab]);

  const updateBalance = (newBal) => {
    if (typeof newBal === "number") {
      setAuthData((prev) => (prev ? { ...prev, balance: newBal } : prev));
    }
  };

  const handleChangeLanguage = async (newLang) => {
    try {
      await tmaFetch("/preferences", {
        method: "PATCH",
        body: { language: newLang },
      });
      setAuthData((prev) =>
        prev ? { ...prev, user: { ...prev.user, language: newLang } } : prev,
      );
      showToast("Đã lưu tùy chọn ngôn ngữ", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  if (booting) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center gap-3">
        <div className="w-5 h-5 rounded-full border-2 border-zinc-700 border-t-zinc-100 animate-spin" />
        <p className="text-[12.5px] text-zinc-500">Đang tải cửa hàng...</p>
      </div>
    );
  }

  if (outsideTelegram) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-sm w-full rounded-2xl bg-card border border-white/[0.08] p-6 text-center space-y-4">
          <h1 className="text-[18px] font-semibold tracking-[-0.02em] text-zinc-100">
            {tr("vi", "openInTelegramTitle")}
          </h1>
          <p className="text-[13px] text-zinc-400 leading-relaxed">
            {tr("vi", "openInTelegramDesc")}
          </p>
          {publicBotUsername && (
            <button
              type="button"
              onClick={() => openTelegramUrl(`https://t.me/${publicBotUsername}`)}
              className="w-full h-11 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-[14px] transition-colors"
            >
              Mở @{publicBotUsername}
            </button>
          )}
        </div>
      </div>
    );
  }

  const shopMeta = catalog?.shop || authData?.shop;

  return (
    <div className="min-h-screen max-w-lg mx-auto px-4 pt-3 pb-safe-nav">
      {activeTab === "shop" && (
        <ShopPage
          catalog={catalog}
          flashSales={flashSales}
          balanceVnd={balanceVnd}
          vip={authData?.vip}
          lang={lang}
          loading={loadingCatalog}
          onSelectProduct={(p) => setSelectedProduct(p)}
          onRefreshFlash={loadShopAndFlash}
          onGoWallet={() => setActiveTab("wallet")}
          onGoKeys={() => {
            setKeysSubTab("buy");
            setActiveTab("keys");
          }}
        />
      )}

      {activeTab === "keys" && (
        <ApiKeysPage
          shop={shopMeta}
          balanceVnd={balanceVnd}
          initialSubTab={keysSubTab}
          initialRenewKeyId={renewKeyId}
          onKeyDelivered={(payload) => {
            if (typeof payload.newBalance === "number") updateBalance(payload.newBalance);
            setDeliveryModal(payload);
          }}
          onPendingPayment={(sess) => setPaymentSession(sess)}
          onGoTopup={(shortfall) => {
            setSuggestedTopupVnd(shortfall || 0);
            setActiveTab("wallet");
          }}
        />
      )}

      {activeTab === "wallet" && (
        <WalletPage
          shop={shopMeta}
          initialSuggestedVnd={suggestedTopupVnd}
          onBalanceChanged={updateBalance}
          onPendingPayment={(sess) => setPaymentSession(sess)}
          onGiftKeyReceived={(payload) => setDeliveryModal(payload)}
        />
      )}

      {activeTab === "orders" && (
        <OrdersPage
          onOpenDelivery={(payload) => setDeliveryModal(payload)}
          onResumePayment={(sess) => setPaymentSession(sess)}
        />
      )}

      {activeTab === "profile" && (
        <ProfilePage
          user={authData?.user}
          shop={shopMeta}
          lang={lang}
          onChangeLanguage={handleChangeLanguage}
          onRewardKeyReceived={(payload) => setDeliveryModal(payload)}
          onOpenDeveloperApi={() => {
            setKeysSubTab("api");
            setActiveTab("keys");
          }}
        />
      )}

      <BottomNav activeTab={activeTab} onChange={setActiveTab} lang={lang} />

      <ProductDetailSheet
        product={selectedProduct}
        shop={shopMeta}
        balanceVnd={balanceVnd}
        onClose={() => setSelectedProduct(null)}
        onOrderDelivered={(payload) => {
          setSelectedProduct(null);
          if (typeof payload.newBalance === "number") updateBalance(payload.newBalance);
          loadShopAndFlash();
          setDeliveryModal(payload);
        }}
        onPendingPayment={(sess) => {
          setSelectedProduct(null);
          setPaymentSession(sess);
        }}
        onGoTopup={(shortfall) => {
          setSuggestedTopupVnd(shortfall || 0);
          setActiveTab("wallet");
        }}
      />

      <PaymentSheet
        session={paymentSession}
        lang={lang}
        onClose={() => setPaymentSession(null)}
        onCanceled={() => setPaymentSession(null)}
        onCompleted={(done) => {
          setPaymentSession(null);
          if (done.mode === "deposit") {
            if (typeof done.balanceVnd === "number") updateBalance(done.balanceVnd);
            showToast("Nạp ví thành công", "success");
          } else {
            loadShopAndFlash();
            setDeliveryModal({
              orderId: done.orderId,
              shortId: done.shortId,
              title: done.title || "Giao dịch hoàn tất",
              deliveryContent: done.deliveryContent,
            });
          }
        }}
      />

      <DeliverySuccessModal data={deliveryModal} onClose={() => setDeliveryModal(null)} />

      <ChannelGateSheet
        gate={channelGate}
        lang={lang}
        onClose={() => setChannelGate(null)}
        onVerified={(res) => {
          setChannelGate(null);
          setAuthData((prev) =>
            prev ? { ...prev, channelGate: res.channelGate } : prev,
          );
        }}
      />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <MiniAppShell />
    </ToastProvider>
  );
}
