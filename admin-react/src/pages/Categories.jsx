import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, FolderOpen, Pencil, Trash2, Eye, EyeOff } from "lucide-react";
import { api } from "../api/endpoints";
import EmptyState from "../components/EmptyState";
import Modal from "../components/Modal";

const EMPTY_FORM = { name: "", icon: "📁", iconEmojiId: "", description: "" };

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
  function openEdit(c) {
    setForm({
      name: c.name,
      icon: c.icon || "📁",
      iconEmojiId: c.iconEmojiId || "",
      description: c.description || "",
    });
    setModal({ cat: c });
  }

  return (
    <div className="space-y-4 pb-10">
      {/* Header with eyebrow, tight tracking */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-1">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="eyebrow text-slate-400">CATALOG // CATEGORIES</span>
            <span className="w-1 h-1 rounded-full bg-slate-600" />
            <span className="text-[10px] font-mono text-indigo-400">HIERARCHY</span>
          </div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            Danh mục sản phẩm
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/25">
              {categories.length} NHÓM
            </span>
            {categories.some((c) => !c.isActive) && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                {categories.filter((c) => !c.isActive).length} ĐANG ẨN
              </span>
            )}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 tracking-tight">
            Quản lý nhóm phân loại hiển thị trên menu Bot Telegram và Web Storefront
          </p>
        </div>

        <div>
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-mono font-medium transition-all shadow-sm cursor-pointer"
          >
            <Plus size={13} />
            <span>THÊM DANH MỤC</span>
          </button>
        </div>
      </div>

      {/* Bento Main Card */}
      <div className="bento-card p-4 space-y-3.5">
        {isLoading ? (
          <div className="py-16 text-center text-xs font-mono text-slate-500 animate-pulse">
            ĐANG TẢI DANH MỤC...
          </div>
        ) : categories.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            message="Chưa có danh mục nào"
            action="Thêm danh mục"
            onAction={openCreate}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-800/80">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-900/60 border-b border-slate-800/80 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                  <th className="px-3.5 py-2.5 font-medium w-16">ICON</th>
                  <th className="px-3.5 py-2.5 font-medium">TÊN DANH MỤC</th>
                  <th className="px-3.5 py-2.5 font-medium">MÔ TẢ</th>
                  <th className="px-3.5 py-2.5 font-medium text-center">SẢN PHẨM</th>
                  <th className="px-3.5 py-2.5 font-medium text-right">THAO TÁC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {categories.map((c) => (
                  <tr
                    key={c.id}
                    className={`hover:bg-slate-800/30 transition-colors ${!c.isActive ? "opacity-50" : ""}`}
                  >
                    <td className="px-3.5 py-3 text-lg">
                      <span title={c.iconEmojiId ? `Custom Emoji ID: ${c.iconEmojiId}` : "Emoji thường"}>
                        {c.icon}
                        {c.iconEmojiId ? <sup className="text-[9px] text-indigo-400 font-mono">✨</sup> : null}
                      </span>
                    </td>
                    <td className="px-3.5 py-3 text-slate-200">
                      <div className="font-medium flex items-center gap-2">
                        <span>{c.name}</span>
                        {!c.isActive && (
                          <span className="text-[9px] font-mono font-medium text-slate-400 bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded">
                            ẨN
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3.5 py-3 text-slate-400 text-xs max-w-[240px] truncate">
                      {c.description || "—"}
                    </td>
                    <td className="px-3.5 py-3 font-mono text-center text-slate-300">
                      <span className="px-2 py-0.5 rounded-full bg-slate-900/80 border border-slate-800 text-[11px]">
                        {c._count?.products ?? 0}
                      </span>
                    </td>
                    <td className="px-3.5 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => toggleMut.mutate({ id: c.id, isActive: !c.isActive })}
                          title={c.isActive ? "Ẩn danh mục" : "Hiện danh mục"}
                          className={`p-1.5 rounded border border-transparent hover:border-slate-700 transition-all cursor-pointer ${
                            c.isActive ? "text-slate-400 hover:text-amber-400 hover:bg-slate-800/60" : "text-amber-400 hover:text-emerald-400 hover:bg-slate-800/60"
                          }`}
                        >
                          {c.isActive ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                        <button
                          onClick={() => openEdit(c)}
                          title="Sửa danh mục"
                          className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-800/60 rounded border border-transparent hover:border-slate-700 transition-all cursor-pointer"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Xóa danh mục "${c.name}"?`)) delMut.mutate(c.id);
                          }}
                          title="Xóa danh mục"
                          className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800/60 rounded border border-transparent hover:border-slate-700 transition-all cursor-pointer"
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

      {/* Linear Bento Modal */}
      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.cat ? "Sửa danh mục" : "Thêm danh mục"}>
        <div className="space-y-3.5">
          <div className="flex gap-3">
            <div style={{ flex: "0 0 80px" }}>
              <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1 tracking-wider">
                Icon
              </label>
              <input
                value={form.icon}
                onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
                className="w-full dev-input px-3 py-2 text-sm text-center font-mono"
              />
            </div>
            <div className="flex-1">
              <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1 tracking-wider">
                Tên danh mục
              </label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="VD: Tài khoản Netflix..."
                className="w-full dev-input px-3 py-2 text-xs"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1 tracking-wider">
              Custom Emoji ID (Telegram)
            </label>
            <input
              value={form.iconEmojiId}
              onChange={(e) => setForm((f) => ({ ...f, iconEmojiId: e.target.value.trim() }))}
              inputMode="numeric"
              placeholder="Ví dụ: 5368324170671202286"
              className="w-full dev-input px-3 py-2 text-xs font-mono"
            />
            <p className="text-[10px] font-mono text-slate-500 mt-1">
              Để trống nếu dùng emoji thường. ID chỉ gồm chữ số.
            </p>
          </div>
          <div>
            <label className="text-[10px] font-mono uppercase text-slate-400 block mb-1 tracking-wider">
              Mô tả ngắn
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
              placeholder="Mô tả danh mục..."
              className="w-full dev-input px-3 py-2 text-xs resize-none"
            />
          </div>
          {saveMut.isError && (
            <p className="text-xs font-mono text-rose-400">
              {saveMut.error?.response?.data?.error || saveMut.error?.message}
            </p>
          )}
          <button
            onClick={() => saveMut.mutate(form)}
            disabled={!form.name.trim() || saveMut.isPending}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-mono font-medium disabled:opacity-50 transition-all cursor-pointer shadow-sm"
          >
            {saveMut.isPending ? "ĐANG LƯU..." : "XÁC NHẬN LƯU"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
