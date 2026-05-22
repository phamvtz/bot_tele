import { useState } from "react";
import { Link2, Plus, Upload, ChevronRight } from "lucide-react";

const STEPS = ["ĐANG CHỌN", "KẾT NỐI REST/JSON tùy chỉnh", "CÁC BƯỚC"];

export default function ApiConnections() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ name: "", currency: "VND", proxy: "" });

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-1">Kết nối API</h1>
      <p className="text-sm text-gray-500 mb-5">Kết nối nhà cung cấp sản phẩm qua REST/JSON</p>

      {/* Wizard header */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
        <div className="flex items-center gap-2 mb-6">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${i === step ? "bg-primary-50 border-primary-200 text-primary-700" : "border-gray-200 text-gray-500"}`}>
                {s}{i === 2 && `: ${0}`}
              </div>
              {i < STEPS.length - 1 && <ChevronRight size={14} className="text-gray-300" />}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Form */}
          <div className="col-span-2 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">Kết nối REST/JSON provider</h2>
            <p className="text-xs text-gray-500">Tạo provider trước để có bộ nghiệp vụ chuẩn. Sau đó bạn có thể thay URL, đổi method, thêm/xóa step theo nghiệp vụ theo API của NCC.</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">Tên provider</label>
                <input value={form.name} onChange={(e) => setForm((f) => ({...f,name:e.target.value}))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30" placeholder="Tên provider" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">Chọn tiền tệ</label>
                <select value={form.currency} onChange={(e) => setForm((f) => ({...f,currency:e.target.value}))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30">
                  <option value="VND">VND</option>
                  <option value="USD">USD</option>
                </select>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-gray-700">Proxy</label>
                <button className="text-xs text-primary-600 hover:underline">Hiện key</button>
              </div>
              <input value={form.proxy} onChange={(e) => setForm((f) => ({...f,proxy:e.target.value}))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                placeholder="host:port / user:pass:ip:port / socks5://user:pass@host:port" />
            </div>
            <p className="text-xs text-gray-400">Bỏ trống nếu server không bị chặn bởi NCC IP. <span className="text-primary-600 cursor-pointer hover:underline">Proxy này chỉ dùng cho các request từ provider này.</span></p>

            {/* Steps template */}
            <div className="border border-gray-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-700 mb-3">Mẫu nghiệp vụ sẽ được tạo tự động</p>
              <p className="text-xs text-gray-400 mb-3">Đây chỉ là khung gợi ý. Cái nào NCC không hỗ trợ thì để mặc định hoặc bỏ qua; cái nào khác tên thì tùy chỉnh trong API endpoints rồi gán lại ở Bước 3.</p>
              <div className="grid grid-cols-2 gap-2">
                {[["Bước 1","Danh sách sản phẩm","Nguồn để đồng bộ bộ sản phẩm JSON"],
                  ["Bước 2","Mua sản phẩm","Gọi API mua hàng khi khách đặt"],
                  ["Bước 3","Chi tiết sản phẩm","Lấy thông tin một sản phẩm nếu NCC có"],
                  ["Bước 4","Thông tin tài khoản","Số dư, tổng nạp, tổng chi của NCC"],
                ].map(([step, title, desc]) => (
                  <div key={step} className="border border-gray-100 rounded-lg p-3">
                    <p className="text-xs font-semibold text-primary-600 mb-0.5">{step}</p>
                    <p className="text-xs font-medium text-gray-800">{title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setStep(1)}
                disabled={!form.name}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors"
              >
                <Plus size={14} />
                Tạo provider REST/JSON
              </button>
              <button className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition-colors">
                <Upload size={14} />
                Import JSON
              </button>
            </div>
          </div>

          {/* Right panel */}
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-700 mb-3">Combo nghiệp vụ chuẩn</p>
            <div className="font-mono text-xs text-gray-600 space-y-1.5 leading-relaxed">
              <p className="text-gray-400">Provider API JSON</p>
              <p>├ BẮT BUỘC <span className="text-primary-600">list_products</span></p>
              <p className="ml-4 text-gray-400">= GET .../products</p>
              <p>├ BẮT BUỘC <span className="text-primary-600">purchase</span></p>
              <p className="ml-4 text-gray-400">= POST .../orders</p>
              <p>├ TÙY CHỌN <span className="text-primary-600">product_detail</span></p>
              <p className="ml-4 text-gray-400">= GET .../products/:id</p>
              <p>└ TÙY CHỌN <span className="text-primary-600">account_info</span></p>
              <p className="ml-4 text-gray-400">= GET .../account/info</p>
            </div>
          </div>
        </div>
      </div>

      {/* Provider list - empty state */}
      <div className="bg-white rounded-xl border border-gray-200 p-8">
        <div className="text-center text-gray-400">
          <Link2 size={32} strokeWidth={1.5} className="mx-auto mb-2" />
          <p className="text-sm">Chưa có provider nào</p>
          <p className="text-xs mt-1">Tạo hoặc import provider để bắt đầu đồng bộ sản phẩm.</p>
        </div>
      </div>
    </div>
  );
}
