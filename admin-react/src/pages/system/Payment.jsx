import { useState } from "react";
import { DollarSign, CheckCircle, RefreshCw, Zap } from "lucide-react";
import Modal from "../../components/Modal";
import StatsCard from "../../components/StatsCard";

const PLUGINS = [
  { id: "payos",  name: "PayOS",  desc: "Thanh toán qua VietQR / QR chuyển khoản ngân hàng" },
  { id: "vnpay",  name: "VNPAY",  desc: "Cổng thanh toán VNPAY – ATM / Visa / MasterCard / QR Pay" },
  { id: "web2m",  name: "Web2M",  desc: "Tự động kiểm tra Lịch sử giao dịch Ngân hàng VN qua Web2M" },
  { id: "sepay",  name: "SEPAY",  desc: "giao dịch tự động hơn 50 Ngân hàng qua Sepay.vn" },
];

export default function Payment() {
  const [tab, setTab] = useState("hub");
  const [hubModal, setHubModal] = useState(false);
  const [manualModal, setManualModal] = useState(false);
  const [hubForm, setHubForm] = useState({ clientId: "", clientSecret: "", webhookSecret: "" });

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-gray-900">Cài Đặt Thanh Toán</h1>
        <div className="flex gap-1 border border-gray-200 rounded-lg p-0.5">
          {[["hub","Payment Hub"],["manual","Thủ công"]].map(([v,l]) => (
            <button key={v} onClick={() => setTab(v)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab===v ? "bg-primary-500 text-white" : "text-gray-600 hover:bg-gray-50"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-5">Kết nối Payment Hub để nhận thanh toán tự động</p>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatsCard icon={DollarSign} label="Tổng doanh thu" value="$0.00" trend={12.4} iconBg="bg-green-100" iconColor="text-green-600" />
        <StatsCard icon={CheckCircle} label="Tỷ lệ thành công" value="99.2%" iconBg="bg-blue-100" iconColor="text-blue-600" />
        <StatsCard icon={RefreshCw} label="Tỷ lệ hoàn tiền" value="0.45%" iconBg="bg-orange-100" iconColor="text-orange-600" />
        <StatsCard icon={Zap} label="Cổng đang chạy" value="1" iconBg="bg-purple-100" iconColor="text-purple-600" />
      </div>

      {/* Gateway cards */}
      <h2 className="text-sm font-semibold text-gray-900 mb-2">Hệ thống Thanh toán</h2>
      <p className="text-xs text-gray-500 mb-4">Tích hợp sẵn gốc với các nhà cung cấp toàn cầu</p>
      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* Payment Hub */}
        <div className="bg-white rounded-xl border-2 border-primary-200 p-5 relative">
          <span className="absolute top-3 right-3 text-xs px-2 py-0.5 rounded bg-primary-100 text-primary-700 font-medium">ĐANG ĐẶT</span>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary-500 flex items-center justify-center">
              <Zap size={18} className="text-white" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">Cổng Payment Hub (Tự động)</p>
              <p className="text-xs text-gray-500">Chấp nhận thanh toán toàn cầu qua thẻ, ví điện tử, và tự động hóa.</p>
            </div>
          </div>
          <button onClick={() => setHubModal(true)} className="w-full py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 transition-colors">
            Cấu hình
          </button>
        </div>

        {/* Manual transfer */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 relative">
          <span className="absolute top-3 right-3 text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">CẦN THIẾT LẬP</span>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
              <DollarSign size={18} className="text-gray-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">Chuyển khoản / Thủ công</p>
              <p className="text-xs text-gray-500">Hỗ trợ giao dịch tự động hoặc duyệt tay cho các giao dịch nội địa.</p>
            </div>
          </div>
          <button onClick={() => setManualModal(true)} className="w-full py-2 border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
            Cấu hình
          </button>
        </div>
      </div>

      {/* Plugin extensions */}
      <h2 className="text-sm font-semibold text-gray-900 mb-2">Plugin Extensions</h2>
      <p className="text-xs text-gray-500 mb-4">Ví điện tử & cổng mở rộng</p>
      <div className="grid grid-cols-4 gap-3">
        {PLUGINS.map((p) => (
          <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center mb-2">
              <Zap size={14} className="text-gray-500" />
            </div>
            <p className="text-sm font-semibold text-gray-900 mb-1">{p.name}</p>
            <p className="text-xs text-gray-400 mb-3 line-clamp-2">{p.desc}</p>
            <button className="w-full py-1.5 bg-primary-500 text-white rounded-lg text-xs font-medium hover:bg-primary-600 transition-colors">
              Kết nối
            </button>
          </div>
        ))}
      </div>

      {/* Payment Hub Modal */}
      <Modal open={hubModal} onClose={() => setHubModal(false)} title="Cấu Hình Payment Hub">
        <div className="bg-gray-50 rounded-xl p-4 mb-4">
          <p className="text-sm font-medium text-gray-800 mb-1">Chưa có tài khoản Payment Hub?</p>
          <p className="text-xs text-gray-500 mb-2">Để sử dụng tính năng tự động gạch nợ và tạo số tài khoản ảo, bạn cần đăng ký tài khoản trên hệ thống Payment Hub.</p>
          <button className="text-xs text-primary-600 font-medium hover:underline">Đi tới Payment Hub ↗</button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-700">API Credentials</p>
            {[["clientId","CLIENT ID *","app_xxxxxxxxxx"],["clientSecret","CLIENT SECRET *","••••••"],["webhookSecret","WEBHOOK SECRET","whsec_xxx (tùy chọn)"]].map(([k,l,p]) => (
              <div key={k}>
                <label className="text-xs font-medium text-gray-600 block mb-1">{l}</label>
                <input type={k==="clientSecret"?"password":"text"} value={hubForm[k]} onChange={(e) => setHubForm((f) => ({...f,[k]:e.target.value}))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30" placeholder={p} />
              </div>
            ))}
          </div>
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-700">Kết nối & tích hợp</p>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Thiết lập Webhook URL</label>
              <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-2 bg-gray-50">
                <span className="text-xs text-gray-600 truncate flex-1">{window.location.origin}/webhook/payment-hub</span>
                <button className="text-gray-400 hover:text-gray-600" onClick={() => navigator.clipboard.writeText(`${window.location.origin}/webhook/payment-hub`)}>
                  📋
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">Dán URL này vào mục Webhook trên trang quản lý Payment Hub.</p>
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 transition-colors">
            💾 Lưu
          </button>
          <button className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition-colors">
            ↻ Test kết nối
          </button>
        </div>
      </Modal>

      {/* Manual Modal */}
      <Modal open={manualModal} onClose={() => setManualModal(false)} title="Cấu Hình Chuyển Khoản Thủ Công">
        <div className="space-y-3">
          {[["bankCode","Mã ngân hàng","MB"],["bankAccount","Số tài khoản","0123456789"],["bankName","Chủ tài khoản","NGUYEN VAN A"]].map(([k,l,p]) => (
            <div key={k}>
              <label className="text-xs font-medium text-gray-700 block mb-1">{l}</label>
              <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30" placeholder={p} />
            </div>
          ))}
          <button className="w-full py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 transition-colors">Lưu</button>
        </div>
      </Modal>
    </div>
  );
}
