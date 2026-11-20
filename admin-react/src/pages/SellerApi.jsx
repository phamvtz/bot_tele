import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Key,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Copy,
  Check,
  BookOpen,
  Wallet,
  Edit3,
  User,
  ShieldCheck,
  X,
} from "lucide-react";
import { api } from "../api/endpoints";
import { formatCurrency } from "../utils/format";

const BASE_URL = window.location.origin.replace(/\/$/, "") + "/api/seller";

function CodeBlock({ children }) {
  return (
    <pre className="bg-[#050811] border border-slate-800/80 rounded-md px-3 py-2 text-xs font-mono text-emerald-400 overflow-x-auto whitespace-pre-wrap">
      {children}
    </pre>
  );
}

export default function SellerApi() {
  const [newName, setNewName] = useState("");
  const [newTelegramId, setNewTelegramId] = useState("");
  const [newRole, setNewRole] = useState("SUPPLIER");
  const [newKey, setNewKey] = useState(null); // full key shown once after create
  const [copiedId, setCopiedId] = useState(null);
  const [activeTab, setActiveTab] = useState("keys");
  const [editingKey, setEditingKey] = useState(null);
  const [editName, setEditName] = useState("");
  const [editTelegramId, setEditTelegramId] = useState("");
  const [editRole, setEditRole] = useState("RESELLER");
  const [editMaxKeys, setEditMaxKeys] = useState("0");
  const [editMaxTokens, setEditMaxTokens] = useState("0");

  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["seller-keys"],
    queryFn: api.sellerKeys,
  });
  const keys = data?.keys || [];

  const createMut = useMutation({
    mutationFn: () =>
      api.createSellerKey({
        name: newName.trim(),
        telegramId: newTelegramId.trim() || undefined,
        role: newRole,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries(["seller-keys"]);
      setNewKey(res.key);
      setNewName("");
      setNewTelegramId("");
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, name, telegramId, role, maxKeysPerDay, maxTokensPerDay }) =>
      api.updateSellerKey(id, { name, telegramId, role, maxKeysPerDay, maxTokensPerDay }),
    onSuccess: () => {
      qc.invalidateQueries(["seller-keys"]);
      setEditingKey(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id) => api.deleteSellerKey(id),
    onSuccess: () => qc.invalidateQueries(["seller-keys"]),
  });

  const toggleMut = useMutation({
    mutationFn: (id) => api.toggleSellerKey(id),
    onSuccess: () => qc.invalidateQueries(["seller-keys"]),
  });

  function copyText(text, id) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function startEdit(k) {
    setEditingKey(k);
    setEditName(k.name || "");
    setEditTelegramId(k.telegramId || "");
    setEditRole(k.role === "SUPPLIER" ? "SUPPLIER" : "RESELLER");
    setEditMaxKeys(String(k.maxKeysPerDay || 0));
    setEditMaxTokens(String(k.maxTokensPerDay || 0));
  }

  function handleSaveEdit(e) {
    e.preventDefault();
    if (!editingKey) return;
    updateMut.mutate({
      id: editingKey.id,
      name: editName.trim(),
      telegramId: editTelegramId.trim(),
      role: editRole,
      maxKeysPerDay: Number(editMaxKeys) || 0,
      maxTokensPerDay: Number(editMaxTokens) || 0,
    });
  }

  return (
    <div className="space-y-4 pb-10">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="eyebrow text-slate-400">SUPPLIERS // REMOTE REST API</span>
          <span className="w-1 h-1 rounded-full bg-slate-600" />
          <span className="text-[10px] font-mono text-emerald-400">STOCK INGESTION & AUTO WALLET</span>
        </div>
        <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
          API cho Seller
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/25">
            {keys.length} KEYS
          </span>
        </h1>
        <p className="text-xs text-slate-400 mt-0.5 tracking-tight">
          Cấp token bảo mật cho đối tác/seller kết nối qua API. Hỗ trợ liên kết tài khoản Telegram để tự động trừ số dư ví khi gọi API tạo key.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-900/80 border border-slate-800/80 rounded-lg w-fit">
        {[
          ["keys", "API KEYS"],
          ["docs", "TÀI LIỆU API"],
        ].map(([k, l]) => (
          <button
            key={k}
            onClick={() => setActiveTab(k)}
            className={`text-[11px] font-mono px-3 py-1 rounded-md transition-all cursor-pointer ${
              activeTab === k
                ? "bg-indigo-600 text-white font-medium shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {/* ── Keys Tab ── */}
      {activeTab === "keys" && (
        <div className="space-y-4">
          {/* New key alert */}
          {newKey && (
            <div className="bento-card border-emerald-500/30 bg-emerald-950/20 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-semibold text-emerald-400 flex items-center gap-1.5">
                  <Check size={14} /> KHỞI TẠO KEY THÀNH CÔNG — LƯU LẠI NGAY, SẼ KHÔNG HIỂN THỊ LẠI
                </span>
                <button
                  onClick={() => setNewKey(null)}
                  className="text-[11px] font-mono text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                >
                  ĐÓNG
                </button>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-[#050811] text-emerald-300 text-xs font-mono px-3 py-2 rounded border border-emerald-500/30 break-all select-all">
                  {newKey.key}
                </code>
                <button
                  onClick={() => copyText(newKey.key, "new")}
                  className="px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded text-xs font-mono flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  {copiedId === "new" ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  {copiedId === "new" ? "ĐÃ COPY" : "COPY"}
                </button>
              </div>
            </div>
          )}

          {/* Create key toolbar */}
          <div className="bento-card p-4 space-y-3">
            <div className="text-xs font-mono text-slate-300 flex items-center gap-2">
              <Key size={15} className="text-indigo-400" />
              TẠO API KEY CHO ĐỐI TÁC / SELLER
            </div>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
              <div className="md:col-span-4">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && newName.trim() && createMut.mutate()}
                  placeholder="Tên định danh (vd: Nhà cung cấp Alpha, Đại lý Nam...)"
                  className="dev-input w-full px-3 py-2 text-xs font-mono"
                />
              </div>
              <div className="md:col-span-4">
                <div className="relative">
                  <Wallet size={14} className="absolute left-3 top-2.5 text-slate-500" />
                  <input
                    value={newTelegramId}
                    onChange={(e) => setNewTelegramId(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && newName.trim() && createMut.mutate()}
                    placeholder="Telegram ID liên kết ví (vd: 5912345678)"
                    className="dev-input w-full pl-9 pr-3 py-2 text-xs font-mono"
                  />
                </div>
              </div>
              <div className="md:col-span-2">
                <select
                  aria-label="Quyền key Seller"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="dev-input w-full px-2.5 py-2 text-xs font-mono"
                >
                  <option value="RESELLER">RESELLER (Chỉ Key AI)</option>
                  <option value="SUPPLIER">SUPPLIER (Kho + Shop)</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <button
                  onClick={() => createMut.mutate()}
                  disabled={!newName.trim() || createMut.isPending}
                  className="w-full flex items-center justify-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-xs font-mono font-medium transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <Plus size={14} /> TẠO KEY
                </button>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 flex items-center gap-1">
              <ShieldCheck size={12} className="text-emerald-500" />
              Khi seller có gắn Telegram ID, họ nạp tiền qua Bot Telegram rồi gọi API tạo key, hệ thống sẽ tự động trừ số dư ví của họ.
            </p>
          </div>

          {/* Key list table */}
          <div className="bento-card overflow-hidden">
            {isLoading ? (
              <p className="text-xs font-mono text-slate-500 text-center py-12 animate-pulse">
                ĐANG TẢI API KEYS...
              </p>
            ) : keys.length === 0 ? (
              <p className="text-xs font-mono text-slate-500 text-center py-12">
                CHƯA CÓ API KEY NÀO CHO SELLER
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs min-w-[760px]">
                  <thead>
                    <tr className="border-b border-slate-800/80 text-[10px] font-mono uppercase tracking-wider text-slate-400 bg-slate-900/40">
                      <th className="px-4 py-2.5">TÊN ĐỐI TÁC</th>
                      <th className="px-4 py-2.5">QUYỀN / TRẦN</th>
                      <th className="px-4 py-2.5">KEY (ẨN)</th>
                      <th className="px-4 py-2.5">VÍ BOT TELEGRAM</th>
                      <th className="px-4 py-2.5">NGÀY TẠO</th>
                      <th className="px-4 py-2.5">TRẠNG THÁI</th>
                      <th className="px-4 py-2.5 text-right">THAO TÁC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {keys.map((k) => (
                      <tr key={k.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-200">{k.name}</div>
                          {k.telegramId && (
                            <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                              <User size={11} className="text-slate-500" />
                              {k.userName ? `@${k.userName.replace(/^@+/, "")}` : k.userFirstName || `ID: ${k.telegramId}`}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                              k.role === "SUPPLIER"
                                ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/30"
                                : "bg-emerald-500/10 text-emerald-300 border-emerald-500/25"
                            }`}
                          >
                            {k.role || "SUPPLIER"}
                          </span>
                          {(k.maxKeysPerDay > 0 || k.maxTokensPerDay > 0) && (
                            <div className="text-[10px] font-mono text-slate-400 mt-1">
                              {k.maxKeysPerDay > 0 ? `${k.maxKeysPerDay} key/ng` : "∞ key"}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <code className="font-mono text-xs text-slate-400 bg-slate-900/60 px-2 py-0.5 rounded border border-slate-800">
                            {k.key}
                          </code>
                        </td>
                        <td className="px-4 py-3">
                          {k.telegramId ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 font-mono text-xs text-emerald-400 font-medium">
                                <Wallet size={12} className="text-emerald-500" />
                                {formatCurrency(k.balance ?? 0)}
                              </div>
                              <div className="text-[10px] font-mono text-slate-400">
                                TG ID: <span className="text-slate-300 font-semibold">{k.telegramId}</span>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => startEdit(k)}
                              className="text-[10px] font-mono text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-2 py-1 rounded border border-amber-500/20 transition-colors cursor-pointer"
                            >
                              + Gắn ví Telegram
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
                          {new Date(k.createdAt).toLocaleDateString("vi-VN")}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => toggleMut.mutate(k.id)}
                            className={`inline-flex items-center gap-1 text-[11px] font-mono cursor-pointer transition-colors ${
                              k.active !== false ? "text-emerald-400" : "text-slate-500"
                            }`}
                          >
                            {k.active !== false ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                            {k.active !== false ? "ACTIVE" : "DISABLED"}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => startEdit(k)}
                              title="Chỉnh sửa / Đổi ví liên kết"
                              className="text-slate-400 hover:text-indigo-400 transition-colors cursor-pointer p-1.5 hover:bg-slate-800 rounded"
                            >
                              <Edit3 size={13} />
                            </button>
                            <button
                              onClick={() => confirm(`Xóa key "${k.name}"?`) && deleteMut.mutate(k.id)}
                              title="Xóa key"
                              className="text-slate-500 hover:text-rose-400 transition-colors cursor-pointer p-1.5 hover:bg-slate-800 rounded"
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

          {/* Edit Modal */}
          {editingKey && (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
              <div className="bento-card max-w-md w-full p-5 space-y-4 border-indigo-500/40">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                    <Edit3 size={15} className="text-indigo-400" />
                    Chỉnh sửa Seller API Key
                  </h3>
                  <button
                    onClick={() => setEditingKey(null)}
                    className="text-slate-500 hover:text-slate-300 cursor-pointer"
                  >
                    <X size={16} />
                  </button>
                </div>

                <form onSubmit={handleSaveEdit} className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-mono text-slate-400 mb-1">
                      TÊN ĐỐI TÁC / SELLER
                    </label>
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      required
                      className="dev-input w-full px-3 py-2 text-xs font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono text-slate-400 mb-1">
                      TELEGRAM ID LIÊN KẾT VÍ
                    </label>
                    <input
                      value={editTelegramId}
                      onChange={(e) => setEditTelegramId(e.target.value)}
                      placeholder="vd: 5912345678 (để trống nếu không gắn)"
                      className="dev-input w-full px-3 py-2 text-xs font-mono"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      Nhập số Telegram ID của Seller. Seller nạp tiền vào bot bằng tài khoản Telegram này, khi gọi API hệ thống sẽ tự động trừ ví.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-mono text-slate-400 mb-1">
                        QUYỀN TRUY CẬP
                      </label>
                      <select
                        value={editRole}
                        onChange={(e) => setEditRole(e.target.value)}
                        className="dev-input w-full px-3 py-2 text-xs font-mono"
                      >
                        <option value="RESELLER">RESELLER (Chỉ Key AI)</option>
                        <option value="SUPPLIER">SUPPLIER (Kho + Đơn shop)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-mono text-slate-400 mb-1">
                        TRẦN KEY / NGÀY (0 = ∞)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={editMaxKeys}
                        onChange={(e) => setEditMaxKeys(e.target.value)}
                        className="dev-input w-full px-3 py-2 text-xs font-mono"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setEditingKey(null)}
                      className="px-3 py-1.5 rounded text-xs font-mono text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      HỦY
                    </button>
                    <button
                      type="submit"
                      disabled={updateMut.isPending}
                      className="px-4 py-1.5 rounded text-xs font-mono font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {updateMut.isPending ? "ĐANG LƯU..." : "LƯU THAY ĐỔI"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Docs Tab ── */}
      {activeTab === "docs" && (
        <div className="space-y-4">
          <div className="bento-card p-4 space-y-3">
            <h2 className="text-xs font-mono font-semibold text-slate-200 flex items-center gap-2">
              <BookOpen size={14} className="text-indigo-400" /> HƯỚNG DẪN KẾT NỐI API & TỰ ĐỘNG TRỪ VÍ
            </h2>
            <div className="space-y-2 text-xs text-slate-300">
              <p>
                <strong>Quy trình hoạt động:</strong>
              </p>
              <ol className="list-decimal pl-5 space-y-1 text-slate-400">
                <li>Admin tạo API key cho Seller và gắn kèm <strong>Telegram ID</strong> của Seller.</li>
                <li>Seller nạp tiền trực tiếp vào tài khoản bot Telegram của họ (qua lệnh nạp tiền / QR chuyển khoản).</li>
                <li>Seller gửi HTTP request kèm header <code className="text-emerald-400">Authorization: Bearer sk_...</code>.</li>
                <li>Khi gọi tạo key AI GPT (<code className="text-emerald-400">POST /keys</code>), hệ thống tự động kiểm tra số dư ví Telegram, quy đổi USD sang VND, và trừ tiền ví ngay lập tức.</li>
                <li>Nếu server AI trả về lỗi hoặc từ chối tạo key, hệ thống <strong>tự động hoàn tiền 100%</strong> vào ví của Seller.</li>
              </ol>
            </div>
            <div className="pt-2">
              <p className="text-xs font-mono text-slate-400 mb-1">Thêm API key vào header của mỗi request:</p>
              <CodeBlock>Authorization: Bearer sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</CodeBlock>
            </div>
            <p className="text-xs font-mono text-slate-400 mt-2">
              Base URL: <code className="text-indigo-300 font-semibold">{BASE_URL}</code>
            </p>
          </div>

          {[
            {
              method: "GET",
              path: "/me",
              title: "Thông tin Seller & Số dư ví",
              desc: "Kiểm tra quyền hạn API key, Telegram ID liên kết và số dư ví VND hiện tại.",
              response: `{
  "ok": true,
  "seller": {
    "name": "Đại lý Nam",
    "telegramId": "5912345678",
    "walletBalance": 500000,
    "user": {
      "firstName": "Nam",
      "username": "nam_reseller"
    }
  }
}`,
            },
            {
              method: "GET",
              path: "/balance",
              title: "Xem nhanh số dư ví",
              desc: "Endpoint ngắn gọn để bot/server của seller check số dư ví.",
              response: `{
  "ok": true,
  "telegramId": "5912345678",
  "balance": 500000,
  "active": true
}`,
            },
            {
              method: "GET",
              path: "/profiles",
              title: "Danh sách gói Key AI & Giá",
              desc: "Lấy danh sách các gói key (OpenAI GPT-4o, Claude, v.v.), đơn giá USD/VND và hạn dùng.",
              response: `{
  "profiles": [
    {
      "id": "gpt4o_general",
      "name": "GPT-4o Standard",
      "pricePerMillion": 0.5,
      "pricePerDay": 0.05,
      "minTokens": 100000,
      "maxTokens": 50000000
    }
  ]
}`,
            },
            {
              method: "POST",
              path: "/keys",
              title: "Tạo Key AI (Trừ tiền ví tự động)",
              desc: "Tạo API key AI cho khách. Hệ thống tự động trừ tiền ví của Seller.",
              body: `{
  "profileId": "gpt4o_general",
  "quotaTokens": 1000000,
  "name": "Khách A - 1M Tokens",
  "validDays": 30,
  "clientRef": "MY_ORDER_12345"
}`,
              response: `{
  "ok": true,
  "id": "ck...123",
  "key": "sk-gpt2api-xxxxxxxxxxxxxxxxxxxxxxxx",
  "keyMasked": "sk-gpt2...9a4c",
  "quotaTokens": 1000000,
  "validDays": 30,
  "expiresAt": "2026-11-30T15:00:00.000Z",
  "priceUsd": 2.0,
  "priceVnd": 51200,
  "newBalance": 448800
}`,
            },
            {
              method: "PATCH",
              path: "/keys/:id",
              title: "Gia hạn Key AI (Trừ ví tự động)",
              desc: "Nạp thêm token hoặc gia hạn thêm ngày sử dụng cho key. Tự động trừ tiền ví seller.",
              body: `{
  "addTokens": 500000,
  "addDays": 30,
  "clientRef": "RENEW_SELLER_002"
}`,
              response: `{
  "ok": true,
  "id": "ck...123",
  "addTokens": 500000,
  "addDays": 30,
  "quotaTokens": 1500000,
  "renewCount": 1,
  "valueUsd": 1.25,
  "priceVnd": 32000,
  "newBalance": 416800
}`,
            },
            {
              method: "PATCH",
              path: "/keys/:id/enabled",
              title: "Tắt / Mở Key AI",
              desc: "Bật hoặc tạm khóa key của khách mà không thu hồi (enabled: true/false).",
              body: `{ "enabled": false }`,
              response: `{ "ok": true, "id": "ck...123", "enabled": false }`,
            },
            {
              method: "DELETE",
              path: "/keys/:id",
              title: "Thu hồi / Ẩn Key AI",
              desc: "Thu hồi vĩnh viễn key phía nhà cung cấp AI (?revoke=true) hoặc chỉ ẩn.",
              response: `{ "ok": true, "id": "ck...123", "providerRevoked": true, "stillUsable": false }`,
            },
            {
              method: "GET",
              path: "/keys",
              title: "Danh sách key AI đã cấp",
              desc: "Xem danh sách các key do seller tạo (key hiển thị dạng ẩn sk-... để bảo mật).",
              response: `{
  "ok": true,
  "items": [
    {
      "id": "ck...123",
      "key": "sk-gpt2...9a4c",
      "name": "Khách A - 1M Tokens",
      "status": "active",
      "quotaTokens": 1000000,
      "expiresAt": "2026-11-30T15:00:00.000Z"
    }
  ]
}`,
            },
            {
              method: "GET",
              path: "/products",
              title: "Danh sách sản phẩm thông thường",
              desc: "Lấy toàn bộ sản phẩm shop kèm tồn kho kho thẻ/tài khoản.",
              response: `{ "products": [{ "id": "...", "name": "KIRO PRO", "price": 30000, "deliveryMode": "STOCK_LINES", "stock": 15 }] }`,
            },
            {
              method: "POST",
              path: "/stock",
              title: "Nạp stock (JSON array)",
              desc: "Upload danh sách tài khoản/mã vào sản phẩm.",
              body: `{ "productId": "clx...", "lines": ["user1:pass1", "user2:pass2"] }`,
              response: `{ "ok": true, "added": 2, "totalStock": 17, "product": "KIRO PRO" }`,
            },
            {
              method: "GET",
              path: "/orders",
              title: "Danh sách đơn hàng",
              desc: "Lấy đơn hàng đã đặt. status: PENDING | PAID | DELIVERED | CANCELED",
              response: `{ "orders": [{ "id": "...", "shortId": "ABC12345", "amount": 30000, "status": "DELIVERED" }] }`,
            },
          ].map(({ method, path, title, desc, body, response }) => (
            <div key={path} className="bento-card p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                    method === "GET"
                      ? "bg-cyan-950/60 text-cyan-300 border-cyan-800/40"
                      : "bg-emerald-950/60 text-emerald-300 border-emerald-800/40"
                  }`}
                >
                  {method}
                </span>
                <code className="text-xs text-slate-200 font-mono font-medium">
                  {BASE_URL}
                  {path}
                </code>
              </div>
              <p className="text-xs text-slate-400 tracking-tight">
                <strong>{title}</strong> — {desc}
              </p>
              {body && (
                <>
                  <p className="text-[11px] font-mono text-slate-500 uppercase tracking-wider">
                    Request payload:
                  </p>
                  <CodeBlock>{body}</CodeBlock>
                </>
              )}
              <p className="text-[11px] font-mono text-slate-500 uppercase tracking-wider">
                Response preview:
              </p>
              <CodeBlock>{response}</CodeBlock>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
