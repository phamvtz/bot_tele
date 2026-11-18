import React, { useEffect, useState } from "react";
import {
  Wallet,
  QrCode,
  Coins,
  Gift,
  ArrowDownLeft,
  ArrowUpRight,
  RotateCcw,
  Loader2,
} from "lucide-react";
import { tmaFetch } from "../lib/api.js";
import { formatVnd, formatUsd, formatDateTime, formatTokensCompact } from "../lib/format.js";
import { hapticImpact, hapticNotify } from "../lib/telegram.js";
import { useToast } from "../components/Toast.jsx";

export default function WalletPage({
  shop,
  initialSuggestedVnd = 0,
  onPendingPayment,
  onGiftKeyReceived,
  onBalanceChanged,
}) {
  const [walletData, setWalletData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [depositTab, setDepositTab] = useState("vietqr");
  const [amountVnd, setAmountVnd] = useState("100000");
  const [amountUsdt, setAmountUsdt] = useState("5");
  const [selectedNet, setSelectedNet] = useState("");
  const [creatingDeposit, setCreatingDeposit] = useState(false);

  const [giftInput, setGiftInput] = useState("");
  const [redeemingGift, setRedeemingGift] = useState(false);

  const { showToast } = useToast();

  const loadWallet = async () => {
    setLoading(true);
    try {
      const res = await tmaFetch("/wallet");
      setWalletData(res);
      onBalanceChanged?.(res.balanceVnd);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWallet();
  }, []);

  useEffect(() => {
    if (initialSuggestedVnd >= 10000) {
      const rounded = Math.ceil(initialSuggestedVnd / 1000) * 1000;
      setAmountVnd(String(rounded));
    }
  }, [initialSuggestedVnd]);

  const cryptoNetworks = shop?.payments?.cryptoNetworks || [];
  useEffect(() => {
    if (!selectedNet && cryptoNetworks.length > 0) {
      setSelectedNet(cryptoNetworks[0].key);
    }
  }, [cryptoNetworks, selectedNet]);

  const rate = walletData?.usdVndRate || shop?.usdVndRate || 26500;
  const balance = walletData?.balanceVnd ?? 0;
  const presets = walletData?.presetsVnd?.length
    ? walletData.presetsVnd
    : [50000, 100000, 200000, 500000, 1000000];

  const handleCreateDeposit = async () => {
    hapticImpact("medium");
    setCreatingDeposit(true);
    try {
      let body;
      if (depositTab === "vietqr") {
        const clean = Number(String(amountVnd).replace(/[.,\s]/g, ""));
        body = { method: "vietqr", amountVnd: clean };
      } else if (depositTab === "crypto") {
        body = {
          method: `crypto_${selectedNet}`,
          amountUsdt: Number(String(amountUsdt).replace(",", ".")),
        };
      } else {
        body = {
          method: "cryptopay",
          amountUsdt: Number(String(amountUsdt).replace(",", ".")),
        };
      }

      const res = await tmaFetch("/wallet/deposit", { method: "POST", body });
      if (res.payment) {
        onPendingPayment?.({
          mode: "deposit",
          targetId: res.depositId,
          title: `Nạp Ví +${formatVnd(res.amountVnd)}`,
          amountVnd: res.amountVnd,
          payment: res.payment,
        });
      }
    } catch (err) {
      if (err.code !== "CHANNEL_JOIN_REQUIRED") {
        showToast(err.message, "error");
      }
    } finally {
      setCreatingDeposit(false);
    }
  };

  const handleRedeemGift = async (e) => {
    e.preventDefault();
    if (!giftInput.trim()) return;
    hapticImpact("medium");
    setRedeemingGift(true);
    try {
      const res = await tmaFetch("/giftcode/redeem", {
        method: "POST",
        body: { code: giftInput.trim() },
      });
      hapticNotify("success");
      setGiftInput("");
      if (res.rewardType === "APIKEY" && res.key) {
        onGiftKeyReceived?.({
          title: `🎁 Đổi Giftcode ${res.code} thành công!`,
          apiKey: {
            key: res.key,
            quotaTokens: res.quotaTokens,
            rpm: res.rpm,
            expiresAt: res.expiresAt,
          },
        });
      } else {
        showToast(`🎉 Đã cộng +${formatVnd(res.amountVnd)} vào Ví của bạn!`, "success");
        loadWallet();
      }
    } catch (err) {
      if (err.code !== "CHANNEL_JOIN_REQUIRED") {
        hapticNotify("error");
        showToast(err.message, "error");
      }
    } finally {
      setRedeemingGift(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Hero Card Số Dư */}
      <div className="rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-slate-900 p-5 border border-indigo-400/30 shadow-xl">
        <div className="flex items-center justify-between text-indigo-200 text-xs font-medium mb-1">
          <span className="flex items-center gap-1.5">
            <Wallet className="w-4 h-4" /> SỐ DƯ VÍ NỘI BỘ
          </span>
          <span>1$ ≈ {formatVnd(rate)}</span>
        </div>
        <div className="text-2xl font-extrabold text-white tracking-tight">
          {formatVnd(balance)}
        </div>
        <div className="text-xs text-indigo-200/90 mt-0.5">
          Tương đương ≈ {formatUsd(balance / rate)}
        </div>
      </div>

      {/* Khu vực Nạp Tiền */}
      <div className="rounded-2xl bg-surface-card border border-white/10 p-4 space-y-3.5">
        <h2 className="text-sm font-bold text-white">Nạp tiền tự động 24/7</h2>

        <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-canvas-900 border border-white/5">
          <button
            type="button"
            onClick={() => setDepositTab("vietqr")}
            className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 ${
              depositTab === "vietqr" ? "bg-indigo-600 text-white" : "text-slate-400"
            }`}
          >
            <QrCode className="w-3.5 h-3.5" /> Ngân hàng
          </button>
          <button
            type="button"
            disabled={cryptoNetworks.length === 0}
            onClick={() => setDepositTab("crypto")}
            className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 disabled:opacity-40 ${
              depositTab === "crypto" ? "bg-indigo-600 text-white" : "text-slate-400"
            }`}
          >
            <Coins className="w-3.5 h-3.5" /> USDT
          </button>
          <button
            type="button"
            disabled={!shop?.payments?.cryptopay}
            onClick={() => setDepositTab("cryptopay")}
            className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 disabled:opacity-40 ${
              depositTab === "cryptopay" ? "bg-indigo-600 text-white" : "text-slate-400"
            }`}
          >
            CryptoBot
          </button>
        </div>

        {depositTab === "vietqr" ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {presets.slice(0, 6).map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => {
                    hapticImpact("light");
                    setAmountVnd(String(val));
                  }}
                  className={`py-2 px-2 rounded-xl border text-xs font-bold ${
                    Number(amountVnd) === val
                      ? "bg-indigo-500/20 border-indigo-400 text-indigo-200"
                      : "bg-canvas-900 border-white/10 text-slate-300"
                  }`}
                >
                  {formatVnd(val)}
                </button>
              ))}
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">
                Hoặc nhập số tiền VND (tối thiểu 10.000đ)
              </label>
              <input
                type="number"
                min="10000"
                step="1000"
                value={amountVnd}
                onChange={(e) => setAmountVnd(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-canvas-900 border border-white/10 text-sm font-bold text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {depositTab === "crypto" && cryptoNetworks.length > 0 && (
              <div className="flex gap-2">
                {cryptoNetworks.map((net) => (
                  <button
                    key={net.key}
                    type="button"
                    onClick={() => setSelectedNet(net.key)}
                    className={`flex-1 py-2 rounded-xl border text-xs font-bold ${
                      selectedNet === net.key
                        ? "bg-emerald-500/20 border-emerald-400 text-emerald-200"
                        : "bg-canvas-900 border-white/10 text-slate-300"
                    }`}
                  >
                    {net.label}
                  </button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-4 gap-2">
              {[2, 5, 10, 25].map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setAmountUsdt(String(u))}
                  className={`py-2 rounded-xl border text-xs font-bold ${
                    Number(amountUsdt) === u
                      ? "bg-emerald-500/20 border-emerald-400 text-emerald-200"
                      : "bg-canvas-900 border-white/10 text-slate-300"
                  }`}
                >
                  {u} USDT
                </button>
              ))}
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">
                Nhập số USDT muốn nạp (≈ {formatVnd(Number(amountUsdt || 0) * rate)})
              </label>
              <input
                type="number"
                min="0.1"
                step="0.5"
                value={amountUsdt}
                onChange={(e) => setAmountUsdt(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-canvas-900 border border-white/10 text-sm font-bold text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>
        )}

        <button
          type="button"
          disabled={creatingDeposit}
          onClick={handleCreateDeposit}
          className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/25 disabled:opacity-50"
        >
          {creatingDeposit && <Loader2 className="w-4 h-4 animate-spin" />}
          Tạo mã thanh toán Nạp Ví
        </button>
      </div>

      {/* Đổi Giftcode */}
      <form
        onSubmit={handleRedeemGift}
        className="rounded-2xl bg-surface-card border border-white/10 p-4 space-y-2.5"
      >
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <Gift className="w-4 h-4 text-pink-400" />
          <span>Nhập Giftcode nhận Tiền Ví / API Key</span>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={giftInput}
            onChange={(e) => setGiftInput(e.target.value.toUpperCase())}
            placeholder="Nhập mã quà tặng (VD: GIFT2026)..."
            className="flex-1 px-3.5 py-2.5 rounded-xl bg-canvas-900 border border-white/10 text-xs font-mono text-white placeholder:text-slate-500 focus:outline-none focus:border-pink-500"
          />
          <button
            type="submit"
            disabled={redeemingGift || !giftInput.trim()}
            className="px-4 py-2.5 rounded-xl bg-pink-600 hover:bg-pink-500 text-white text-xs font-bold shrink-0 disabled:opacity-40"
          >
            {redeemingGift ? "Đang mở..." : "Đổi quà"}
          </button>
        </div>
      </form>

      {/* Lịch sử biến động */}
      <div className="rounded-2xl bg-surface-card border border-white/10 p-4 space-y-3">
        <h3 className="text-sm font-bold text-white">Lịch sử giao dịch Ví</h3>
        {loading ? (
          <div className="text-xs text-slate-400 py-4 text-center">Đang tải lịch sử...</div>
        ) : !walletData?.transactions?.length ? (
          <div className="text-xs text-slate-500 py-4 text-center">Chưa có giao dịch nào.</div>
        ) : (
          <div className="divide-y divide-white/5">
            {walletData.transactions.map((tx) => {
              const isPlus = ["DEPOSIT", "REFUND", "ADMIN_ADD", "GIFTCODE"].includes(tx.type) && tx.amount > 0;
              return (
                <div key={tx.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                        tx.type === "REFUND"
                          ? "bg-sky-500/15 text-sky-400"
                          : isPlus
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-rose-500/15 text-rose-400"
                      }`}
                    >
                      {tx.type === "REFUND" ? (
                        <RotateCcw className="w-4 h-4" />
                      ) : isPlus ? (
                        <ArrowDownLeft className="w-4 h-4" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-200 truncate">
                        {tx.description || tx.type}
                      </div>
                      <div className="text-[10px] text-slate-500">{formatDateTime(tx.createdAt)}</div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className={`text-xs font-bold ${
                        tx.status !== "SUCCESS"
                          ? "text-amber-400"
                          : isPlus
                            ? "text-emerald-400"
                            : "text-slate-200"
                      }`}
                    >
                      {isPlus ? "+" : "−"}
                      {formatVnd(Math.abs(tx.amount))}
                    </div>
                    <div className="text-[10px] text-slate-500">{tx.status}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
