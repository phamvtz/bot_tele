import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link2, Plus, Pencil, Trash2, RefreshCw, Download, X, ChevronRight, CheckSquare, Square } from "lucide-react";
import { api } from "../api/endpoints";
import Modal from "../components/Modal";
import EmptyState from "../components/EmptyState";
import { ToastContainer, useToast } from "../components/Toast";
import { formatCurrency } from "../utils/format";

const EMPTY_FORM = { name: "", baseUrl: "", apiKey: "", authMode: "bearer", listEndpoint: "/products", purchaseEndpoint: "/orders", customHeaders: "", currency: "VND" };

// Heuristic: pick best field from an object for id/name/price
function pick(obj, candidates) {
  for (const k of candidates) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  return "";
}
function guessId(p)    { return String(pick(p, ["id","ID","productId","service_id","code","slug"]) || ""); }
function guessName(p)  { return String(pick(p, ["name","title","Name","product_name","service_name","label","description"]) || ""); }
function guessPrice(p) { return Number(pick(p, ["price","Price","cost","amount","original_price","sell_price"]) || 0); }
function guessStock(p) { const v = pick(p, ["stock","quantity","available","inStock","in_stock","available_quantity","qty"]); return v !== "" ? v : undefined; }
function guessDesc(p)  { return String(pick(p, ["description","desc","detail","content","note","info","remark","product_description","short_description"]) || ""); }

export default function ApiConnections() {
  const qc = useQueryClient();
  const toast = useToast();
  const [providerModal, setProviderModal] = useState(null); // null | { provider? }
  const [browseProvider, setBrowseProvider] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const f = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  // Browse state
  const [rawProducts, setRawProducts] = useState([]);
  const [fetchError, setFetchError] = useState("");
  const [rawSample, setRawSample] = useState(null);
  const [idField, setIdField] = useState("");
  const [nameField, setNameField] = useState("");
  const [priceField, setPriceField] = useState("");
  const [selected, setSelected] = useState({}); // { origId: true }
  const [userPrices, setUserPrices] = useState({}); // { origId: number } — user's selling price
  const [userNames, setUserNames] = useState({}); // { origId: string } — user's display name
  const [stockField, setStockField] = useState("");
  const [descField, setDescField] = useState("");
  const [catId, setCatId] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [importError, setImportError] = useState("");
  const [bulkPrice, setBulkPrice] = useState("");
  const [testingId, setTestingId] = useState(null);
  const [testResult, setTestResult] = useState({});

  const { data, isLoading } = useQuery({ queryKey: ["api-providers"], queryFn: api.apiProviders });
  const { data: catData } = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const providers = data?.providers || [];
  const categories = catData?.categories || catData || [];

  const saveMut = useMutation({
    mutationFn: (d) => providerModal?.provider ? api.updateApiProvider(providerModal.provider.id, d) : api.createApiProvider(d),
    onSuccess: () => { qc.invalidateQueries(["api-providers"]); setProviderModal(null); },
  });
  const delMut = useMutation({
    mutationFn: (id) => api.deleteApiProvider(id),
    onSuccess: () => qc.invalidateQueries(["api-providers"]),
  });
  const fetchMut = useMutation({
    mutationFn: () => api.fetchProviderProducts(browseProvider.id),
    onSuccess: (data) => {
      setRawProducts(data.products || []);
      setFetchError("");
      setRawSample(data.rawSample || null);
      setSelected({});
      // Auto-detect fields from first item
      if (data.products?.length) {
        const first = data.products[0];
        const keys = Object.keys(first);
        const autoId = keys.find((k) => /id|ID/i.test(k)) || keys[0];
        const autoName = keys.find((k) => /name|title|service/i.test(k)) || keys[1] || "";
        const autoPrice = keys.find((k) => /price|cost|amount/i.test(k)) || "";
        const autoStock = keys.find((k) => /stock|quantity|available|qty/i.test(k)) || "";
        const autoDesc = keys.find((k) => /desc|description|detail|content/i.test(k)) || "";
        setIdField(autoId || ""); setNameField(autoName); setPriceField(autoPrice); setStockField(autoStock); setDescField(autoDesc);
      }
    },
    onError: (e) => setFetchError(e.response?.data?.error || e.message),
  });
  const importMut = useMutation({
    mutationFn: (items) => {
      const toImport = (items || mappedProducts.filter((p) => selected[p.origId]))
        .map((p) => {
          const oid = p.originalId ?? p.origId;
          return {
            originalId: oid,
            name: userNames[oid] ?? p.name ?? p.origName,
            price: userPrices[oid] !== undefined ? userPrices[oid] : (p.price ?? p.origPrice ?? 0),
            description: p.origDesc || "",
            categoryId: catId || null,
          };
        });
      return api.importProviderProducts(browseProvider.id, toImport, { idField, stockField });
    },
    onSuccess: (data) => {
      toast.success(`✓ Đã nhập ${data.created} sản phẩm vào bot!`);
      setImportMsg("");
      setImportError("");
      setSelected({});
      qc.invalidateQueries(["products"]);
    },
    onError: (e) => {
      toast.error(`❌ Nhập thất bại: ${e.response?.data?.error || e.message || "Lỗi không xác định"}`);
      setImportError(e.response?.data?.error || e.message || "Lỗi không xác định khi nhập");
      setImportMsg("");
    },
  });

  function importAll() {
    if (!mappedProducts.length) return;
    if (!confirm(`Nhập tất cả ${mappedProducts.length} sản phẩm vào bot?`)) return;
    const all = mappedProducts.map((item) => ({
      origId: item.origId, origName: userNames[item.origId] ?? item.origName,
      origPrice: userPrices[item.origId] !== undefined ? userPrices[item.origId] : item.origPrice,
      origDesc: item.origDesc,
      originalId: item.origId, name: userNames[item.origId] ?? item.origName,
      price: userPrices[item.origId] !== undefined ? userPrices[item.origId] : item.origPrice,
      description: item.origDesc || "",
    }));
    importMut.mutate(all);
  }

  function openCreate() { setForm(EMPTY_FORM); setProviderModal({ provider: null }); }
  function openEdit(p) { setForm({ name: p.name, baseUrl: p.baseUrl, apiKey: p.apiKey, authMode: p.authMode || "bearer", listEndpoint: p.listEndpoint, purchaseEndpoint: p.purchaseEndpoint, customHeaders: p.customHeaders || "", currency: p.currency || "VND" }); setProviderModal({ provider: p }); }
  function openBrowse(p) { setBrowseProvider(p); setRawProducts([]); setFetchError(""); setRawSample(null); setSelected({}); setUserPrices({}); setUserNames({}); setImportMsg(""); setImportError(""); setIdField(""); setNameField(""); setPriceField(""); setStockField(""); setDescField(""); setBulkPrice(""); }

  async function testProvider(p) {
    setTestingId(p.id);
    try {
      const res = await api.fetchProviderProducts(p.id);
      setTestResult((prev) => ({ ...prev, [p.id]: { ok: true, count: res?.products?.length ?? 0 } }));
    } catch {
      setTestResult((prev) => ({ ...prev, [p.id]: { ok: false } }));
    } finally {
      setTestingId(null);
    }
  }

  // Mapped view of rawProducts
  const mappedProducts = rawProducts.map((raw) => {
    const origId = String(idField ? raw[idField] ?? "" : guessId(raw));
    const origName = String(nameField ? raw[nameField] ?? "" : guessName(raw));
    const origPrice = Number(priceField ? raw[priceField] ?? 0 : guessPrice(raw));
    const origStock = stockField ? raw[stockField] : guessStock(raw);
    const origDesc = String(descField ? raw[descField] ?? "" : guessDesc(raw));
    return { origId, origName, origPrice, origStock, origDesc, raw };
  });

  const allFields = rawProducts.length ? Object.keys(rawProducts[0]) : [];
  const selCount = Object.keys(selected).length;

  function toggleSelect(item) {
    setSelected((prev) => { const next = { ...prev }; if (next[item.origId]) delete next[item.origId]; else next[item.origId] = true; return next; });
  }

  function toggleAll() {
    if (selCount === mappedProducts.length) { setSelected({}); }
    else { const all = {}; mappedProducts.forEach((item) => { all[item.origId] = true; }); setSelected(all); }
  }

  const zeroPriceCount = selCount > 0
    ? mappedProducts.filter((p) => selected[p.origId] && (userPrices[p.origId] !== undefined ? userPrices[p.origId] : p.origPrice) <= 0).length
    : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">Kết nối API</h1>
        <button onClick={openCreate} className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 transition-colors shadow-glow-sm hover:shadow-glow">
          <Plus size={15} />
          Thêm provider
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">Kết nối website/NCC có API để tự nhập và bán sản phẩm với giá tùy chỉnh</p>

      {/* How it works */}
      <div className="bg-blue-950/40 border border-blue-500/20 rounded-xl p-4 mb-5 text-xs text-blue-300">
        <p className="font-semibold mb-1">Cách hoạt động:</p>
        <div className="flex items-start gap-6">
          {[["1. Thêm provider","Nhập URL, API key của website cung cấp"],["2. Duyệt sản phẩm","Kéo danh sách SP từ API, chọn cái muốn bán"],["3. Nhập vào bot","Đặt giá bán của bạn — bot tự giao hàng qua API khi có đơn"]].map(([t,d]) => (
            <div key={t}><p className="font-medium">{t}</p><p className="text-blue-400">{d}</p></div>
          ))}
        </div>
      </div>

      {/* Provider list */}
      {isLoading ? (
        <p className="text-sm text-gray-400">Đang tải...</p>
      ) : providers.length === 0 ? (
        <div className="glass rounded-xl p-8">
          <EmptyState icon={Link2} message="Chưa có provider nào" action="Thêm provider" onAction={openCreate} />
        </div>
      ) : (
        <div className="grid gap-3">
          {providers.map((p) => {
            const tr = testResult[p.id];
            return (
              <div key={p.id} className="glass rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-white text-sm">{p.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{p.baseUrl} · {p.currency}</p>
                    <div className="flex gap-3 mt-1 text-xs text-gray-400">
                      <span>List: <code className="bg-white/[0.08] text-gray-300 px-1 rounded">{p.listEndpoint}</code></span>
                      <span>Purchase: <code className="bg-white/[0.08] text-gray-300 px-1 rounded">{p.purchaseEndpoint}</code></span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => openBrowse(p)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-medium hover:bg-primary-600 transition-colors">
                      <Download size={12} />
                      Duyệt sản phẩm
                    </button>
                    <button onClick={() => testProvider(p)} disabled={testingId === p.id}
                      title="Test kết nối"
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-white/[0.07] rounded-lg text-gray-400 hover:bg-white/[0.05] disabled:opacity-50 transition-colors">
                      <RefreshCw size={12} className={testingId === p.id ? "animate-spin" : ""} />
                      Test
                    </button>
                    <button onClick={() => openEdit(p)} className="text-gray-400 hover:text-primary-600 transition-colors p-1">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => { if (confirm(`Xóa provider "${p.name}"?`)) delMut.mutate(p.id); }}
                      className="text-gray-400 hover:text-red-500 transition-colors p-1">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {tr && (
                  <div className={`mt-2 text-xs px-3 py-1.5 rounded-lg ${tr.ok ? "bg-green-950/60 text-green-400" : "bg-red-950/60 text-red-400"}`}>
                    {tr.ok ? `✓ Kết nối thành công — ${tr.count} sản phẩm` : "✗ Kết nối thất bại — kiểm tra URL và API key"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit Provider Modal */}
      <Modal open={!!providerModal} onClose={() => setProviderModal(null)} title={providerModal?.provider ? "Sửa provider" : "Thêm provider API"}>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Tên provider</label>
            <input value={form.name} onChange={f("name")} placeholder="VD: GameShop API"
              className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Base URL</label>
            <input value={form.baseUrl} onChange={f("baseUrl")} placeholder="https://api.example.com"
              className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">API Key (nếu có)</label>
            <input value={form.apiKey} onChange={f("apiKey")} placeholder="Key / token xác thực"
              className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Cách gửi API Key</label>
            <select value={form.authMode} onChange={f("authMode")}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm">
              <option value="bearer">Authorization: Bearer {"{key}"} (phổ biến nhất)</option>
              <option value="plain">Authorization: {"{key}"} (không có Bearer)</option>
              <option value="x-api-key">X-Api-Key: {"{key}"}</option>
              <option value="query">Query param: ?api_key={"{key}"}</option>
              <option value="none">Không gửi tự động (dùng Custom Headers)</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Endpoint danh sách SP</label>
              <input value={form.listEndpoint} onChange={f("listEndpoint")} placeholder="/products"
                className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Endpoint mua hàng</label>
              <input value={form.purchaseEndpoint} onChange={f("purchaseEndpoint")} placeholder="/orders"
                className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Headers tùy chỉnh (key: value, mỗi dòng)</label>
            <textarea value={form.customHeaders} onChange={f("customHeaders")} rows={2} placeholder={"X-Api-Key: abc123\nX-Partner-ID: xyz"}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono resize-none" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Tiền tệ</label>
            <select value={form.currency} onChange={f("currency")}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm">
              <option value="VND">VND</option><option value="USD">USD</option>
            </select>
          </div>
          <button onClick={() => saveMut.mutate(form)} disabled={!form.name || !form.baseUrl || saveMut.isPending}
            className="w-full py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors shadow-glow-sm hover:shadow-glow">
            {saveMut.isPending ? "Đang lưu..." : "Lưu provider"}
          </button>
        </div>
      </Modal>

      {/* Browse Products Modal */}
      {browseProvider && createPortal(
        <div className="fixed inset-0 bg-black/70 z-[9999] flex items-center justify-center p-4">
          <div className="glass-md rounded-2xl shadow-modal w-full max-w-4xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between flex-shrink-0">
              <div>
                <h2 className="font-semibold text-white">Duyệt sản phẩm — {browseProvider.name}</h2>
                <p className="text-xs text-gray-400 mt-0.5">{browseProvider.baseUrl}{browseProvider.listEndpoint}</p>
              </div>
              <button onClick={() => setBrowseProvider(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>

            {/* Toolbar */}
            <div className="px-5 py-3 border-b border-white/[0.07] flex items-center gap-3 flex-shrink-0">
              <button onClick={() => fetchMut.mutate()} disabled={fetchMut.isPending}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors">
                <RefreshCw size={13} className={fetchMut.isPending ? "animate-spin" : ""} />
                {fetchMut.isPending ? "Đang tải..." : rawProducts.length ? "Tải lại" : "Tải sản phẩm từ API"}
              </button>

              {rawProducts.length > 0 && (
                <button onClick={importAll} disabled={importMut.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 disabled:opacity-50 transition-colors">
                  <Download size={13} />
                  {importMut.isPending ? "Đang nhập..." : `Nhập tất cả (${mappedProducts.length})`}
                </button>
              )}

              {rawProducts.length > 0 && (
                <>
                  <span className="text-xs text-gray-400">{rawProducts.length} sản phẩm từ API</span>
                  <div className="flex items-center gap-2 ml-auto">
                    <label className="text-xs text-gray-500">Danh mục khi nhập:</label>
                    <select value={catId} onChange={(e) => setCatId(e.target.value)}
                      className="glass-input rounded-lg px-2 py-1 text-xs">
                      <option value="">— Không có —</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                    </select>
                  </div>
                </>
              )}
            </div>

            {/* Field mapping */}
            {rawProducts.length > 0 && (
              <div className="px-5 py-2 border-b border-white/[0.07] bg-white/[0.02] flex items-center gap-4 flex-shrink-0">
                <span className="text-xs font-medium text-gray-400">Ánh xạ trường:</span>
                {[["ID sản phẩm", idField, setIdField], ["Tên", nameField, setNameField], ["Giá gốc", priceField, setPriceField], ["Tồn kho", stockField, setStockField], ["Mô tả", descField, setDescField]].map(([label, val, setter]) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500">{label}:</span>
                    <select value={val} onChange={(e) => setter(e.target.value)}
                      className="glass-input rounded px-2 py-0.5 text-xs">
                      <option value="">— tự động —</option>
                      {allFields.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}

            {fetchError && (
              <div className="mx-5 mt-3 bg-red-950/60 border border-red-800/50 rounded-lg px-4 py-2 text-xs text-red-400 flex-shrink-0">{fetchError}</div>
            )}

            {/* Product table */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {rawProducts.length === 0 ? (
                <div>
                  {rawSample && (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-yellow-400 mb-1">API trả về dữ liệu nhưng không tìm thấy mảng sản phẩm. Response gốc:</p>
                      <pre className="bg-gray-900 text-green-400 rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap break-all max-h-48 font-mono">
                        {JSON.stringify(rawSample, null, 2)}
                      </pre>
                      <p className="text-xs text-yellow-300 mt-1">Hãy kiểm tra key chứa mảng sản phẩm và nhập vào endpoint danh sách SP (ví dụ: nếu mảng nằm trong <code>response.list</code> thì thêm <code>/products?format=list</code> hoặc liên hệ API provider).</p>
                    </div>
                  )}
                  {!rawSample && !fetchError && (
                    <div className="text-center py-12 text-gray-400 text-sm">Nhấn "Tải sản phẩm từ API" để bắt đầu</div>
                  )}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[#0c0a15]">
                    <tr className="border-b border-white/[0.06] text-left text-xs text-gray-500">
                      <th className="px-2 py-2 rounded-l-lg w-8">
                        <button onClick={toggleAll} className="text-gray-400 hover:text-primary-600 transition-colors">
                          {selCount === mappedProducts.length ? <CheckSquare size={14} className="text-primary-500" /> : <Square size={14} />}
                        </button>
                      </th>
                      <th className="px-2 py-2 font-medium">ID gốc</th>
                      <th className="px-2 py-2 font-medium min-w-[180px]">Tên hiển thị trên bot</th>
                      <th className="px-2 py-2 font-medium">Giá gốc</th>
                      <th className="px-2 py-2 font-medium">Tồn kho</th>
                      <th className="px-2 py-2 font-medium rounded-r-lg">Giá bán của bạn</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappedProducts.map((item) => {
                      const isSel = !!selected[item.origId];
                      return (
                        <tr key={item.origId} className={`border-b border-white/[0.04] ${isSel ? "bg-white/[0.08]" : "hover:bg-white/[0.03]"} transition-colors`}>
                          <td className="px-2 py-2">
                            <button onClick={() => toggleSelect(item)} className="text-gray-400 hover:text-primary-600 transition-colors">
                              {isSel ? <CheckSquare size={14} className="text-primary-500" /> : <Square size={14} />}
                            </button>
                          </td>
                          <td className="px-2 py-2 text-xs text-gray-400 font-mono max-w-[100px] truncate">{item.origId}</td>
                          <td className="px-2 py-2">
                            <input value={userNames[item.origId] ?? item.origName}
                              onChange={(e) => setUserNames((p) => ({ ...p, [item.origId]: e.target.value }))}
                              className="w-full glass-input rounded px-2 py-1 text-xs" />
                          </td>
                          <td className="px-2 py-2 text-xs text-gray-400">{item.origPrice > 0 ? formatCurrency(item.origPrice) : "—"}</td>
                          <td className="px-2 py-2 text-xs text-gray-500">
                            {item.origStock !== undefined && item.origStock !== null
                              ? (Number(item.origStock) <= 0 ? <span className="text-red-400">Hết hàng</span> : String(item.origStock))
                              : <span className="text-emerald-400">Còn hàng</span>}
                          </td>
                          <td className="px-2 py-2">
                            <input type="number" min="0"
                              value={userPrices[item.origId] !== undefined ? userPrices[item.origId] : (item.origPrice > 0 ? item.origPrice : "")}
                              onChange={(e) => setUserPrices((p) => ({ ...p, [item.origId]: Number(e.target.value) }))}
                              placeholder="Nhập giá"
                              className={`w-28 glass-input rounded px-2 py-1 text-xs ${(userPrices[item.origId] !== undefined ? userPrices[item.origId] : item.origPrice) > 0 ? "" : "border-orange-400/50 bg-orange-950/20 placeholder-orange-400"}`} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            {rawProducts.length > 0 && (
              <div className="px-5 py-3 border-t border-white/[0.07] flex-shrink-0">
                {importError && (
                  <div className="mb-2 bg-red-950/60 border border-red-800/50 rounded-lg px-3 py-2 text-xs text-red-400">❌ {importError}</div>
                )}
                {/* Bulk price */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-gray-500 flex-shrink-0">Đặt giá chung:</span>
                  <input type="number" min="0" value={bulkPrice} onChange={(e) => setBulkPrice(e.target.value)}
                    placeholder="VD: 50000"
                    className="w-32 glass-input rounded px-2 py-1 text-xs" />
                  <button onClick={() => {
                    const v = Number(bulkPrice);
                    if (!v) return;
                    const next = {};
                    mappedProducts.forEach((p) => { next[p.origId] = v; });
                    setUserPrices(next);
                  }} className="px-3 py-1 bg-white/[0.08] hover:bg-white/[0.12] text-gray-300 rounded text-xs font-medium transition-colors">
                    Áp cho tất cả
                  </button>
                  <span className="text-xs text-gray-400">— hoặc nhập từng giá ở cột bên phải</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">Đã chọn <b>{selCount}</b> / {mappedProducts.length} sản phẩm</span>
                    {selCount === 0 && (
                      <button onClick={toggleAll} className="text-xs text-primary-600 hover:underline">Chọn tất cả</button>
                    )}
                    {selCount > 0 && selCount < mappedProducts.length && (
                      <button onClick={toggleAll} className="text-xs text-gray-400 hover:underline">Chọn tất cả</button>
                    )}
                    {selCount === mappedProducts.length && (
                      <button onClick={toggleAll} className="text-xs text-gray-400 hover:underline">Bỏ chọn tất cả</button>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap justify-end">
                    {zeroPriceCount > 0 && (
                      <span className="text-xs text-orange-400 bg-orange-950/40 border border-orange-800/50 rounded-lg px-2 py-1">
                        ⚠ {zeroPriceCount} SP chưa có giá — sẽ hiện 0đ trên bot
                      </span>
                    )}
                    {importMsg && <span className="text-xs text-emerald-400">{importMsg}</span>}
                    <button onClick={() => importMut.mutate(null)} disabled={selCount === 0 || importMut.isPending}
                      className="flex items-center gap-1.5 px-5 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors">
                      <Download size={14} />
                      {importMut.isPending ? "Đang nhập..." : selCount === 0 ? "Chọn sản phẩm để nhập" : `Nhập ${selCount} sản phẩm vào bot`}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      <ToastContainer toasts={toast.toasts} onRemove={toast.removeToast} />
    </div>
  );
}
