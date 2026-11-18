import React, { useEffect, useState } from "react";
import { tmaFetch } from "../lib/api.js";
import { formatVnd, formatUsd, formatDateTime } from "../lib/format.js";
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
          title: `Giftcode ${res.code}`,
          apiKey: {
            key: res.key,
            quotaTokens: res.quotaTokens,
            rpm: res.rpm,
            expiresAt: res.expiresAt,
          },
        });
      } else {
        showToast(`Đã cộng +${formatVnd(res.amountVnd)} vào Ví`, "success");
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
    <div className="space-y-5">
      {/* Minimal Balance Card */}
      <div className="rounded-2xl bg-card border border-white/[0.08] p-5">
        <div className="flex items-center justify-between text-[12px] text-zinc-400">
          <span>Số dư khả dụng</span>
          <span className="font-mono">1 USD ≈ {formatVnd(rate)}</span>
        </div>
        <div className="text-[30px] font-semibold tracking-[-0.035em] text-zinc-100 mt-1.5 font-mono tabular">
          {formatVnd(balance)}
        </div>
        <div className="text-[13px] text-zinc-500 font-mono tabular mt-0.5">
          ≈ {formatUsd(balance / rate)}
        </div>
      </div>

      {/* Nạp tiền */}
      <div className="rounded-2xl bg-card border border-white/[0.08] p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-zinc-100">
            Nạp tiền vào Ví
          </h2>
        </div>

        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-bg border border-white/[0.06]">
          <button
            type="button"
            onClick={() => setDepositTab("vietqr")}
            className={`h-9 rounded-lg text-[12.5px] font-medium transition-colors ${
              depositTab === "vietqr" ? "bg-zinc-100 text-zinc-950 font-semibold" : "text-zinc-400"
            }`}
          >
            Ngân hàng
          </button>
          <button
            type="button"
            disabled={cryptoNetworks.length === 0}
            onClick={() => setDepositTab("crypto")}
            className={`h-9 rounded-lg text-[12.5px] font-medium transition-colors disabled:opacity-35 ${
              depositTab === "crypto" ? "bg-zinc-100 text-zinc-950 font-semibold" : "text-zinc-400"
            }`}
          >
            USDT
          </button>
          <button
            type="button"
            disabled={!shop?.payments?.cryptopay}
            onClick={() => setDepositTab("cryptopay")}
            className={`h-9 rounded-lg text-[12.5px] font-medium transition-colors disabled:opacity-35 ${
              depositTab === "cryptopay" ? "bg-zinc-100 text-zinc-950 font-semibold" : "text-zinc-400"
            }`}
          >
            CryptoBot
          </button>
        </div>

        {depositTab === "vietqr" ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {presets.slice(0, 6).map((val) => {
                const selected = Number(amountVnd) === val;
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => {
                      hapticImpact("light");
                      setAmountVnd(String(val));
                    }}
                    className={`h-10 rounded-xl border text-[12.5px] font-mono tabular transition-colors ${
                      selected
                        ? "bg-zinc-100 border-zinc-100 text-zinc-950 font-semibold"
                        : "bg-bg border-white/[0.07] text-zinc-300 hover:border-white/20"
                    }`}
                  >
                    {formatVnd(val)}
                  </button>
                );
              })}
            </div>
            <div>
              <label
                htmlFor="deposit-vnd-input"
                className="text-[12px] text-zinc-400 block mb-1.5"
              >
                Số tiền VND (tối thiểu 10.000đ)
              </label>
              <input
                id="deposit-vnd-input"
                type="number"
                min="10000"
                step="1000"
                value={amountVnd}
                onChange={(e) => setAmountVnd(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl bg-bg border border-white/[0.08] text-[14px] font-mono font-medium text-zinc-100 tabular focus:outline-none focus:border-white/25"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {depositTab === "crypto" && cryptoNetworks.length > 0 && (
              <div className="flex gap-2">
                {cryptoNetworks.map((net) => {
                  const active = selectedNet === net.key;
                  return (
                    <button
                      key={net.key}
                      type="button"
                      onClick={() => setSelectedNet(net.key)}
                      className={`flex-1 h-9 rounded-xl border text-[12.5px] font-mono transition-colors ${
                        active
                          ? "bg-zinc-100 border-zinc-100 text-zinc-950 font-semibold"
                          : "bg-bg border-white/[0.07] text-zinc-300"
                      }`}
                    >
                      {net.label}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="grid grid-cols-4 gap-2">
              {[2, 5, 10, 25].map((u) => {
                const selected = Number(amountUsdt) === u;
                return (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setAmountUsdt(String(u))}
                    className={`h-10 rounded-xl border text-[12.5px] font-mono tabular transition-colors ${
                      selected
                        ? "bg-zinc-100 border-zinc-100 text-zinc-950 font-semibold"
                        : "bg-bg border-white/[0.07] text-zinc-300"
                    }`}
                  >
                    {u} USDT
                  </button>
                );
              })}
            </div>

            <div>
              <label
                htmlFor="deposit-usdt-input"
                className="text-[12px] text-zinc-400 block mb-1.5"
              >
                Số lượng USDT (≈ {formatVnd(Number(amountUsdt || 0) * rate)})
              </label>
              <input
                id="deposit-usdt-input"
                type="number"
                min="0.1"
                step="0.5"
                value={amountUsdt}
                onChange={(e) => setAmountUsdt(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl bg-bg border border-white/[0.08] text-[14px] font-mono font-medium text-zinc-100 tabular focus:outline-none focus:border-white/25"
              />
            </div>
          </div>
        )}

        <button
          type="button"
          disabled={creatingDeposit}
          onClick={handleCreateDeposit}
          className="w-full h-11 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-[14px] transition-colors disabled:opacity-50"
        >
          {creatingDeposit ? "Đang khởi tạo..." : "Tiếp tục nạp tiền"}
        </button>
      </div>

      {/* Giftcode */}
      <form
        onSubmit={handleRedeemGift}
        className="rounded-2xl bg-card border border-white/[0.08] p-4 space-y-2.5"
      >
        <label htmlFor="giftcode-input" className="block text-[14px] font-medium text-zinc-100">
          Đổi mã Giftcode
        </label>
        <div className="flex gap-2">
          <input
            id="giftcode-input"
            type="text"
            value={giftInput}
            onChange={(e) => setGiftInput(e.target.value.toUpperCase())}
            placeholder="Nhập mã quà tặng"
            className="flex-1 h-10 px-3.5 rounded-xl bg-bg border border-white/[0.08] text-[13px] font-mono text-zinc-100 placeholder:font-sans placeholder:text-zinc-500 focus:outline-none focus:border-white/25"
          />
          <button
            type="submit"
            disabled={redeemingGift || !giftInput.trim()}
            className="h-10 px-4 rounded-xl bg-elevated hover:bg-subtle border border-white/[0.08] text-zinc-100 text-[13px] font-medium shrink-0 disabled:opacity-40"
          >
            {redeemingGift ? "Đang đổi..." : "Áp dụng"}
          </button>
        </div>
      </form>

      {/* Lịch sử giao dịch */}
      <div className="rounded-2xl bg-card border border-white/[0.08] p-4 space-y-3">
        <h3 className="text-[14px] font-medium text-zinc-100">Lịch sử biến động</h3>
        {loading ? (
          <div className="text-[13px] text-zinc-500 py-6 text-center">Đang tải...</div>
        ) : !walletData?.transactions?.length ? (
          <div className="text-[13px] text-zinc-500 py-6 text-center">Chưa có giao dịch nào</div>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {walletData.transactions.map((tx) => {
              const isPlus =
                ["DEPOSIT", "REFUND", "ADMIN_ADD", "GIFTCODE"].includes(tx.type) && tx.amount > 0;
              return (
                <div key={tx.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-medium text-zinc-200 truncate">
                      {tx.description || tx.type}
                    </div>
                    <div className="text-[11.5px] text-zinc-500 font-mono mt-0.5">
                      {formatDateTime(tx.createdAt)}
                    </div>
                  </div>
                  <div className="text-right shrink-0 tabular">
                    <div
                      className={`font-mono text-[13.5px] font-semibold ${
                        tx.status !== "SUCCESS"
                          ? "text-amber-400"
                          : isPlus
                            ? "text-emerald-400"
                            : "text-zinc-200"
                      }`}
                    >
                      {isPlus ? "+" : "−"}
                      {formatVnd(Math.abs(tx.amount))}
                    </div>
                    <div className="text-[11px] text-zinc-500 font-mono">{tx.status}</div>
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
