import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Zap, Ban, Trash2, Send, CheckCircle2, SkipForward, ShoppingBag,
  Coins, Users, AlertTriangle, Clock, Info, X,
} from "lucide-react";
import { api } from "../api/endpoints";
import Modal from "../components/Modal";
import EmptyState from "../components/EmptyState";
import TabFilter from "../components/TabFilter";
import { formatDate, relativeTime } from "../utils/format";

/**
 * Nhãn + màu trạng thái. Emoji giữ ĐÚNG bộ mà bot in cho admin (§5) để hai màn nói
 * cùng một ngôn ngữ — admin đọc "🟠 hết suất" trên Telegram rồi thấy đúng chữ đó ở đây.
 */
const STATUS = {
  SENDING: { label: "📤 Đang gửi", cls: "bg-sky-950/60 text-sky-300 border-sky-800/50", dot: "bg-sky-400" },
  OPEN:    { label: "🟢 Đang mở",  cls: "bg-emerald-950/60 text-emerald-300 border-emerald-800/50", dot: "bg-emerald-400" },
  FULL:    { label: "🟠 Hết suất", cls: "bg-orange-950/60 text-orange-300 border-orange-800/50", dot: "bg-orange-400" },
  CLOSED:  { label: "⚪ Đã đóng",  cls: "bg-white/[0.06] text-gray-400 border-white/[0.1]", dot: "bg-gray-500" },
};

function StatusPill({ status }) {
  const c = STATUS[status] || { label: status, cls: "bg-white/[0.06] text-gray-400 border-white/[0.1]", dot: "bg-gray-500" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ${c.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot}`} />
      {c.label}
    </span>
  );
}

/**
 * `formatCurrency` của utils hard-code VND. `discountGivenTotal` KHÔNG phải lúc nào cũng
 * là VND (sản phẩm giá USD thì flash giảm trên đơn vị giá USD), nên màn này phải đọc
 * `moneyCurrency` mà API trả kèm — backend đã quyết định tiền tệ ở MỘT chỗ, UI không tự suy.
 */
function fmtMoney(amount, currency) {
  const n = Number(amount) || 0;
  if (currency === "USD") {
    return `$${n < 1 ? n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "") : n.toFixed(2)}`;
  }
  return new Intl.NumberFormat("vi-VN").format(Math.round(n)) + "đ";
}

function fmtClock(d) {
  if (!d) return "—";
  const t = new Date(d);
  if (isNaN(t.getTime())) return String(d);
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(t);
}

const fmtEta = (secs) => {
  const s = Math.max(0, Number(secs) || 0);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} phút ${s % 60}s` : `${Math.floor(m / 60)} giờ ${m % 60} phút`;
};

/** Một ô số liệu trong modal chi tiết (§6). */
function Metric({ icon: Icon, label, value, hint, tone = "text-white" }) {
  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.05]">
      <Icon size={15} className="mt-0.5 flex-shrink-0 text-gray-500" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-gray-500 leading-tight">{label}</p>
        <p className={`text-sm font-semibold ${tone} leading-snug`}>{value}</p>
        {hint && <p className="text-[11px] text-gray-600 leading-tight mt-0.5">{hint}</p>}
      </div>
    </div>
  );
}

const TABS = [
  { value: "all", label: "Tất cả" },
  { value: "SENDING", label: "📤 Đang gửi" },
  { value: "OPEN", label: "🟢 Đang mở" },
  { value: "FULL", label: "🟠 Hết suất" },
  { value: "CLOSED", label: "⚪ Đã đóng" },
];

export default function FlashSales() {
  const [tab, setTab] = useState("all");
  const [detail, setDetail] = useState(null);
  const qc = useQueryClient();

  // `take` cố định ở trần backend cho phép: màn này là để nhìn tổng quan, không phải
  // để lật sử. Đợt cũ hơn thì tra trong Database viewer.
  const { data, isLoading, error } = useQuery({
    queryKey: ["flash-sales", tab],
    queryFn: () => api.flashSales({ status: tab === "all" ? "" : tab, take: 100 }),
    // Đang gửi thì số phải nhảy theo vòng worker (5s/lượt); đang mở thì suất vơi dần
    // theo khách bấm. Đã đóng hết thì không có gì để cập nhật — đừng đốt request.
    refetchInterval: (query) => {
      const rows = query.state.data?.flashSales || [];
      if (rows.some((s) => s.status === "SENDING")) return 5000;
      if (rows.some((s) => s.status === "OPEN")) return 15000;
      return false;
    },
  });

  const closeMut = useMutation({
    mutationFn: api.closeFlashSale,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["flash-sales"] });
      // Modal chi tiết đang mở phải theo kịp — nó render từ row của list.
      setDetail((d) => (d ? { ...d, status: "CLOSED" } : d));
    },
  });

  const delMut = useMutation({
    mutationFn: api.deleteFlashSale,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["flash-sales"] });
      setDetail(null);
      const n = Number(r?.deleted?.responses) || 0;
      if (n > 0) {
        alert(`Đã xoá đợt và ${n} lượt nhận của khách. Ưu đãi đang sống của những người đó đã mất hiệu lực.`);
      }
    },
    onError: (e) => alert(`Không xoá được: ${e?.response?.data?.error || e.message}`),
  });

  const sales = useMemo(() => data?.flashSales || [], [data]);

  function askClose(s) {
    if (!confirm(
      `Đóng đợt "${s.productName}"?\n\n`
      + `Khách sẽ KHÔNG nhận thêm được nữa, nhưng ${s.stats?.live ?? 0} người đã nhận `
      + `vẫn giữ ưu đãi tới hết hạn của họ.\n\nĐây là cách dừng an toàn.`,
    )) return;
    closeMut.mutate(s.id);
  }

  function askDelete(s) {
    // §8: xoá là gỡ luôn claim của khách. Phải nói rõ VÀ chỉ ra lựa chọn an toàn hơn,
    // vì "xoá cho gọn" là phản xạ tự nhiên và hậu quả thì không hoàn tác được.
    const live = Number(s.stats?.live) || 0;
    if (!confirm(
      `XOÁ HẲN đợt "${s.productName}"?\n\n`
      + (live > 0
        ? `⚠️ ${live} khách đang GIỮ ưu đãi còn hiệu lực sẽ mất nó ngay lập tức.\n`
        : "")
      + `Mọi lượt nhận/bỏ qua đã ghi cũng bị xoá — mất luôn số liệu thống kê.\n`
      + `Không hoàn tiền, không thu hồi gì, và KHÔNG hoàn tác được.\n\n`
      + `Nếu chỉ muốn ngừng nhận thêm mà giữ ưu đãi của khách, hãy bấm "Đóng" thay vì xoá.`,
    )) return;
    delMut.mutate(s.id);
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-1 gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Zap size={19} className="text-primary-400" />
            Flash sale
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Ưu đãi giới hạn suất, giảm giá theo sản phẩm</p>
        </div>
      </div>

      {/* KHÔNG có nút "Tạo" — và phải nói rõ tại sao, nếu không admin tưởng trang hỏng. */}
      <div className="flex items-start gap-2 px-3.5 py-2.5 mb-4 rounded-lg bg-primary-500/[0.07] border border-primary-500/20">
        <Info size={14} className="mt-0.5 flex-shrink-0 text-primary-400" />
        <p className="text-xs text-gray-400 leading-relaxed">
          Tạo đợt mới ở <b className="text-gray-200">bot Telegram</b>: <code className="px-1 py-0.5 rounded bg-white/[0.08] text-primary-300">/flashsale</code>
          {" "}→ <b className="text-gray-200">⚡ Flash sale</b> → <b className="text-gray-200">➕ Tạo đợt mới</b>.
          Trang này chỉ theo dõi, đóng và xoá — vì bước cuối của wizard là nhắn tin cho
          toàn bộ khách hàng, cần màn preview và xác nhận trong bot.
        </p>
      </div>

      <TabFilter tabs={TABS} active={tab} onChange={setTab} />

      {error && (
        <div className="flex items-center gap-2 px-3.5 py-2.5 mb-3 rounded-lg bg-red-950/40 border border-red-800/40 text-xs text-red-300">
          <AlertTriangle size={14} />
          Không tải được danh sách: {error?.response?.data?.error || error.message}
        </div>
      )}

      <div className="glass rounded-xl p-4">
        {isLoading ? (
          <p className="text-sm text-gray-500 py-10 text-center">Đang tải...</p>
        ) : sales.length === 0 ? (
          <EmptyState icon={Zap} message={tab === "all" ? "Chưa có đợt flash sale nào" : "Không có đợt nào ở trạng thái này"} />
        ) : (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-white/[0.06] text-left text-xs text-gray-500">
                  <th className="px-3 py-2.5 font-medium">Sản phẩm</th>
                  <th className="px-3 py-2.5 font-medium">Giảm</th>
                  <th className="px-3 py-2.5 font-medium">Nhận / Suất</th>
                  <th className="px-3 py-2.5 font-medium">Gửi</th>
                  <th className="px-3 py-2.5 font-medium">Bỏ qua</th>
                  <th className="px-3 py-2.5 font-medium">Đã mua</th>
                  <th className="px-3 py-2.5 font-medium">Đã giảm</th>
                  <th className="px-3 py-2.5 font-medium">Trạng thái</th>
                  <th className="px-3 py-2.5 font-medium text-right">Hành động</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => {
                  const unlimited = !(Number(s.maxSlots) > 0);
                  return (
                    <tr key={s.id} className="border-b border-white/[0.04] hover:bg-white/[0.03] align-top">
                      <td className="px-3 py-3">
                        <button onClick={() => setDetail(s)} className="text-left group">
                          <p className="font-medium text-gray-200 group-hover:text-primary-400 transition-colors">
                            {s.productName || "(sản phẩm đã xoá)"}
                          </p>
                          <p className="text-[11px] text-gray-600 mt-0.5">
                            {formatDate(s.createdAt)} · hiệu lực {s.validityMinutes} phút sau khi nhận
                          </p>
                        </button>
                        {s.status === "SENDING" && s.progress && (
                          <div className="mt-1.5">
                            <div className="h-1 w-32 rounded-full bg-white/[0.08] overflow-hidden">
                              <div className="h-full bg-sky-400 transition-all" style={{ width: `${s.progress.pct}%` }} />
                            </div>
                            <p className="text-[11px] text-sky-400/80 mt-1">
                              {s.progress.pct}% · mở lúc {fmtClock(s.opensAt)} · còn ~{fmtEta(s.progress.etaSeconds)}
                            </p>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 font-semibold text-primary-400 whitespace-nowrap">−{s.discountPct}%</td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="text-gray-200 font-medium">{s.acceptedCount}</span>
                        <span className="text-gray-600"> / {unlimited ? "∞" : s.maxSlots}</span>
                        {!unlimited && s.stats?.live > 0 && (
                          <span className="block text-[11px] text-emerald-500/80">{s.stats.live} còn hiệu lực</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-gray-400 whitespace-nowrap">
                        {s.sentCount}
                        {s.blockedCount > 0 && <span className="block text-[11px] text-gray-600">🚫 {s.blockedCount} chặn bot</span>}
                        {s.errorCount > 0 && <span className="block text-[11px] text-red-400/80">⚠️ {s.errorCount} lỗi</span>}
                      </td>
                      <td className="px-3 py-3 text-gray-400">{s.skippedCount}</td>
                      <td className="px-3 py-3 text-gray-300">{s.purchasedCount}</td>
                      <td className="px-3 py-3 text-gray-300 whitespace-nowrap">
                        {s.discountGivenTotal > 0 ? fmtMoney(s.discountGivenTotal, s.moneyCurrency) : "—"}
                      </td>
                      <td className="px-3 py-3"><StatusPill status={s.status} /></td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => setDetail(s)} title="Chi tiết"
                            className="text-gray-500 hover:text-primary-400 transition-colors">
                            <Info size={14} />
                          </button>
                          {(s.status === "SENDING" || s.status === "OPEN") && (
                            <button
                              onClick={() => askClose(s)}
                              disabled={closeMut.isPending}
                              title={s.status === "SENDING" ? "Dừng gửi & đóng" : "Ngừng nhận thêm"}
                              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-white/[0.05] border border-white/[0.08] text-gray-300 hover:text-amber-300 hover:border-amber-700/50 transition-colors disabled:opacity-50">
                              <Ban size={12} />
                              {s.status === "SENDING" ? "Dừng gửi" : "Đóng"}
                            </button>
                          )}
                          <button onClick={() => askDelete(s)} disabled={delMut.isPending} title="Xoá đợt và mọi lượt nhận"
                            className="text-gray-500 hover:text-red-500 transition-colors disabled:opacity-50">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail && (
        <DetailModal
          sale={sales.find((s) => s.id === detail.id) || detail}
          onClose={() => setDetail(null)}
          onClose2={askClose}
          onDelete={askDelete}
          busy={closeMut.isPending || delMut.isPending}
        />
      )}
    </div>
  );
}

/**
 * Chi tiết một đợt — đúng bộ số liệu §6, chia ba nhóm: ĐÃ GỬI / PHẢN HỒI / KẾT QUẢ.
 *
 * Render từ row của list (không fetch riêng) để con số trên modal luôn khớp con số
 * trên bảng — hai nguồn thì có lúc lệch nhau và admin không biết tin cái nào.
 */
function DetailModal({ sale: s, onClose, onClose2, onDelete, busy }) {
  const st = s.stats || {};
  const unlimited = !(Number(s.maxSlots) > 0);
  const money = (v) => fmtMoney(v, s.moneyCurrency);

  return (
    <Modal open onClose={onClose} title={`⚡ ${s.productName || "(sản phẩm đã xoá)"}`}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusPill status={s.status} />
          <span className="text-xs text-gray-500">tạo {relativeTime(s.createdAt)}</span>
          {s.closedAt && <span className="text-xs text-gray-600">· đóng {formatDate(s.closedAt)}</span>}
        </div>

        <div className="grid grid-cols-2 gap-2.5 text-sm">
          <div className="px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.05]">
            <p className="text-[11px] text-gray-500">Giảm giá</p>
            <p className="font-semibold text-primary-400">−{s.discountPct}%</p>
          </div>
          <div className="px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.05]">
            <p className="text-[11px] text-gray-500">Hiệu lực</p>
            <p className="font-semibold text-gray-200">{s.validityMinutes} phút <span className="text-gray-500 font-normal text-xs">kể từ lúc khách nhận</span></p>
          </div>
          <div className="px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.05]">
            <p className="text-[11px] text-gray-500">Mở nhận lúc</p>
            <p className="font-semibold text-gray-200">{fmtClock(s.opensAt)}</p>
          </div>
          <div className="px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.05]">
            <p className="text-[11px] text-gray-500">Trần suất</p>
            <p className="font-semibold text-gray-200">{unlimited ? "Không giới hạn" : s.maxSlots}</p>
          </div>
        </div>

        {s.status === "SENDING" && s.progress && (
          <div className="px-3 py-3 rounded-lg bg-sky-950/30 border border-sky-800/40">
            <div className="flex items-center justify-between text-xs text-sky-300 mb-1.5">
              <span className="font-medium">Đang gửi tới khách</span>
              <span>{s.progress.pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
              <div className="h-full bg-sky-400 transition-all" style={{ width: `${s.progress.pct}%` }} />
            </div>
            <p className="text-[11px] text-sky-400/70 mt-1.5">
              Còn ~{fmtEta(s.progress.etaSeconds)} · mở lúc {fmtClock(s.opensAt)}
              {s.progress.secsPerUser != null && ` · ${(1 / s.progress.secsPerUser).toFixed(0)} người/giây`}
            </p>
          </div>
        )}

        <div>
          <p className="text-[11px] font-bold text-gray-600 tracking-wider uppercase mb-2">Đã gửi</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Metric icon={Send} label="📤 Đã gửi" value={s.sentCount} hint={`trong ${s.recipientTotal} khách`} tone="text-sky-300" />
            <Metric icon={Ban} label="🚫 Chặn bot" value={s.blockedCount} tone="text-gray-300" />
            <Metric icon={AlertTriangle} label="⚠️ Lỗi gửi" value={s.errorCount} tone={s.errorCount > 0 ? "text-red-400" : "text-gray-300"} />
            <Metric icon={Users} label="👥 Không phản hồi" value={s.noResponse} hint="đã nhận tin, chưa bấm" tone="text-gray-400" />
          </div>
        </div>

        <div>
          <p className="text-[11px] font-bold text-gray-600 tracking-wider uppercase mb-2">Phản hồi</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Metric icon={CheckCircle2} label="✅ Đã nhận" value={unlimited ? s.acceptedCount : `${s.acceptedCount} / ${s.maxSlots}`} tone="text-emerald-300" />
            <Metric icon={Clock} label="🟢 Còn hiệu lực" value={st.live ?? 0} hint={`${st.expired ?? 0} đã hết hạn`} tone="text-emerald-400" />
            <Metric icon={SkipForward} label="⏭ Bỏ qua" value={s.skippedCount} hint="vẫn nhận lại được" tone="text-gray-300" />
            <Metric icon={Users} label="Tổng lượt bấm" value={st.responded ?? 0} tone="text-gray-300" />
          </div>
        </div>

        <div>
          <p className="text-[11px] font-bold text-gray-600 tracking-wider uppercase mb-2">Kết quả</p>
          <div className="grid grid-cols-2 gap-2">
            <Metric icon={ShoppingBag} label="🛒 Đã mua bằng giá flash" value={s.purchasedCount} hint="đơn đã giao" tone="text-primary-300" />
            <Metric icon={Coins} label="💸 Tổng tiền đã giảm" value={s.discountGivenTotal > 0 ? money(s.discountGivenTotal) : "—"}
              hint="ghi lúc mua thật, không ước tính" tone="text-primary-300" />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          {(s.status === "SENDING" || s.status === "OPEN") && (
            <button onClick={() => onClose2(s)} disabled={busy}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium bg-amber-600/20 border border-amber-700/40 text-amber-300 hover:bg-amber-600/30 transition-colors disabled:opacity-50">
              <Ban size={14} />
              {s.status === "SENDING" ? "Dừng gửi & đóng" : "Ngừng nhận thêm"}
            </button>
          )}
          <button onClick={() => onDelete(s)} disabled={busy}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium bg-red-600/15 border border-red-800/40 text-red-400 hover:bg-red-600/25 transition-colors disabled:opacity-50">
            <Trash2 size={14} />
            Xoá đợt
          </button>
          <button onClick={onClose}
            className="px-3 py-2 rounded-lg text-sm text-gray-400 bg-white/[0.05] border border-white/[0.08] hover:text-white transition-colors">
            <X size={14} />
          </button>
        </div>

        <p className="text-[11px] text-gray-600 leading-relaxed">
          <b className="text-gray-500">Đóng</b> chỉ ngừng nhận thêm — khách đã nhận vẫn giữ ưu đãi tới hết hạn của họ.
          <b className="text-gray-500"> Xoá</b> gỡ luôn mọi lượt nhận, ưu đãi đang sống mất hiệu lực ngay.
        </p>
      </div>
    </Modal>
  );
}
