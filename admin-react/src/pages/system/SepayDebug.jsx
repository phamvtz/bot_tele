import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bug, RefreshCw, AlertCircle, CheckCircle2, Save, KeyRound, Copy, Check, Activity, Clock, ShieldCheck } from "lucide-react";
import { api } from "../../api/endpoints";
import { formatCurrency, formatDate } from "../../utils/format";

export default function SepayDebug() {
  const qc = useQueryClient();
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [sepayKey, setSepayKey] = useState("");
  const [copiedUrl, setCopiedUrl] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["sepay-debug"],
    queryFn: () => api.sepayDebug(),
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const { data: settingsData } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const sepayConfigured = settingsData?.settings?.SEPAY_API_KEY_SET === "1";

  const sepayKeyMut = useMutation({
    mutationFn: (v) => api.updateSettings({ SEPAY_API_KEY: v }),
    onSuccess: () => {
      setSepayKey("");
      qc.invalidateQueries(["settings"]);
      qc.invalidateQueries(["sepay-debug"]);
    },
  });

  const config = data?.config || {};
  const sepay = data?.sepay || {};
  const transactions = data?.transactions || [];
  const pendingOrders = data?.pendingOrders || [];
  const fetchError = data?.fetchError;

  const webhookFullUrl = `${window.location.origin}${sepay.webhookUrl || "/webhook/ipn?provider=sepay"}`;

  const copyWebhook = () => {
    navigator.clipboard?.writeText(webhookFullUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="eyebrow text-electric-rose mb-1 flex items-center gap-2">
            <span>DIAGNOSTICS // BANK API & SEPAY DEBUG</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100">Đối soát & Debug Bank API</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Kiểm tra trạng thái kết nối ngân hàng MB Bank, chu kỳ poller và webhook SePay đối soát thời gian thực
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900/80 text-xs font-mono text-slate-300 cursor-pointer hover:border-slate-700 transition-colors">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-slate-700 text-electric-indigo focus:ring-0"
            />
            <span>Auto Refresh (5s)</span>
          </label>

          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-200 rounded-lg text-xs font-mono transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={isFetching ? "animate-spin text-electric-cyan" : ""} />
            <span>Refetch</span>
          </button>
        </div>
      </div>

      {/* Top 4-Metric Bento Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bento-card p-3.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="eyebrow text-slate-400">POLLER STATE</span>
            <Activity size={14} className={config.enabled ? "text-emerald-400" : "text-slate-600"} />
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${config.enabled ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" : "bg-red-400"}`} />
            <span className="text-sm font-semibold text-slate-100 font-mono">
              {config.enabled ? "RUNNING" : "STOPPED"}
            </span>
          </div>
        </div>

        <div className="bento-card p-3.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="eyebrow text-slate-400">API TOKEN</span>
            <ShieldCheck size={14} className={config.hasToken ? "text-emerald-400" : "text-red-400"} />
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`text-sm font-semibold font-mono ${config.hasToken ? "text-emerald-400" : "text-red-400"}`}>
              {config.hasToken ? "CONFIGURED" : "MISSING"}
            </span>
          </div>
        </div>

        <div className="bento-card p-3.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="eyebrow text-slate-400">ACCOUNT NUMBER</span>
            <span className="text-[10px] font-mono text-slate-500">MBBANK</span>
          </div>
          <span className="text-sm font-semibold text-slate-100 font-mono tracking-wider">
            {config.accountNo || "—"}
          </span>
        </div>

        <div className="bento-card p-3.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="eyebrow text-slate-400">POLL INTERVAL</span>
            <Clock size={14} className="text-slate-500" />
          </div>
          <span className="text-sm font-semibold text-electric-cyan font-mono">
            {config.intervalMs ? `${config.intervalMs} ms` : "—"}
          </span>
        </div>
      </div>

      {/* Dual Source Sync Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bento-card p-3.5 border-l-2 border-l-emerald-500">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="mono-badge text-[10px] bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">
                  SOURCE 01 // CRON POLLER
                </span>
                <span className="text-xs text-slate-400 font-mono">thueapibank / MB</span>
              </div>
              <p className="text-xs text-slate-300 font-medium">Tự động quét lịch sử ngân hàng định kỳ</p>
            </div>
            <div className="flex items-center gap-1.5">
              {config.enabled && config.hasToken ? (
                <span className="flex items-center gap-1 text-xs font-mono text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-800/60">
                  <CheckCircle2 size={12} /> Đang chạy
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs font-mono text-amber-400 bg-amber-950/50 px-2 py-0.5 rounded border border-amber-800/60">
                  <AlertCircle size={12} /> Chưa sẵn sàng
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="bento-card p-3.5 border-l-2 border-l-electric-indigo">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="mono-badge text-[10px] bg-indigo-950/60 text-indigo-400 border border-indigo-800/60">
                  SOURCE 02 // WEBHOOK IPN
                </span>
                <span className="text-xs text-slate-400 font-mono">SePay Gateway</span>
              </div>
              <p className="text-xs text-slate-300 font-medium">Nhận webhook tức thì khi có biến động</p>
            </div>
            <div className="flex items-center gap-1.5">
              {(sepay.enabled || sepayConfigured) ? (
                <span className="flex items-center gap-1 text-xs font-mono text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-800/60">
                  <CheckCircle2 size={12} /> Đã kết nối
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs font-mono text-slate-500 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                  Chưa cấu hình
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* SePay Config Card */}
      <div className="bento-card p-4 space-y-4">
        <div className="flex items-center justify-between pb-3 thin-divider">
          <div className="flex items-center gap-2">
            <KeyRound size={16} className="text-electric-indigo" />
            <h2 className="text-sm font-semibold text-slate-100 tracking-tight">Cấu hình SePay (Dự phòng & Webhook song song)</h2>
          </div>
          {sepayConfigured && (
            <span className="mono-badge text-[10px] bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">
              CONFIGURED & ACTIVE
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="eyebrow text-slate-400 block mb-1.5">1. Webhook Endpoint URL (Dán vào SePay Dashboard)</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-amber-300 bg-slate-950/80 border border-slate-800 rounded-lg px-3 py-2 break-all select-all">
                {webhookFullUrl}
              </code>
              <button
                onClick={copyWebhook}
                className="px-3 py-2 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg text-xs font-mono text-slate-300 hover:text-white transition-colors flex items-center gap-1 flex-shrink-0"
              >
                {copiedUrl ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                <span>{copiedUrl ? "Copied" : "Copy"}</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">Cần để IPN method là POST application/json</p>
          </div>

          <div>
            <label className="eyebrow text-slate-400 block mb-1.5">
              2. SePay API Key (Header: Authorization: Apikey ...)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={sepayKey}
                onChange={(e) => setSepayKey(e.target.value)}
                placeholder={sepayConfigured ? "•••••••••••• (Đã lưu - nhập để thay thế)" : "Dán API Key SePay tại đây"}
                className="flex-1 dev-input px-3 py-2 text-xs font-mono"
              />
              <button
                onClick={() => sepayKeyMut.mutate(sepayKey.trim())}
                disabled={sepayKeyMut.isPending || !sepayKey.trim()}
                className="px-4 py-2 bg-electric-indigo hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition-all disabled:opacity-40 flex items-center gap-1.5 flex-shrink-0"
              >
                <Save size={13} />
                <span>{sepayKeyMut.isPending ? "Lưu..." : "Lưu key"}</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">Để trống và lưu nếu muốn vô hiệu hóa SePay và chỉ dùng MBBank.</p>
          </div>
        </div>
      </div>

      {fetchError && (
        <div className="bento-card p-4 border border-red-800/60 bg-red-950/20">
          <div className="flex items-center gap-2 text-red-400 text-xs font-mono font-semibold mb-1">
            <AlertCircle size={15} /> LỖI GỌI API NGÂN HÀNG
          </div>
          <p className="text-xs text-red-300 font-mono break-all">{fetchError}</p>
        </div>
      )}

      {/* Asymmetric Inspection Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Bank Transactions */}
        <div className="bento-card p-4 flex flex-col">
          <div className="flex items-center justify-between mb-3 pb-2.5 thin-divider">
            <div className="flex items-center gap-2">
              <Bug size={14} className="text-emerald-400" />
              <h2 className="text-sm font-semibold text-slate-100 tracking-tight">
                Giao dịch ngân hàng gần đây
              </h2>
            </div>
            <span className="mono-badge text-[10px] bg-slate-900 border border-slate-800 text-slate-400">
              COUNT: {data?.transactionCount || transactions.length}
            </span>
          </div>

          {isLoading ? (
            <div className="py-12 text-center text-xs font-mono text-slate-500">Đang đọc dữ liệu ngân hàng...</div>
          ) : transactions.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 font-mono">
              Chưa có giao dịch biến động nào gần đây
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {transactions.map((t, i) => (
                <div key={i} className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 hover:border-slate-700/80 transition-all">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono text-xs font-bold text-emerald-400">
                      +{formatCurrency(t.amount)}
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">
                      {t.when ? formatDate(t.when) : ""}
                    </span>
                  </div>
                  <div className="p-2 rounded bg-slate-900/80 border border-slate-800 font-mono text-[11px] text-slate-300 break-all select-all">
                    {t.content || "—"}
                  </div>
                  {t.transactionId && (
                    <div className="flex items-center justify-between mt-1.5 text-[10px] font-mono text-slate-500">
                      <span>REF ID: {t.transactionId}</span>
                      <span className="text-slate-600">MB BANK</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pending Orders Waiting for Match */}
        <div className="bento-card p-4 flex flex-col">
          <div className="flex items-center justify-between mb-3 pb-2.5 thin-divider">
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-amber-400" />
              <h2 className="text-sm font-semibold text-slate-100 tracking-tight">
                Đơn hàng đang chờ đối soát
              </h2>
            </div>
            <span className="mono-badge text-[10px] bg-slate-900 border border-slate-800 text-amber-400">
              PENDING: {pendingOrders.length}
            </span>
          </div>

          {pendingOrders.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 font-mono">
              Không có đơn hàng nào đang chờ thanh toán
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {pendingOrders.map((o, i) => (
                <div key={i} className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 hover:border-slate-700/80 transition-all">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono text-xs font-bold text-electric-cyan">
                      #{o.shortId}
                    </span>
                    <span className="font-mono text-xs font-semibold text-slate-200">
                      {formatCurrency(o.amount)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="eyebrow text-slate-500">Nội dung yêu cầu:</span>
                    <span className="font-mono text-xs text-amber-300 font-semibold bg-amber-950/40 px-2 py-0.5 rounded border border-amber-800/50">
                      {o.expectContent}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 mt-1">
                    Tạo lúc: {formatDate(o.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
