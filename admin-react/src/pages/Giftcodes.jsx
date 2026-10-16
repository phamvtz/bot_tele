import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Gift, Trash2, Pencil, Search, History, Power } from "lucide-react";
import { api } from "../api/endpoints";
import Modal from "../components/Modal";
import EmptyState from "../components/EmptyState";
import { ToastContainer, useToast } from "../components/Toast";
import { formatCurrency, formatDate } from "../utils/format";

const QUOTA_MIN_M = 3;
const QUOTA_MAX_M = 50;

const EMPTY = {
  rewardType: "WALLET",
  code: "",
  count: "",
  amount: "",
  quotaMinM: "",
  quotaMaxM: "",
  keyRpm: "",
  keyValidDays: "",
  maxUses: "",
  perUserLimit: "",
  vipOnly: "",
  expiresAt: "",
  note: "",
};

function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Giftcodes() {
  const [modal, setModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [search, setSearch] = useState("");
  const [redeemFor, setRedeemFor] = useState(null);
  const qc = useQueryClient();
  const toast = useToast();

  const { data, isLoading } = useQuery({ queryKey: ["giftcodes"], queryFn: () => api.giftcodes({ limit: 200 }) });
  const giftcodes = data?.giftcodes || [];

  const done = (msg) => {
    qc.invalidateQueries(["giftcodes"]);
    setModal(false);
    setEditTarget(null);
    setForm(EMPTY);
    if (msg) toast.success(msg);
  };
  const fail = (e) => toast.error(`❌ ${e.response?.data?.error || e.message}`);

  const createMut = useMutation({
    mutationFn: api.createGiftcode,
    onSuccess: (res) => done(res?.count > 1 ? `Đã tạo ${res.count} mã` : `Đã tạo mã ${res.code}`),
    onError: fail,
  });
  const updateMut = useMutation({
    mutationFn: ({ code, data }) => api.updateGiftcode(code, data),
    onSuccess: () => done("Đã lưu thay đổi"),
    onError: fail,
  });
  const toggleMut = useMutation({
    mutationFn: api.toggleGiftcode,
    onSuccess: () => { qc.invalidateQueries(["giftcodes"]); },
    onError: fail,
  });
  const delMut = useMutation({
    mutationFn: api.deleteGiftcode,
    onSuccess: () => { qc.invalidateQueries(["giftcodes"]); toast.success("Đã xoá mã"); },
    onError: fail,
  });

  const filtered = giftcodes.filter(
    (g) => !search || g.code.toLowerCase().includes(search.toLowerCase()),
  );

  function openCreate() {
    setEditTarget(null);
    setForm(EMPTY);
    setModal(true);
  }

  function openEdit(g) {
    setEditTarget(g);
    setForm({
      rewardType: g.rewardType,
      code: g.code,
      count: "",
      amount: g.amount ? String(g.amount) : "",
      quotaMinM: g.quotaMinM ? String(g.quotaMinM) : "",
      quotaMaxM: g.quotaMaxM ? String(g.quotaMaxM) : "",
      keyRpm: g.keyRpm ? String(g.keyRpm) : "",
      keyValidDays: g.keyValidDays ? String(g.keyValidDays) : "",
      maxUses: g.maxUses ? String(g.maxUses) : "",
      perUserLimit: g.perUserLimit ? String(g.perUserLimit) : "",
      vipOnly: g.vipOnly ? String(g.vipOnly) : "",
      expiresAt: toLocalInput(g.expiresAt),
      note: g.note || "",
    });
    setModal(true);
  }

  function submit() {
    const isKey = form.rewardType === "APIKEY";

    if (editTarget) {
      const body = {
        maxUses: form.maxUses.trim(),
        perUserLimit: form.perUserLimit.trim() || 1,
        vipOnly: form.vipOnly.trim() || 0,
        expiresAt: form.expiresAt || "",
        note: form.note.trim(),
      };
      if (isKey) {
        body.quotaMinM = form.quotaMinM.trim() || QUOTA_MIN_M;
        body.quotaMaxM = form.quotaMaxM.trim() || QUOTA_MAX_M;
        body.keyRpm = form.keyRpm.trim() || 0;
        body.keyValidDays = form.keyValidDays.trim() || 0;
        if (Number(body.quotaMaxM) < Number(body.quotaMinM)) {
          return toast.error("Quota tối đa phải >= quota tối thiểu");
        }
      } else {
        body.amount = form.amount.trim();
        if (!body.amount || Number(body.amount) <= 0) return toast.error("Nhập số tiền cộng vào ví");
      }
      updateMut.mutate({ code: editTarget.code, data: body });
      return;
    }

    const count = Number(form.count) || 1;
    const body = {
      rewardType: form.rewardType,
      code: count > 1 ? (form.code.trim() || "GIFT") : (form.code.trim().toUpperCase() || null),
      count,
      maxUses: form.maxUses.trim() || null,
      perUserLimit: form.perUserLimit.trim() || 1,
      vipOnly: form.vipOnly.trim() || 0,
      expiresAt: form.expiresAt || null,
      note: form.note.trim() || null,
    };
    if (isKey) {
      body.quotaMinM = form.quotaMinM.trim() || undefined;
      body.quotaMaxM = form.quotaMaxM.trim() || undefined;
      body.keyRpm = form.keyRpm.trim() || undefined;
      body.keyValidDays = form.keyValidDays.trim() || undefined;
      const mn = Number(body.quotaMinM ?? QUOTA_MIN_M);
      const mx = Number(body.quotaMaxM ?? QUOTA_MAX_M);
      if (mx < mn) return toast.error("Quota tối đa phải >= quota tối thiểu");
    } else {
      body.amount = form.amount.trim();
      if (!body.amount || Number(body.amount) <= 0) return toast.error("Nhập số tiền cộng vào ví");
    }
    createMut.mutate(body);
  }

  const isKey = form.rewardType === "APIKEY";
  const isBusy = createMut.isPending || updateMut.isPending;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="space-y-4 pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-1">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="eyebrow text-slate-400">MARKETING // GIFTCODES CAMPAIGN</span>
            <span className="w-1 h-1 rounded-full bg-slate-600" />
            <span className="text-[10px] font-mono text-indigo-400">REDEEM ENGINE</span>
          </div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            Mã quà tặng (Giftcodes)
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/25">
              {giftcodes.length} MÃ
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 tracking-tight">
            Phát mã nạp ví miễn phí hoặc cấp mã nhận key API theo quota ngẫu nhiên ({QUOTA_MIN_M}–{QUOTA_MAX_M}M token)
          </p>
        </div>

        <div>
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-mono font-medium transition-all shadow-sm cursor-pointer"
          >
            <Plus size={13} />
            <span>TẠO GIFTCODE</span>
          </button>
        </div>
      </div>

      {/* Main Bento Card Container */}
      <div className="bento-card p-4 space-y-3.5">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm mã giftcode..."
            className="dev-input w-full pl-7 pr-3 py-1 text-xs font-mono"
          />
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-xs font-mono text-slate-500 animate-pulse">
            ĐANG TẢI GIFTCODES...
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Gift} message="Chưa có giftcode nào" action="Tạo giftcode" onAction={openCreate} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-800/80">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-900/60 border-b border-slate-800/80 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                  <th className="px-3.5 py-2.5 font-medium">MÃ</th>
                  <th className="px-3 py-2.5 font-medium">PHẦN THƯỞNG</th>
                  <th className="px-3 py-2.5 font-medium">LƯỢT ĐỔI</th>
                  <th className="px-3 py-2.5 font-medium">ĐIỀU KIỆN</th>
                  <th className="px-3 py-2.5 font-medium">HẠN DÙNG</th>
                  <th className="px-3 py-2.5 font-medium">TRẠNG THÁI</th>
                  <th className="px-3.5 py-2.5 font-medium text-right">THAO TÁC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {filtered.map((g) => (
                  <tr key={g.id || g.code} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-3.5 py-3 font-mono font-semibold text-indigo-400 whitespace-nowrap text-xs">
                      {g.code}
                    </td>
                    <td className="px-3 py-3 text-slate-200 whitespace-nowrap font-mono">
                      {g.rewardType === "APIKEY" ? (
                        <span className="text-cyan-300">🔑 Key {g.quotaMinM || QUOTA_MIN_M}–{g.quotaMaxM || QUOTA_MAX_M}M tokens</span>
                      ) : (
                        <span className="text-emerald-400">💰 {formatCurrency(g.amount)}</span>
                      )}
                    </td>
                    <td className="px-3 py-3 font-mono text-slate-400 whitespace-nowrap">
                      {g.usedCount ?? 0}{g.maxUses ? ` / ${g.maxUses}` : ""}
                    </td>
                    <td className="px-3 py-3 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                      {`Mỗi khách ${g.perUserLimit || 1}×`}{g.vipOnly ? ` · VIP ${g.vipOnly}+` : ""}
                    </td>
                    <td className="px-3 py-3 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                      {g.expiresAt ? formatDate(g.expiresAt) : "Không"}
                    </td>
                    <td className="px-3 py-3">
                      {g.isActive ? (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950/40 text-emerald-400 border border-emerald-800/40">
                          ACTIVE
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-900 text-slate-500 border border-slate-800">
                          TẮT
                        </span>
                      )}
                    </td>
                    <td className="px-3.5 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => openEdit(g)}
                          title="Sửa giftcode"
                          className="p-1 text-slate-400 hover:text-indigo-400 hover:bg-slate-800/60 rounded border border-transparent hover:border-slate-700 transition-all cursor-pointer"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => setRedeemFor(g.code)}
                          title="Lịch sử đổi"
                          className="p-1 text-slate-400 hover:text-cyan-400 hover:bg-slate-800/60 rounded border border-transparent hover:border-slate-700 transition-all cursor-pointer"
                        >
                          <History size={13} />
                        </button>
                        <button
                          onClick={() => toggleMut.mutate(g.code)}
                          title={g.isActive ? "Tắt mã" : "Bật mã"}
                          className={`p-1 rounded border border-transparent hover:border-slate-700 transition-all cursor-pointer ${
                            g.isActive ? "text-slate-400 hover:text-amber-400 hover:bg-slate-800/60" : "text-amber-400 hover:text-emerald-400 hover:bg-slate-800/60"
                          }`}
                        >
                          <Power size={13} />
                        </button>
                        <button
                          onClick={() => { if (confirm(`Xoá mã ${g.code}?`)) delMut.mutate(g.code); }}
                          title="Xóa mã"
                          className="p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-800/60 rounded border border-transparent hover:border-slate-700 transition-all cursor-pointer"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Tạo / Sửa Modal */}
      <Modal open={modal} onClose={() => { setModal(false); setEditTarget(null); }}
        title={editTarget ? `Sửa giftcode ${editTarget.code}` : "Tạo giftcode mới"}>
        <div className="space-y-3.5 text-xs font-mono">
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">Loại phần thưởng</label>
              <select
                value={form.rewardType}
                onChange={set("rewardType")}
                disabled={!!editTarget}
                className="w-full dev-input px-3 py-2 text-xs disabled:opacity-50"
              >
                <option value="WALLET">Cộng tiền vào ví</option>
                <option value="APIKEY">Cấp API key miễn phí</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">
                Mã {editTarget ? "" : "(bỏ trống = tự sinh)"}
              </label>
              <input
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                disabled={!!editTarget}
                className="w-full dev-input px-3 py-2 text-xs uppercase disabled:opacity-50"
                placeholder="TET2026"
              />
            </div>
          </div>

          {!editTarget && (
            <div>
              <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">Tạo nhiều mã ngẫu nhiên (bỏ trống = 1)</label>
              <input
                type="number"
                min="1"
                max="200"
                value={form.count}
                onChange={set("count")}
                className="w-full dev-input px-3 py-2 text-xs"
                placeholder="1"
              />
              {Number(form.count) > 1 && (
                <p className="text-[10px] text-slate-500 mt-1">Ô "Mã" thành tiền tố. Mỗi mã dùng 1 lần.</p>
              )}
            </div>
          )}

          {isKey ? (
            <>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">Quota tối thiểu (triệu token)</label>
                  <input
                    type="number"
                    value={form.quotaMinM}
                    onChange={set("quotaMinM")}
                    className="w-full dev-input px-3 py-2 text-xs"
                    placeholder={String(QUOTA_MIN_M)}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">Quota tối đa (triệu token)</label>
                  <input
                    type="number"
                    value={form.quotaMaxM}
                    onChange={set("quotaMaxM")}
                    className="w-full dev-input px-3 py-2 text-xs"
                    placeholder={String(QUOTA_MAX_M)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">RPM của key (0 = mặc định)</label>
                  <input
                    type="number"
                    value={form.keyRpm}
                    onChange={set("keyRpm")}
                    className="w-full dev-input px-3 py-2 text-xs"
                    placeholder="300"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">Hạn dùng ngày (0 = không)</label>
                  <input
                    type="number"
                    value={form.keyValidDays}
                    onChange={set("keyValidDays")}
                    className="w-full dev-input px-3 py-2 text-xs"
                    placeholder="0"
                  />
                </div>
              </div>
            </>
          ) : (
            <div>
              <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">Số tiền cộng vào ví (VND)</label>
              <input
                type="number"
                value={form.amount}
                onChange={set("amount")}
                className="w-full dev-input px-3 py-2 text-xs"
                placeholder="50000"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">Tổng lượt dùng (trống = ∞)</label>
              <input
                type="number"
                value={form.maxUses}
                onChange={set("maxUses")}
                className="w-full dev-input px-3 py-2 text-xs"
                placeholder="Không giới hạn"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">Mỗi khách được đổi</label>
              <input
                type="number"
                value={form.perUserLimit}
                onChange={set("perUserLimit")}
                className="w-full dev-input px-3 py-2 text-xs"
                placeholder="1"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">VIP tối thiểu (0 = mọi user)</label>
              <input
                type="number"
                value={form.vipOnly}
                onChange={set("vipOnly")}
                className="w-full dev-input px-3 py-2 text-xs"
                placeholder="0"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">Hết hạn (trống = không)</label>
              <input
                type="datetime-local"
                value={form.expiresAt}
                onChange={set("expiresAt")}
                className="w-full dev-input px-3 py-2 text-xs"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">Ghi chú hiện cho khách</label>
            <input
              value={form.note}
              onChange={set("note")}
              className="w-full dev-input px-3 py-2 text-xs font-sans"
              placeholder="Chúc mừng năm mới 2026"
            />
          </div>

          <button
            onClick={submit}
            disabled={isBusy}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-mono font-medium disabled:opacity-50 transition-all cursor-pointer shadow-sm mt-2"
          >
            {isBusy ? "ĐANG LƯU..." : editTarget ? "LƯU THAY ĐỔI" : "TẠO GIFTCODE"}
          </button>
        </div>
      </Modal>

      {/* Lịch sử đổi */}
      <RedemptionsModal code={redeemFor} onClose={() => setRedeemFor(null)} />

      <ToastContainer toasts={toast.toasts} onRemove={toast.removeToast} />
    </div>
  );
}

function RedemptionsModal({ code, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ["giftcode-redemptions", code],
    queryFn: () => api.giftcodeRedemptions(code, { limit: 100 }),
    enabled: !!code,
  });
  const rows = data?.redemptions || [];

  return (
    <Modal open={!!code} onClose={onClose} title={`Lịch sử đổi mã #${code || ""}`} width="max-w-xl">
      {isLoading ? (
        <p className="text-xs font-mono text-slate-500 py-6 text-center animate-pulse">ĐANG TẢI LỊCH SỬ...</p>
      ) : rows.length === 0 ? (
        <p className="text-xs font-mono text-slate-500 py-6 text-center">Chưa có ai đổi mã này.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800/80">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-900/60 border-b border-slate-800/80 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                <th className="px-3 py-2 font-medium">TELEGRAM ID</th>
                <th className="px-3 py-2 font-medium">PHẦN THƯỞNG</th>
                <th className="px-3 py-2 font-medium">TRẠNG THÁI</th>
                <th className="px-3 py-2 font-medium text-right">THỜI GIAN</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-3 py-2 text-indigo-400 font-semibold">{r.telegramId}</td>
                  <td className="px-3 py-2 text-slate-200">
                    {r.rewardType === "APIKEY"
                      ? `🔑 ${((r.quotaTokens || 0) / 1e6)}M token`
                      : `💰 ${formatCurrency(r.amount)}`}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                      r.status === "SUCCESS"
                        ? "bg-emerald-950/40 text-emerald-400 border-emerald-800/40"
                        : "bg-slate-900 text-slate-500 border-slate-800"
                    }`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-slate-500 text-right">{formatDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
