import React, { useCallback, useEffect, useState } from "react";
import { RotateCw, Eye, EyeOff, Copy, ExternalLink, Terminal } from "lucide-react";
import { tmaFetch } from "../lib/api.js";
import { formatVnd, formatTokensCompact } from "../lib/format.js";
import { copyToClipboard, openTelegramUrl, hapticImpact, hapticNotify } from "../lib/telegram.js";
import { useToast } from "./Toast.jsx";

const METHOD_BADGE = {
  GET: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  POST: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  PATCH: "bg-sky-500/15 text-sky-300 border-sky-500/25",
  DELETE: "bg-rose-500/15 text-rose-300 border-rose-500/25",
};

export default function DeveloperApiPanel({ onGoTopup }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showKey, setShowKey] = useState(false);
  const [showUserKey, setShowUserKey] = useState(false);
  const [endpointTab, setEndpointTab] = useState("seller");
  const [curlTab, setCurlTab] = useState("createKey");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const { showToast } = useToast();

  const loadDeveloperApi = useCallback(async () => {
    setLoading(true);
    try {
      const res = await tmaFetch("/developer-api");
      setData(res);
    } catch (err) {
      showToast(err.message || "Không thể tải thông tin API.", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadDeveloperApi();
  }, [loadDeveloperApi]);

  const handleCopy = async (text, label) => {
    if (!text) return;
    await copyToClipboard(text);
    showToast(`Đã sao chép ${label}`, "success");
  };

  const handleTestConnection = async () => {
    if (!data?.apiKey) return;
    hapticImpact("light");
    setTesting(true);
    setTestResult(null);
    try {
      const resp = await fetch("/api/seller/me", {
        headers: { Authorization: `Bearer ${data.apiKey}` },
      });
      const json = await resp.json().catch(() => ({}));
      if (resp.ok) {
        hapticNotify("success");
        setTestResult({
          ok: true,
          status: resp.status,
          message: `Kết nối thành công · Số dư ví ${formatVnd(json.balance ?? data.balanceVnd ?? 0)}`,
        });
      } else {
        hapticNotify("error");
        setTestResult({
          ok: false,
          status: resp.status,
          message: json.error || `HTTP ${resp.status}`,
        });
      }
    } catch (err) {
      setTestResult({
        ok: false,
        status: 0,
        message: err.message || "Lỗi kết nối",
      });
    } finally {
      setTesting(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="py-12 text-center text-[13px] text-zinc-500">
        Đang tải thông tin API kết nối...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl bg-card border border-white/[0.08] p-6 text-center space-y-3">
        <p className="text-[13.5px] text-zinc-400">Chưa tải được thông tin API.</p>
        <button
          type="button"
          onClick={loadDeveloperApi}
          className="h-9 px-4 rounded-xl bg-zinc-100 text-zinc-950 text-[13px] font-semibold"
        >
          Thử lại
        </button>
      </div>
    );
  }

  const endpoints = endpointTab === "user" ? data.userEndpoints || [] : data.sellerEndpoints || [];
  const activeCurl = showKey ? data.curls?.[curlTab] || "" : data.maskedCurls?.[curlTab] || "";
  const rawCurl = data.curls?.[curlTab] || "";
  const keyLimitText =
    data.limits?.maxKeysPerDay > 0 ? `${data.usageToday?.keys || 0} / ${data.limits.maxKeysPerDay} key` : "Không giới hạn";
  const tokenLimitText =
    data.limits?.maxTokensPerDay > 0
      ? `${formatTokensCompact(data.usageToday?.tokens || 0)} / ${formatTokensCompact(data.limits.maxTokensPerDay)}`
      : "Không giới hạn";

  return (
    <div className="space-y-4">
      {/* Thẻ API Key & Trạng thái */}
      <div className="rounded-2xl bg-card border border-white/[0.08] p-4 space-y-3.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[14.5px] font-semibold tracking-[-0.015em] text-zinc-100">
              API Seller &amp; Kết nối tự động
            </div>
            <div className="text-[12px] text-zinc-500 mt-0.5">
              Liên kết trực tiếp với số dư ví Bot của bạn
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={`inline-flex items-center gap-1.5 text-[11.5px] font-mono ${
                data.active ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  data.active ? "bg-emerald-400" : "bg-rose-400"
                }`}
              />
              {data.active ? "Hoạt động" : "Tạm khóa"}
            </span>
            <button
              type="button"
              aria-label="Làm mới thông tin API"
              onClick={loadDeveloperApi}
              className="w-8 h-8 rounded-full bg-bg border border-white/[0.08] text-zinc-400 hover:text-zinc-100 flex items-center justify-center"
            >
              <RotateCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* Số dư ví liên kết */}
        <div className="px-3.5 py-2.5 rounded-xl bg-bg border border-white/[0.07] flex items-center justify-between gap-2 tabular">
          <div>
            <div className="text-[11.5px] text-zinc-500">Số dư ví dùng cho API</div>
            <div className="text-[15px] font-semibold font-mono text-zinc-100">
              {formatVnd(data.balanceVnd)}
            </div>
          </div>
          {onGoTopup && (
            <button
              type="button"
              onClick={() => {
                hapticImpact("light");
                onGoTopup(0);
              }}
              className="h-8 px-3 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-[12px] font-semibold shrink-0"
            >
              + Nạp ví
            </button>
          )}
        </div>

        {/* API Key Seller chính */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[12px] text-zinc-400">
            <span>API Key của bạn ({data.supportsUserApi ? "Seller & User" : "Seller API"})</span>
            <span className="font-mono text-zinc-500">Hôm nay: {data.usageToday?.keys || 0} key</span>
          </div>
          <div className="px-3.5 py-2.5 rounded-xl bg-bg border border-white/[0.08] font-mono text-[12.5px] text-zinc-100 break-all select-all">
            {showKey ? data.apiKey : data.maskedKey}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleCopy(data.apiKey, "API Key")}
              className="flex-1 h-9 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" strokeWidth={2} />
              Sao chép Key
            </button>
            <button
              type="button"
              onClick={() => {
                hapticImpact("light");
                setShowKey((v) => !v);
              }}
              className="h-9 px-3.5 rounded-xl bg-elevated hover:bg-subtle border border-white/[0.08] text-zinc-200 text-[12.5px] font-medium inline-flex items-center justify-center gap-1.5"
            >
              {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {showKey ? "Ẩn" : "Hiện"}
            </button>
          </div>
        </div>

        {/* Nếu Seller Key là sk_ riêng biệt do admin cấp -> hiện thêm User Key cho /api/user */}
        {data.hasDistinctUserKey && data.personalUserKey && (
          <div className="pt-2 border-t border-white/[0.06] space-y-2">
            <div className="text-[12px] text-zinc-400">User API Key riêng (dùng cho /api/user)</div>
            <div className="px-3 py-2 rounded-xl bg-bg border border-white/[0.07] font-mono text-[12px] text-zinc-200 break-all">
              {showUserKey ? data.personalUserKey : data.maskedPersonalUserKey}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleCopy(data.personalUserKey, "User API Key")}
                className="flex-1 h-8 rounded-lg bg-elevated hover:bg-subtle border border-white/[0.08] text-zinc-200 text-[12px] font-medium"
              >
                Sao chép User Key
              </button>
              <button
                type="button"
                onClick={() => setShowUserKey((v) => !v)}
                className="h-8 px-3 rounded-lg bg-bg border border-white/[0.08] text-zinc-400 text-[12px]"
              >
                {showUserKey ? "Ẩn" : "Hiện"}
              </button>
            </div>
          </div>
        )}

        {/* Trần theo ngày nếu có */}
        {(data.limits?.maxKeysPerDay > 0 || data.limits?.maxTokensPerDay > 0) && (
          <div className="pt-2 border-t border-white/[0.06] grid grid-cols-2 gap-2 text-[11.5px] tabular">
            <div className="px-3 py-2 rounded-xl bg-bg border border-white/[0.06]">
              <div className="text-zinc-500">Giới hạn Key/ngày</div>
              <div className="font-mono text-zinc-200 mt-0.5">{keyLimitText}</div>
            </div>
            <div className="px-3 py-2 rounded-xl bg-bg border border-white/[0.06]">
              <div className="text-zinc-500">Giới hạn Token/ngày</div>
              <div className="font-mono text-zinc-200 mt-0.5">{tokenLimitText}</div>
            </div>
          </div>
        )}

        {/* Test nhanh & Mở Docs */}
        <div className="grid grid-cols-2 gap-2 pt-0.5">
          <button
            type="button"
            disabled={testing}
            onClick={handleTestConnection}
            className="h-9 rounded-xl bg-elevated hover:bg-subtle border border-white/[0.08] text-zinc-100 text-[12.5px] font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <Terminal className="w-3.5 h-3.5" strokeWidth={1.75} />
            {testing ? "Đang kiểm tra..." : "Test kết nối"}
          </button>
          <button
            type="button"
            onClick={() => openTelegramUrl(data.userDocsUrl)}
            className="h-9 rounded-xl bg-elevated hover:bg-subtle border border-white/[0.08] text-zinc-200 text-[12.5px] font-medium inline-flex items-center justify-center gap-1.5"
          >
            <ExternalLink className="w-3.5 h-3.5" strokeWidth={1.75} />
            Tài liệu đầy đủ
          </button>
        </div>

        {testResult && (
          <div
            className={`px-3 py-2 rounded-xl border text-[12px] font-mono ${
              testResult.ok
                ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-300"
                : "bg-rose-500/10 border-rose-500/25 text-rose-300"
            }`}
          >
            HTTP {testResult.status || "ERR"} · {testResult.message}
          </div>
        )}
      </div>

      {/* Base URLs */}
      <div className="rounded-2xl bg-card border border-white/[0.08] p-4 space-y-2.5">
        <div className="text-[13px] font-semibold text-zinc-200">Base URLs</div>
        {[
          { label: "Seller API (Key AI)", value: data.sellerBase },
          { label: "User API (Mua lẻ)", value: data.userBase },
        ].map((item) => (
          <div
            key={item.label}
            className="px-3 py-2.5 rounded-xl bg-bg border border-white/[0.07] flex items-center justify-between gap-2.5"
          >
            <div className="min-w-0">
              <div className="text-[11px] text-zinc-500">{item.label}</div>
              <div className="font-mono text-[12px] text-zinc-200 truncate">{item.value}</div>
            </div>
            <button
              type="button"
              onClick={() => handleCopy(item.value, item.label)}
              className="h-7 px-2.5 rounded-lg bg-elevated hover:bg-subtle border border-white/[0.08] text-[11.5px] text-zinc-200 font-medium shrink-0"
            >
              Copy
            </button>
          </div>
        ))}
      </div>

      {/* Danh sách Endpoints */}
      <div className="rounded-2xl bg-card border border-white/[0.08] p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13px] font-semibold text-zinc-200">Endpoints</div>
          <div className="inline-flex p-0.5 rounded-lg bg-bg border border-white/[0.07]">
            {[
              { id: "seller", label: "/api/seller" },
              { id: "user", label: "/api/user" },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setEndpointTab(t.id)}
                className={`h-7 px-2.5 rounded-md font-mono text-[11.5px] transition-colors ${
                  endpointTab === t.id ? "bg-zinc-100 text-zinc-950 font-semibold" : "text-zinc-400"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="divide-y divide-white/[0.06]">
          {endpoints.map((ep) => (
            <div key={`${ep.method}:${ep.path}`} className="py-2.5 first:pt-1 last:pb-1 space-y-0.5">
              <div className="flex items-center gap-2">
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                    METHOD_BADGE[ep.method] || "bg-elevated text-zinc-300 border-white/10"
                  }`}
                >
                  {ep.method}
                </span>
                <span className="font-mono text-[12px] text-zinc-100">{ep.path}</span>
              </div>
              <p className="text-[12px] text-zinc-400 pl-0.5">{ep.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Mẫu cURL chạy thử */}
      <div className="rounded-2xl bg-card border border-white/[0.08] p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13px] font-semibold text-zinc-200">Ví dụ cURL</div>
          <button
            type="button"
            onClick={() => handleCopy(rawCurl, "lệnh cURL")}
            className="h-7 px-2.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-[11.5px] font-semibold"
          >
            Copy cURL
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-bg border border-white/[0.06]">
          {[
            { id: "createKey", label: "Tạo Key AI" },
            { id: "balance", label: "Xem ví" },
            { id: "purchase", label: "Mua lẻ" },
          ].map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCurlTab(c.id)}
              className={`h-7 rounded-lg text-[11.5px] font-medium transition-colors ${
                curlTab === c.id ? "bg-zinc-100 text-zinc-950 font-semibold" : "text-zinc-400"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <pre className="p-3 rounded-xl bg-bg border border-white/[0.07] font-mono text-[11.5px] leading-relaxed text-zinc-300 overflow-x-auto whitespace-pre">
          {activeCurl}
        </pre>

        <p className="text-[11.5px] text-zinc-500 leading-relaxed">
          Hãy nạp tiền vào ví trước khi gọi API. Tiền tự động trừ khi thành công và tự hoàn 100% nếu tạo key lỗi.
        </p>
      </div>
    </div>
  );
}
