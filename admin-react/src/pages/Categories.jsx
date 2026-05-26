import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, FolderOpen, Pencil, Trash2, Eye, EyeOff } from "lucide-react";
import { api } from "../api/endpoints";
import EmptyState from "../components/EmptyState";
import Modal from "../components/Modal";

const EMPTY_FORM = { name: "", icon: "📁", description: "" };

export default function Categories() {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const categories = data?.categories || data || [];

  const saveMut = useMutation({
    mutationFn: (d) => modal?.cat ? api.updateCategory(modal.cat.id, d) : api.createCategory(d),
    onSuccess: () => { qc.invalidateQueries(["categories"]); setModal(null); },
  });
  const delMut = useMutation({
    mutationFn: (id) => api.deleteCategory(id),
    onSuccess: () => qc.invalidateQueries(["categories"]),
  });
  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }) => api.updateCategory(id, { isActive }),
    onSuccess: () => qc.invalidateQueries(["categories"]),
  });

  function openCreate() { setForm(EMPTY_FORM); setModal({ cat: null }); }
  function openEdit(c) { setForm({ name: c.name, icon: c.icon || "📁", description: c.description || "" }); setModal({ cat: c }); }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">Danh mục</h1>
        <button onClick={openCreate} className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 transition-colors shadow-glow-sm hover:shadow-glow">
          <Plus size={15} />
          Thêm danh mục
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        {categories.length} danh mục · <span className="text-gray-400">{categories.filter(c => !c.isActive).length} ẩn</span>
      </p>

      <div className="glass rounded-xl p-4">
        {isLoading ? (
          <p className="text-center py-8 text-sm text-gray-400">Đang tải...</p>
        ) : categories.length === 0 ? (
          <EmptyState icon={FolderOpen} message="Chưa có danh mục nào" action="Thêm danh mục" onAction={openCreate} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-left text-xs text-gray-500">
                  <th className="px-3 py-2.5 font-medium rounded-l-lg">Icon</th>
                  <th className="px-3 py-2.5 font-medium">Tên danh mục</th>
                  <th className="px-3 py-2.5 font-medium">Mô tả</th>
                  <th className="px-3 py-2.5 font-medium">Sản phẩm</th>
                  <th className="px-3 py-2.5 font-medium rounded-r-lg">Hành động</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id} className={`border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors ${!c.isActive ? "opacity-50" : ""}`}>
                    <td className="px-3 py-3 text-xl">{c.icon}</td>
                    <td className="px-3 py-3 font-medium text-white">
                      <span>{c.name}</span>
                      {!c.isActive && <span className="ml-2 text-[10px] font-medium text-gray-500 bg-white/[0.08] px-1.5 py-0.5 rounded">Ẩn</span>}
                    </td>
                    <td className="px-3 py-3 text-gray-500 text-xs max-w-[200px] truncate">{c.description || "—"}</td>
                    <td className="px-3 py-3 text-gray-600">{c._count?.products ?? 0}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleMut.mutate({ id: c.id, isActive: !c.isActive })}
                          title={c.isActive ? "Ẩn danh mục" : "Hiện danh mục"}
                          className={`transition-colors ${c.isActive ? "text-gray-400 hover:text-amber-500" : "text-amber-400 hover:text-emerald-500"}`}>
                          {c.isActive ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                        <button onClick={() => openEdit(c)} className="text-gray-400 hover:text-primary-600 transition-colors">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => { if (confirm(`Xóa danh mục "${c.name}"?`)) delMut.mutate(c.id); }}
                          className="text-gray-400 hover:text-red-500 transition-colors">
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

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.cat ? "Sửa danh mục" : "Thêm danh mục"}>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div style={{ flex: "0 0 80px" }}>
              <label className="text-xs font-medium text-gray-400 block mb-1">Icon (emoji)</label>
              <input value={form.icon} onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
                className="w-full glass-input rounded-lg px-3 py-2 text-sm text-center" />
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-400 block mb-1">Tên danh mục</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="VD: Tài khoản game..."
                className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Mô tả (tùy chọn)</label>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm resize-none" />
          </div>
          <button onClick={() => saveMut.mutate(form)} disabled={!form.name.trim() || saveMut.isPending}
            className="w-full py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors shadow-glow-sm hover:shadow-glow">
            {saveMut.isPending ? "Đang lưu..." : "Lưu"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
