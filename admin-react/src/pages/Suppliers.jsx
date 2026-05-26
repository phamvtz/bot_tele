import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Truck, Pencil, Trash2, RefreshCw } from "lucide-react";
import { api } from "../api/endpoints";
import Modal from "../components/Modal";
import EmptyState from "../components/EmptyState";

const EMPTY_FORM = { name: "", baseUrl: "", apiKey: "", listEndpoint: "", purchaseEndpoint: "", authType: "apikey" };

export default function Suppliers() {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [fetchingId, setFetchingId] = useState(null);
  const [fetchResult, setFetchResult] = useState({});
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ["api-providers"], queryFn: api.apiProviders });
  const providers = data?.providers || data || [];

  const saveMut = useMutation({
    mutationFn: (d) => modal?.provider ? api.updateApiProvider(modal.provider.id, d) : api.createApiProvider(d),
    onSuccess: () => { qc.invalidateQueries(["api-providers"]); setModal(null); },
  });
  const delMut = useMutation({
    mutationFn: (id) => api.deleteApiProvider(id),
    onSuccess: () => qc.invalidateQueries(["api-providers"]),
  });

  function openCreate() { setForm(EMPTY_FORM); setModal({ provider: null }); }
  function openEdit(p) {
    setForm({ name: p.name, baseUrl: p.baseUrl || "", apiKey: p.apiKey || "", listEndpoint: p.listEndpoint || "", purchaseEndpoint: p.purchaseEndpoint || "", authType: p.authType || "apikey" });
    setModal({ provider: p });
  }

  async function testFetch(provider) {
    setFetchingId(provider.id);
    try {
      const res = await api.fetchProviderProducts(provider.id);
      const count = res?.products?.length ?? 0;
      setFetchResult((prev) => ({ ...prev, [provider.id]: { ok: true, count } }));
    } catch {
      setFetchResult((prev) => ({ ...prev, [provider.id]: { ok: false } }));
    } finally {
      setFetchingId(null);
    }
  }

  const f = (k) => form[k] ?? "";

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-gray-900">Nhà cung cấp</h1>
        <button onClick={openCreate} className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 transition-colors">
          <Plus size={15} />
          Thêm nhà cung cấp
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">{providers.length} nhà cung cấp</p>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        {isLoading ? (
          <p className="text-center py-8 text-sm text-gray-400">Đang tải...</p>
        ) : providers.length === 0 ? (
          <EmptyState icon={Truck} message="Chưa có nhà cung cấp nào" action="Thêm nhà cung cấp" onAction={openCreate} />
        ) : (
          <div className="space-y-3">
            {providers.map((p) => {
              const result = fetchResult[p.id];
              return (
                <div key={p.id} className="border border-gray-100 rounded-xl p-4 hover:border-gray-200 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-primary-50 flex items-center justify-center flex-shrink-0">
                        <Truck size={16} className="text-primary-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 text-sm">{p.name}</p>
                        <p className="text-xs text-gray-400 truncate">{p.baseUrl}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => testFetch(p)} disabled={fetchingId === p.id}
                        title="Test kết nối"
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                        <RefreshCw size={12} className={fetchingId === p.id ? "animate-spin" : ""} />
                        Test
                      </button>
                      <button onClick={() => openEdit(p)} className="text-gray-400 hover:text-primary-600 transition-colors">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => { if (confirm(`Xóa "${p.name}"?`)) delMut.mutate(p.id); }}
                        className="text-gray-400 hover:text-red-500 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Status row */}
                  <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
                    {p.listEndpoint && (
                      <span className="flex items-center gap-1">
                        <Package size={11} />
                        List: <code className="text-gray-700">{p.listEndpoint}</code>
                      </span>
                    )}
                    {p.purchaseEndpoint && (
                      <span>Purchase: <code className="text-gray-700">{p.purchaseEndpoint}</code></span>
                    )}
                    <span className="ml-auto">
                      Auth: <span className="font-medium text-gray-700">{p.authType || "apikey"}</span>
                    </span>
                  </div>

                  {result && (
                    <div className={`mt-2 text-xs px-3 py-1.5 rounded-lg ${result.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                      {result.ok ? `✓ Kết nối thành công — ${result.count} sản phẩm` : "✗ Kết nối thất bại"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.provider ? "Sửa nhà cung cấp" : "Thêm nhà cung cấp"}>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Tên nhà cung cấp</label>
            <input value={f("name")} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="VD: CanBoso API"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Base URL</label>
            <input value={f("baseUrl")} onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
              placeholder="https://api.example.com"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">API Key</label>
            <input type="password" value={f("apiKey")} onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
              placeholder="••••••••••••"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Kiểu xác thực</label>
            <select value={f("authType")} onChange={(e) => setForm((prev) => ({ ...prev, authType: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30">
              <option value="apikey">API Key (header x-api-key)</option>
              <option value="bearer">Bearer Token (Authorization: Bearer)</option>
              <option value="basic">Basic Auth</option>
              <option value="none">Không xác thực</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Endpoint lấy danh sách sản phẩm</label>
            <input value={f("listEndpoint")} onChange={(e) => setForm((prev) => ({ ...prev, listEndpoint: e.target.value }))}
              placeholder="/api/products"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Endpoint mua hàng</label>
            <input value={f("purchaseEndpoint")} onChange={(e) => setForm((prev) => ({ ...prev, purchaseEndpoint: e.target.value }))}
              placeholder="/api/purchase"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
          </div>
          <button onClick={() => saveMut.mutate(form)} disabled={!f("name") || saveMut.isPending}
            className="w-full py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors">
            {saveMut.isPending ? "Đang lưu..." : "Lưu"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
