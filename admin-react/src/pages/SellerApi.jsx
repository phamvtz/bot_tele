import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Key, Plus, Trash2, ToggleLeft, ToggleRight, Copy, Check, BookOpen } from "lucide-react";
import { api } from "../api/endpoints";

const BASE_URL = window.location.origin.replace(/\/$/, "") + "/api/seller";

function CodeBlock({ children }) {
  return (
    <pre className="bg-[#050811] border border-slate-800/80 rounded-md px-3 py-2 text-xs font-mono text-emerald-400 overflow-x-auto whitespace-pre-wrap">{children}</pre>
  );
}

export default function SellerApi() {
  const [newName, setNewName] = useState("");
  const [newKey, setNewKey] = useState(null); // full key shown once after create
  const [copiedId, setCopiedId] = useState(null);
  const [activeTab, setActiveTab] = useState("keys");
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ["seller-keys"], queryFn: api.sellerKeys });
  const keys = data?.keys || [];

  const createMut = useMutation({
    mutationFn: () => api.createSellerKey({ name: newName.trim() }),
    onSuccess: (res) => {
      qc.invalidateQueries(["seller-keys"]);
      setNewKey(res.key);
      setNewName("");
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

  return (
    <div className="space-y-4 pb-10">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="eyebrow text-slate-400">SUPPLIERS // REMOTE REST API</span>
          <span className="w-1 h-1 rounded-full bg-slate-600" />
          <span className="text-[10px] font-mono text-emerald-400">STOCK INGESTION</span>
        </div>
        <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
          API cho Seller
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/25">
            {keys.length} KEYS
          </span>
        </h1>
        <p className="text-xs text-slate-400 mt-0.5 tracking-tight">
          Cấp token bảo mật cho đối tác/nhà cung cấp tự động đẩy kho và đồng bộ đơn hàng từ xa
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-900/80 border border-slate-800/80 rounded-lg w-fit">
        {[["keys", "API KEYS"], ["docs", "TÀI LIỆU API"]].map(([k, l]) => (
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
          <div className="bento-card p-4 flex items-center gap-3">
            <Key size={16} className="text-slate-500 flex-shrink-0" />
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && newName.trim() && createMut.mutate()}
              placeholder="Tên định danh (vd: Nhà cung cấp Alpha, Supplier Beta...)"
              className="dev-input flex-1 px-3 py-1.5 text-xs font-mono"
            />
            <button
              onClick={() => createMut.mutate()}
              disabled={!newName.trim() || createMut.isPending}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-xs font-mono font-medium transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Plus size={13} /> TẠO KEY
            </button>
          </div>

          {/* Key list table */}
          <div className="bento-card overflow-hidden">
            {isLoading ? (
              <p className="text-xs font-mono text-slate-500 text-center py-12 animate-pulse">ĐANG TẢI API KEYS...</p>
            ) : keys.length === 0 ? (
              <p className="text-xs font-mono text-slate-500 text-center py-12">CHƯA CÓ API KEY NÀO CHO SELLER</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800/80 text-[10px] font-mono uppercase tracking-wider text-slate-400 bg-slate-900/40">
                    <th className="px-4 py-2.5">TÊN ĐỐI TÁC</th>
                    <th className="px-4 py-2.5">KEY (ẨN)</th>
                    <th className="px-4 py-2.5">NGÀY TẠO</th>
                    <th className="px-4 py-2.5">TRẠNG THÁI</th>
                    <th className="px-4 py-2.5 text-right">THAO TÁC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {keys.map((k) => (
                    <tr key={k.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-200">{k.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">{k.key}</td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-500">{new Date(k.createdAt).toLocaleDateString("vi-VN")}</td>
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
                        <button
                          onClick={() => confirm(`Xóa key "${k.name}"?`) && deleteMut.mutate(k.id)}
                          className="text-slate-500 hover:text-rose-400 transition-colors cursor-pointer p-1"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Docs Tab ── */}
      {activeTab === "docs" && (
        <div className="space-y-4">
          <div className="bento-card p-4 space-y-3">
            <h2 className="text-xs font-mono font-semibold text-slate-200 flex items-center gap-2">
              <BookOpen size={14} className="text-indigo-400" /> XÁC THỰC HTTP REQUEST
            </h2>
            <p className="text-xs text-slate-400">Thêm API key vào header của mỗi HTTP request gửi tới server:</p>
            <CodeBlock>Authorization: Bearer sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</CodeBlock>
            <p className="text-xs font-mono text-slate-400 mt-2">
              Base URL: <code className="text-indigo-300 font-semibold">{BASE_URL}</code>
            </p>
          </div>

          {[
            {
              method: "GET", path: "/products", title: "Danh sách sản phẩm",
              desc: "Lấy toàn bộ sản phẩm đang bán kèm tồn kho (nếu là STOCK_LINES).",
              response: `{ "products": [{ "id": "...", "name": "KIRO PRO", "price": 30000, "deliveryMode": "STOCK_LINES", "stock": 15 }] }`,
            },
            {
              method: "POST", path: "/stock", title: "Nạp stock (JSON array)",
              desc: "Upload danh sách tài khoản/mã vào sản phẩm.",
              body: `{ "productId": "clx...", "lines": ["user1:pass1", "user2:pass2"] }`,
              response: `{ "ok": true, "added": 2, "totalStock": 17, "product": "KIRO PRO" }`,
            },
            {
              method: "POST", path: "/stock/text", title: "Nạp stock (text thuần)",
              desc: "Upload stock dạng text, mỗi dòng 1 tài khoản.",
              body: `{ "productId": "clx...", "text": "user1:pass1\\nuser2:pass2\\nuser3:pass3" }`,
              response: `{ "ok": true, "added": 3, "totalStock": 20 }`,
            },
            {
              method: "GET", path: "/orders?status=PENDING&limit=20", title: "Danh sách đơn hàng",
              desc: "Lấy đơn hàng. status: PENDING | PAID | DELIVERED | CANCELED",
              response: `{ "orders": [{ "id": "...", "shortId": "ABC12345", "product": "...", "quantity": 1, "amount": 30000, "status": "DELIVERED" }] }`,
            },
            {
              method: "GET", path: "/orders/:id", title: "Chi tiết đơn hàng",
              desc: "Lấy thông tin đầy đủ 1 đơn.",
              response: `{ "order": { "id": "...", "status": "DELIVERED", "deliveryContent": "..." } }`,
            },
            {
              method: "GET", path: "/stats", title: "Thống kê cơ bản",
              desc: "Số đơn, đơn chờ, số sản phẩm.",
              response: `{ "totalOrders": 102, "pendingOrders": 0, "totalProducts": 5 }`,
            },
          ].map(({ method, path, title, desc, body, response }) => (
            <div key={path} className="bento-card p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                  method === "GET"
                    ? "bg-cyan-950/60 text-cyan-300 border-cyan-800/40"
                    : "bg-emerald-950/60 text-emerald-300 border-emerald-800/40"
                }`}>
                  {method}
                </span>
                <code className="text-xs text-slate-200 font-mono font-medium">{BASE_URL}{path}</code>
              </div>
              <p className="text-xs text-slate-400 tracking-tight">{title} — {desc}</p>
              {body && (
                <>
                  <p className="text-[11px] font-mono text-slate-500 uppercase tracking-wider">Request payload:</p>
                  <CodeBlock>{body}</CodeBlock>
                </>
              )}
              <p className="text-[11px] font-mono text-slate-500 uppercase tracking-wider">Response preview:</p>
              <CodeBlock>{response}</CodeBlock>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
