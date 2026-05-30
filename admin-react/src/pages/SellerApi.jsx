import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Key, Plus, Trash2, ToggleLeft, ToggleRight, Copy, Check, BookOpen } from "lucide-react";
import { api } from "../api/endpoints";

const BASE_URL = window.location.origin.replace(/\/$/, "") + "/api/seller";

function CodeBlock({ children }) {
  return (
    <pre className="bg-black/40 border border-white/[0.06] rounded-lg px-3 py-2 text-xs font-mono text-emerald-400 overflow-x-auto whitespace-pre-wrap">{children}</pre>
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
    <div>
      <h1 className="text-xl font-bold text-white mb-1">API cho Seller</h1>
      <p className="text-sm text-gray-500 mb-5">Tạo API key để seller/supplier kết nối và nạp hàng từ xa</p>

      {/* Tabs */}
      <div className="flex gap-1 mb-5">
        {[["keys", "API Keys"], ["docs", "Tài liệu"]].map(([k, l]) => (
          <button key={k} onClick={() => setActiveTab(k)}
            className={`text-sm px-4 py-2 rounded-lg transition-colors ${activeTab === k ? "bg-primary-600/20 text-primary-400 border border-primary-700/50" : "text-gray-400 hover:text-white glass border border-white/[0.06]"}`}>
            {l}
          </button>
        ))}
      </div>

      {/* ── Keys Tab ── */}
      {activeTab === "keys" && (
        <div className="space-y-4">
          {/* New key shown once */}
          {newKey && (
            <div className="bg-emerald-950/40 border border-emerald-700/40 rounded-xl p-4">
              <p className="text-xs font-semibold text-emerald-400 mb-2">✅ API Key tạo thành công — lưu lại ngay, sẽ không hiển thị lại!</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-black/40 text-emerald-300 text-xs font-mono px-3 py-2 rounded-lg break-all">{newKey.key}</code>
                <button onClick={() => copyText(newKey.key, "new")}
                  className="flex-shrink-0 p-2 glass rounded-lg text-gray-400 hover:text-white transition-colors">
                  {copiedId === "new" ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                </button>
              </div>
              <button onClick={() => setNewKey(null)} className="text-xs text-gray-500 hover:text-gray-300 mt-2 transition-colors">Ẩn đi</button>
            </div>
          )}

          {/* Create */}
          <div className="glass rounded-xl p-4 flex items-center gap-3">
            <Key size={16} className="text-gray-400 flex-shrink-0" />
            <input value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && newName.trim() && createMut.mutate()}
              placeholder="Tên API key (vd: Supplier A, Nhà cung cấp 1...)"
              className="flex-1 glass-input rounded-lg px-3 py-2 text-sm" />
            <button onClick={() => createMut.mutate()} disabled={!newName.trim() || createMut.isPending}
              className="flex items-center gap-1.5 px-3 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors flex-shrink-0">
              <Plus size={14} /> Tạo key
            </button>
          </div>

          {/* List */}
          <div className="glass rounded-xl overflow-hidden">
            {isLoading ? (
              <p className="text-sm text-gray-400 text-center py-8">Đang tải...</p>
            ) : keys.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-8">Chưa có API key nào</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] text-xs text-gray-500 text-left">
                    <th className="px-4 py-3 font-medium">Tên</th>
                    <th className="px-4 py-3 font-medium">Key (ẩn)</th>
                    <th className="px-4 py-3 font-medium">Ngày tạo</th>
                    <th className="px-4 py-3 font-medium">Trạng thái</th>
                    <th className="px-4 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-200">{k.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{k.key}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{new Date(k.createdAt).toLocaleDateString("vi-VN")}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => toggleMut.mutate(k.id)}
                          className={`flex items-center gap-1 text-xs transition-colors ${k.active !== false ? "text-emerald-400" : "text-gray-500"}`}>
                          {k.active !== false ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                          {k.active !== false ? "Hoạt động" : "Tắt"}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => confirm(`Xóa key "${k.name}"?`) && deleteMut.mutate(k.id)}
                          className="text-gray-600 hover:text-red-400 transition-colors">
                          <Trash2 size={14} />
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
        <div className="space-y-5">
          <div className="glass rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
              <BookOpen size={14} className="text-primary-400" /> Xác thực
            </h2>
            <p className="text-xs text-gray-400 mb-3">Thêm API key vào header mỗi request:</p>
            <CodeBlock>Authorization: Bearer sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</CodeBlock>
            <p className="text-xs text-gray-500 mt-2">Base URL: <code className="text-gray-300">{BASE_URL}</code></p>
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
            <div key={path} className="glass rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${method === "GET" ? "bg-blue-900/60 text-blue-400" : "bg-emerald-900/60 text-emerald-400"}`}>{method}</span>
                <code className="text-sm text-white font-mono">{BASE_URL}{path}</code>
              </div>
              <p className="text-xs text-gray-500">{title} — {desc}</p>
              {body && <><p className="text-xs text-gray-600">Request body:</p><CodeBlock>{body}</CodeBlock></>}
              <p className="text-xs text-gray-600">Response:</p>
              <CodeBlock>{response}</CodeBlock>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
