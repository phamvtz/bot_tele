import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Gift, Trash2, Pencil, Search, History, Power } from "lucide-react";
import { api } from "../api/endpoints";
import Modal from "../components/Modal";
import EmptyState from "../components/EmptyState";
import { ToastContainer, useToast } from "../components/Toast";
import { formatCurrency, formatDate } from "../utils/format";

// Miền quota mặc định của mã API key — khớp FREE_MIN_M / FREE_MAX_M trong
// src/apikey-pricing.js. Đổi bên đó thì đổi cả ở đây.
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
  const [redeemFor, setRedeemFor] = useState(null); // code đang xem lịch sử
  const qc = useQueryClient();
  const toast = useToast();

  const { data } = useQuery({ queryKey: ["giftcodes"], queryFn: () => api.giftcodes({ limit: 200 }) });
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
      // Sửa: chỉ gửi field cấu hình. "" = xoá về mặc định (server hiểu).
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

    // Tạo mới
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
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">Mã quà tặng</h1>
        <button onClick={openCreate}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 transition-colors shadow-glow-sm hover:shadow-glow">
          <Plus size={15} />
          Tạo giftcode
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        Mã cộng tiền vào ví, hoặc cấp API key sk-* miễn phí (quota random {QUOTA_MIN_M}–{QUOTA_MAX_M}M token, số lớn hiếm hơn).
      </p>

      <div className="relative flex-1 min-w-[180px] max-w-xs mb-4">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm mã..."
          className="glass-input w-full pl-7 pr-3 py-1.5 text-sm rounded-lg" />
      </div>

      <div className="glass rounded-xl p-4">
        {filtered.length === 0 ? (
          <EmptyState icon={Gift} message="Chưa có giftcode nào" action="Tạo giftcode" onAction={openCreate} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-left text-xs text-gray-500">
                  <th className="px-3 py-2.5 font-medium rounded-l-lg">Mã</th>
                  <th className="px-3 py-2.5 font-medium">Phần thưởng</th>
                  <th className="px-3 py-2.5 font-medium">Đã dùng</th>
                  <th className="px-3 py-2.5 font-medium">Điều kiện</th>
                  <th className="px-3 py-2.5 font-medium">Hết hạn</th>
                  <th className="px-3 py-2.5 font-medium">Trạng thái</th>
                  <th className="px-3 py-2.5 font-medium rounded-r-lg">Hành động</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((g) => (
                  <tr key={g.id || g.code} className="border-b border-white/[0.04] hover:bg-white/[0.03]">
                    <td className="px-3 py-3 font-mono font-semibold text-primary-600 whitespace-nowrap">{g.code}</td>
                    <td className="px-3 py-3 text-gray-300 whitespace-nowrap">
                      {g.rewardType === "APIKEY"
                        ? <>🔑 key {g.quotaMinM || QUOTA_MIN_M}–{g.quotaMaxM || QUOTA_MAX_M}M token</>
                        : <>💰 {formatCurrency(g.amount)}</>}
                    </td>
                    <td className="px-3 py-3 text-gray-400 whitespace-nowrap">{g.usedCount ?? 0}{g.maxUses ? ` / ${g.maxUses}` : ""}</td>
                    <td className="px-3 py-3 text-xs text-gray-400 whitespace-nowrap">
                      {`Mỗi khách ${g.perUserLimit || 1}×`}{g.vipOnly ? ` · VIP ${g.vipOnly}+` : ""}
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-400 whitespace-nowrap">{g.expiresAt ? formatDate(g.expiresAt) : "Không"}</td>
                    <td className="px-3 py-3">
                      {g.isActive
                        ? <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400">Active</span>
                        : <span className="text-xs px-2 py-0.5 rounded bg-white/[0.08] text-gray-400">Tắt</span>}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <button onClick={() => openEdit(g)} title="Sửa" className="text-gray-400 hover:text-primary-500 transition-colors">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => setRedeemFor(g.code)} title="Lịch sử đổi" className="text-gray-400 hover:text-primary-500 transition-colors">
                          <History size={14} />
                        </button>
                        <button onClick={() => toggleMut.mutate(g.code)} title={g.isActive ? "Tắt" : "Bật"} className="text-gray-400 hover:text-amber-400 transition-colors">
                          <Power size={14} />
                        </button>
                        <button onClick={() => { if (confirm(`Xoá mã ${g.code}? (lịch sử đổi vẫn được giữ)`)) delMut.mutate(g.code); }} title="Xoá" className="text-gray-400 hover:text-red-500 transition-colors">
                          <Trash2 size={14} />
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

      {/* Tạo / Sửa */}
      <Modal open={modal} onClose={() => { setModal(false); setEditTarget(null); }}
        title={editTarget ? `Sửa giftcode ${editTarget.code}` : "Tạo giftcode mới"}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Loại phần thưởng</label>
              <select value={form.rewardType} onChange={set("rewardType")} disabled={!!editTarget}
                className="w-full glass-input rounded-lg px-3 py-2 text-sm disabled:opacity-50">
                <option value="WALLET">Cộng tiền vào ví</option>
                <option value="APIKEY">Cấp API key miễn phí</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">
                Mã {editTarget ? "" : "(bỏ trống = tự sinh)"}
              </label>
              <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                disabled={!!editTarget}
                className="w-full glass-input rounded-lg px-3 py-2 text-sm uppercase disabled:opacity-50 disabled:text-gray-500"
                placeholder="TET2026" />
            </div>
          </div>

          {!editTarget && (
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Tạo nhiều mã ngẫu nhiên (bỏ trống = 1)</label>
              <input type="number" min="1" max="200" value={form.count} onChange={set("count")}
                className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="1" />
              {Number(form.count) > 1 && (
                <p className="text-[11px] text-gray-500 mt-1">Ô "Mã" thành tiền tố. Mỗi mã dùng 1 lần.</p>
              )}
            </div>
          )}

          {isKey ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-400 block mb-1">Quota tối thiểu (triệu token)</label>
                  <input type="number" value={form.quotaMinM} onChange={set("quotaMinM")}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder={String(QUOTA_MIN_M)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400 block mb-1">Quota tối đa (triệu token)</label>
                  <input type="number" value={form.quotaMaxM} onChange={set("quotaMaxM")}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder={String(QUOTA_MAX_M)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-400 block mb-1">RPM của key (0 = theo cấu hình chung)</label>
                  <input type="number" value={form.keyRpm} onChange={set("keyRpm")}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="300" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400 block mb-1">Số ngày key hết hạn (0 = không)</label>
                  <input type="number" value={form.keyValidDays} onChange={set("keyValidDays")}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="0" />
                </div>
              </div>
            </>
          ) : (
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Số tiền cộng vào ví (VND)</label>
              <input type="number" value={form.amount} onChange={set("amount")}
                className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="50000" />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Tổng lượt dùng (bỏ trống = ∞)</label>
              <input type="number" value={form.maxUses} onChange={set("maxUses")}
                className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="Không giới hạn" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Mỗi khách được đổi</label>
              <input type="number" value={form.perUserLimit} onChange={set("perUserLimit")}
                className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="1" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">VIP tối thiểu (0 = không)</label>
              <input type="number" value={form.vipOnly} onChange={set("vipOnly")}
                className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="0" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Hết hạn (bỏ trống = không)</label>
              <input type="datetime-local" value={form.expiresAt} onChange={set("expiresAt")}
                className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Ghi chú hiện cho khách</label>
            <input value={form.note} onChange={set("note")}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="Chúc mừng năm mới" />
          </div>

          {editTarget && (
            <p className="text-[11px] text-gray-500">
              Sửa chỉ áp dụng cho lượt đổi sau — không đổi loại/mã, không thu hồi key đã cấp.
            </p>
          )}

          <button onClick={submit} disabled={isBusy}
            className="w-full py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors shadow-glow-sm hover:shadow-glow">
            {isBusy ? "Đang lưu..." : editTarget ? "Lưu thay đổi" : "Tạo giftcode"}
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
    <Modal open={!!code} onClose={onClose} title={`Lịch sử đổi — ${code || ""}`} width="max-w-xl">
      {isLoading ? (
        <p className="text-sm text-gray-500 py-6 text-center">Đang tải...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500 py-6 text-center">Chưa có ai đổi mã này.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-xs text-gray-500">
                <th className="px-2 py-2 font-medium">Telegram ID</th>
                <th className="px-2 py-2 font-medium">Nhận</th>
                <th className="px-2 py-2 font-medium">Trạng thái</th>
                <th className="px-2 py-2 font-medium">Lúc</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-white/[0.04]">
                  <td className="px-2 py-2 font-mono text-gray-300">{r.telegramId}</td>
                  <td className="px-2 py-2 text-gray-400">
                    {r.rewardType === "APIKEY"
                      ? `🔑 ${((r.quotaTokens || 0) / 1e6)}M token`
                      : `💰 ${formatCurrency(r.amount)}`}
                  </td>
                  <td className="px-2 py-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${r.status === "SUCCESS" ? "bg-emerald-500/15 text-emerald-400" : "bg-white/[0.08] text-gray-400"}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-xs text-gray-500">{formatDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
