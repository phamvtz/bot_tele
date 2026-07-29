import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bug, RefreshCw, AlertCircle, CheckCircle2, Save, KeyRound, Copy } from "lucide-react";
import { api } from "../../api/endpoints";
import { formatCurrency, formatDate } from "../../utils/format";

export default function SepayDebug() {
  const qc = useQueryClient();
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [sepayKey, setSepayKey] = useState("");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["sepay-debug"],
    queryFn: () => api.sepayDebug(),
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const { data: settingsData } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const sepayConfigured = settingsData?.settings?.SEPAY_API_KEY_SET === "1";

  const sepayKeyMut = useMutation({
    mutationFn: (v) => api.updateSettings({ SEPAY_API_KEY: v }),
    onSuccess: () => { setSepayKey(""); qc.invalidateQueries(["settings"]); qc.invalidateQueries(["sepay-debug"]); },
  });

  const config = data?.config || {};
  const sepay = data?.sepay || {};
  const transactions = data?.transactions || [];
  const pendingOrders = data?.pendingOrders || [];
  const fetchError = data?.fetchError;

  // URL webhook đầy đủ để dán vào dashboard SePay (dùng origin hiện tại).
  const webhookFullUrl = `${window.location.origin}${sepay.webhookUrl || "/webhook/ipn?provider=sepay"}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">Debug Bank API</h1>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="rounded text-primary-500" />
            Tự động làm mới (5s)
          </label>
          <button onClick={() => refetch()} disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.05] text-gray-300 rounded-lg text-xs hover:bg-white/[0.1] transition-colors disabled:opacity-50">
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /> Làm mới
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-5">Kiểm tra kết nối API ngân hàng (thueapibank / MB Bank) và đối soát giao dịch tự động</p>

      {/* Config card */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="glass rounded-xl p-3">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Trạng thái</p>
          <div className="flex items-center gap-1.5">
            {config.enabled ? <CheckCircle2 size={14} className="text-emerald-400" /> : <AlertCircle size={14} className="text-red-400" />}
            <span className="text-sm font-semibold text-white">{config.enabled ? "Bật" : "Tắt"}</span>
          </div>
        </div>
        <div className="glass rounded-xl p-3">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Token</p>
          <span className={`text-sm font-semibold ${config.hasToken ? "text-emerald-400" : "text-red-400"}`}>{config.hasToken ? "Đã cấu hình" : "Thiếu"}</span>
        </div>
        <div className="glass rounded-xl p-3">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Số tài khoản</p>
          <span className="text-sm font-semibold text-white">{config.accountNo || "—"}</span>
        </div>
        <div className="glass rounded-xl p-3">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Chu kỳ quét</p>
          <span className="text-sm font-semibold text-white">{config.intervalMs ? `${config.intervalMs}ms` : "—"}</span>
        </div>
      </div>

      {/* Nguồn xác nhận: thuebankvn (poll) + SePay (webhook) chạy song song */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="glass rounded-xl p-3">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Nguồn 1 · thuebankvn (poll)</p>
          <div className="flex items-center gap-1.5">
            {config.enabled && config.hasToken
              ? <CheckCircle2 size={14} className="text-emerald-400" />
              : <AlertCircle size={14} className="text-red-400" />}
            <span className="text-sm font-semibold text-white">
              {config.enabled && config.hasToken ? "Đang chạy" : "Chưa cấu hình"}
            </span>
          </div>
        </div>
        <div className="glass rounded-xl p-3">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Nguồn 2 · SePay (webhook)</p>
          <div className="flex items-center gap-1.5">
            {(sepay.enabled || sepayConfigured)
              ? <CheckCircle2 size={14} className="text-emerald-400" />
              : <AlertCircle size={14} className="text-gray-500" />}
            <span className="text-sm font-semibold text-white">{(sepay.enabled || sepayConfigured) ? "Đã bật" : "Chưa bật"}</span>
          </div>
          {!(sepay.enabled || sepayConfigured) && (
            <p className="text-[10px] text-gray-600 mt-1">Nhập API Key bên dưới để bật (dự phòng)</p>
          )}
        </div>
      </div>

      {/* Cấu hình SePay — dự phòng, chạy song song thuebankvn */}
      <div className="glass rounded-xl p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <KeyRound size={15} className="text-indigo-400" />
          <h2 className="text-sm font-semibold text-white">Cấu hình SePay (bank dự phòng)</h2>
          {sepayConfigured && (
            <span className="text-[10px] px-2 py-0.5 rounded border bg-emerald-950/50 text-emerald-400 border-emerald-800/50">Đã cấu hình</span>
          )}
        </div>

        <div className="mb-3">
          <label className="text-xs text-gray-500 block mb-1.5">1. Dán URL này vào Webhook trong dashboard SePay</label>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono text-amber-300 bg-white/[0.04] rounded-lg px-3 py-2 break-all">{webhookFullUrl}</code>
            <button
              onClick={() => navigator.clipboard?.writeText(webhookFullUrl)}
              className="px-2.5 py-2 glass rounded-lg text-xs text-gray-400 hover:text-white transition-colors flex-shrink-0"
              title="Copy URL"
            >
              <Copy size={13} />
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-500 block mb-1.5">
            2. Nhập API Key (kiểu "Authorization: Apikey …" trong SePay)
            {sepayConfigured && <span className="text-gray-600"> — để trống nếu không đổi</span>}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={sepayKey}
              onChange={(e) => setSepayKey(e.target.value)}
              placeholder={sepayConfigured ? "•••••••• (đã lưu, nhập để thay)" : "Dán SePay API Key"}
              className="flex-1 glass-input rounded-lg px-3 py-2 text-sm font-mono"
            />
            <button
              onClick={() => sepayKeyMut.mutate(sepayKey.trim())}
              disabled={sepayKeyMut.isPending || !sepayKey.trim()}
              className="px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
            >
              <Save size={13} />
              {sepayKeyMut.isPending ? "Đang lưu..." : "Lưu"}
            </button>
          </div>
          {sepayKeyMut.isSuccess && (
            <p className="text-xs text-emerald-400 mt-1.5 flex items-center gap-1"><CheckCircle2 size={12} /> Đã lưu, SePay áp dụng ngay</p>
          )}
          <p className="text-[11px] text-gray-600 mt-1.5">Để trống key và lưu = tắt SePay. thuebankvn vẫn chạy độc lập.</p>
        </div>
      </div>

      {fetchError && (
        <div className="glass rounded-xl p-4 mb-4 border border-red-800/40 bg-red-950/20">
          <div className="flex items-center gap-2 text-red-400 text-sm font-medium mb-1">
            <AlertCircle size={15} /> Lỗi gọi API ngân hàng
          </div>
          <p className="text-xs text-red-300/80 font-mono break-all">{fetchError}</p>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Recent transactions */}
        <div className="glass rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-1.5">
            <Bug size={14} /> Giao dịch gần đây ({data?.transactionCount || 0})
          </h2>
          {isLoading ? (
            <div className="py-8 text-center text-sm text-gray-500">Đang tải...</div>
          ) : transactions.length === 0 ? (
            <p className="text-xs text-gray-500 py-6 text-center">Không có giao dịch</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {transactions.map((t, i) => (
                <div key={i} className="rounded-lg bg-white/[0.03] p-2.5 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-emerald-400">+{formatCurrency(t.amount)}</span>
                    <span className="text-gray-500">{t.when ? formatDate(t.when) : ""}</span>
                  </div>
                  <p className="text-gray-300 font-mono break-all">{t.content || "—"}</p>
                  {t.transactionId && <p className="text-gray-600 mt-0.5">TID: {t.transactionId}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pending orders to match */}
        <div className="glass rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-3">Đơn chờ thanh toán ({pendingOrders.length})</h2>
          {pendingOrders.length === 0 ? (
            <p className="text-xs text-gray-500 py-6 text-center">Không có đơn chờ</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {pendingOrders.map((o, i) => (
                <div key={i} className="rounded-lg bg-white/[0.03] p-2.5 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-primary-400">{o.shortId}</span>
                    <span className="text-gray-300">{formatCurrency(o.amount)}</span>
                  </div>
                  <p className="text-gray-400">Nội dung cần: <span className="font-mono text-amber-300">{o.expectContent}</span></p>
                  <p className="text-gray-600 mt-0.5">{formatDate(o.createdAt)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
