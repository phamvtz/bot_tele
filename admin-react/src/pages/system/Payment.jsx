import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import {
  DollarSign, TrendingUp, Clock, CheckCircle2,
  QrCode, Landmark, Zap, RefreshCw, Pencil, Save,
  ExternalLink, AlertCircle, ShieldCheck, X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/endpoints";
import { formatCurrency } from "../../utils/format";

const BANK_OPTIONS = [
  { code: "MB",  name: "MB Bank" },
  { code: "VCB", name: "Vietcombank" },
  { code: "TCB", name: "Techcombank" },
  { code: "ACB", name: "ACB" },
  { code: "VPB", name: "VPBank" },
  { code: "TPB", name: "TPBank" },
  { code: "BIDV",name: "BIDV" },
  { code: "VTB", name: "VietinBank" },
  { code: "MSB", name: "MSB" },
  { code: "STB", name: "Sacombank" },
];

function StatCard({ icon: Icon, label, value, sub, iconBg, iconColor }) {
  return (
    <div className="glass rounded-xl p-4 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center flex-shrink-0`}>
        <Icon size={18} className={iconColor} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 mb-0.5">{label}</p>
        <p className="text-lg font-bold text-white leading-none">{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function EditModal({ open, onClose, form, onChange, onSave, saving }) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors">
          <X size={16} />
        </button>
        <h2 className="text-base font-bold text-white mb-1">Cấu hình tài khoản ngân hàng</h2>
        <p className="text-xs text-gray-500 mb-5">Thông tin hiển thị cho khách khi tạo QR chuyển khoản</p>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1.5">Ngân hàng</label>
            <select
              value={form.bankCode}
              onChange={(e) => onChange("bankCode", e.target.value)}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm"
            >
              <option value="">-- Chọn ngân hàng --</option>
              {BANK_OPTIONS.map((b) => (
                <option key={b.code} value={b.code}>{b.name} ({b.code})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1.5">Số tài khoản</label>
            <input
              value={form.bankAccount}
              onChange={(e) => onChange("bankAccount", e.target.value)}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono tracking-wider"
              placeholder="0123456789"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1.5">Chủ tài khoản</label>
            <input
              value={form.bankOwner}
              onChange={(e) => onChange("bankOwner", e.target.value)}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm uppercase"
              placeholder="NGUYEN VAN A"
            />
          </div>

          <div className="bg-amber-950/40 border border-amber-800/40 rounded-lg px-3 py-2.5 text-xs text-amber-300 flex gap-2">
            <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
            <span>Thay đổi chỉ ảnh hưởng hiển thị trong bot và web. QR tự động vẫn dùng cấu hình trong file <code className="bg-white/10 px-1 rounded">.env</code>.</span>
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors"
          >
            <Save size={13} />
            {saving ? "Đang lưu..." : "Lưu"}
          </button>
          <button onClick={onClose} className="px-4 py-2 glass rounded-lg text-sm text-gray-400 hover:text-white transition-colors">
            Hủy
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function Payment() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({ bankCode: "", bankAccount: "", bankOwner: "" });

  const { data: statsData } = useQuery({ queryKey: ["stats"], queryFn: api.stats });
  const { data: bankStatusData, refetch: refetchBank, isFetching: bankFetching } = useQuery({
    queryKey: ["bank-status"],
    queryFn: api.bankStatus,
    refetchInterval: 30000,
  });
  const { data: settingsData } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const settings = settingsData?.settings || {};

  useEffect(() => {
    if (settingsData) {
      const bankName = settings.SHOP_BANK_NAME || "";
      const code = BANK_OPTIONS.find((b) => b.name === bankName || bankName.toUpperCase().includes(b.code))?.code || "";
      setForm({
        bankCode: code || settings.BANK_CODE || "",
        bankAccount: settings.SHOP_BANK_ACCOUNT || "",
        bankOwner: settings.SHOP_BANK_ACCOUNT_NAME || "",
      });
    }
  }, [settingsData]);

  const saveMut = useMutation({
    mutationFn: (data) => api.updateSettings(data),
    onSuccess: () => { qc.invalidateQueries(["settings"]); setEditOpen(false); },
  });

  function handleSave() {
    const bankName = BANK_OPTIONS.find((b) => b.code === form.bankCode)?.name || form.bankCode;
    saveMut.mutate({
      SHOP_BANK_NAME: bankName,
      SHOP_BANK_ACCOUNT: form.bankAccount,
      SHOP_BANK_ACCOUNT_NAME: form.bankOwner.toUpperCase(),
      BANK_CODE: form.bankCode,
    });
  }

  const todayRevenue = statsData?.stats?.todayRevenue || 0;
  const todayOrders = statsData?.stats?.todayOrders || 0;
  const bankStatus = bankStatusData || {};
  const polling = bankStatus.enabled;
  const bankAccount = settings.SHOP_BANK_ACCOUNT || bankStatus.accountNo || "—";
  const bankOwner = settings.SHOP_BANK_ACCOUNT_NAME || bankStatus.accountName || "—";
  const bankNameDisplay = settings.SHOP_BANK_NAME || "—";
  const bankConfigured = !!(settings.SHOP_BANK_ACCOUNT || bankStatus.accountNo);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">Cài đặt Thanh toán</h1>
        <button
          onClick={() => refetchBank()}
          disabled={bankFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 glass rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
        >
          <RefreshCw size={13} className={bankFetching ? "animate-spin" : ""} />
          Làm mới
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">Quản lý cổng thanh toán VietQR và theo dõi tự động ngân hàng</p>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={TrendingUp}
          label="Doanh thu hôm nay"
          value={formatCurrency(todayRevenue)}
          iconBg="bg-emerald-950/60" iconColor="text-emerald-400"
        />
        <StatCard
          icon={DollarSign}
          label="Đơn hàng hôm nay"
          value={todayOrders}
          sub="đã thanh toán"
          iconBg="bg-blue-950/60" iconColor="text-blue-400"
        />
        <StatCard
          icon={Clock}
          label="Đơn đang chờ TT"
          value={bankStatus.pendingOrders ?? "—"}
          sub="VietQR"
          iconBg="bg-orange-950/60" iconColor="text-orange-400"
        />
        <StatCard
          icon={CheckCircle2}
          label="Xác nhận hôm nay"
          value={bankStatus.todayProcessed ?? "—"}
          sub="qua ngân hàng"
          iconBg="bg-purple-950/60" iconColor="text-purple-400"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        {/* Bank config card */}
        <div className="glass rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-950/60 flex items-center justify-center">
                <QrCode size={15} className="text-emerald-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">Tài khoản nhận tiền</h2>
                <p className="text-xs text-gray-500">Hiển thị khi tạo QR chuyển khoản</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded border ${bankConfigured
                ? "bg-emerald-950/60 text-emerald-400 border-emerald-800/50"
                : "bg-red-950/60 text-red-400 border-red-800/50"}`}>
                {bankConfigured ? "Đã cấu hình" : "Chưa cấu hình"}
              </span>
              <button
                onClick={() => setEditOpen(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 glass rounded-lg text-xs text-gray-400 hover:text-white transition-colors"
              >
                <Pencil size={11} />
                Sửa
              </button>
            </div>
          </div>

          {bankConfigured ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2.5 border-b border-white/[0.06]">
                <span className="text-xs text-gray-500">Ngân hàng</span>
                <span className="text-sm font-medium text-white">{bankNameDisplay}</span>
              </div>
              <div className="flex items-center justify-between py-2.5 border-b border-white/[0.06]">
                <span className="text-xs text-gray-500">Số tài khoản</span>
                <span className="text-sm font-mono text-white tracking-wider">{bankAccount}</span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-xs text-gray-500">Chủ tài khoản</span>
                <span className="text-sm font-medium text-white uppercase">{bankOwner}</span>
              </div>
            </div>
          ) : (
            <div className="text-center py-6">
              <QrCode size={32} className="text-gray-700 mx-auto mb-2" />
              <p className="text-sm text-gray-500 mb-3">Chưa cấu hình tài khoản ngân hàng</p>
              <button
                onClick={() => setEditOpen(true)}
                className="px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 transition-colors"
              >
                Cấu hình ngay
              </button>
            </div>
          )}
        </div>

        {/* Bank polling card */}
        <div className="glass rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-lg ${polling ? "bg-blue-950/60" : "bg-gray-800/60"} flex items-center justify-center`}>
                <Landmark size={15} className={polling ? "text-blue-400" : "text-gray-500"} />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">Tự động xác nhận</h2>
                <p className="text-xs text-gray-500">MB Bank polling theo thời gian thực</p>
              </div>
            </div>
            <button
              onClick={() => navigate("/system/bank")}
              className="flex items-center gap-1 px-2.5 py-1.5 glass rounded-lg text-xs text-gray-400 hover:text-white transition-colors"
            >
              <ExternalLink size={11} />
              Monitor
            </button>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between py-2.5 border-b border-white/[0.06]">
              <span className="text-xs text-gray-500">Trạng thái polling</span>
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${polling ? "bg-emerald-400 shadow-[0_0_6px_#34d399]" : "bg-gray-600"}`} />
                <span className={`text-sm font-medium ${polling ? "text-emerald-400" : "text-gray-500"}`}>
                  {polling ? "Đang chạy" : "Đã tắt"}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between py-2.5 border-b border-white/[0.06]">
              <span className="text-xs text-gray-500">Tài khoản theo dõi</span>
              <span className="text-sm font-mono text-white">{bankStatus.accountNo || "—"}</span>
            </div>

            <div className="flex items-center justify-between py-2.5 border-b border-white/[0.06]">
              <span className="text-xs text-gray-500">Chủ tài khoản</span>
              <span className="text-sm text-white">{bankStatus.accountName || "—"}</span>
            </div>

            <div className="flex items-center justify-between py-2.5">
              <span className="text-xs text-gray-500">Cấu hình tại</span>
              <span className="text-xs font-mono text-gray-400 bg-white/[0.06] px-2 py-0.5 rounded">.env</span>
            </div>
          </div>

          <div className="mt-4 bg-blue-950/30 border border-blue-800/30 rounded-lg px-3 py-2.5 text-xs text-blue-300 flex gap-2">
            <Zap size={12} className="flex-shrink-0 mt-0.5" />
            <span>Polling tự động match giao dịch theo số tiền và nội dung chuyển khoản, xác nhận đơn hàng trong vài giây.</span>
          </div>
        </div>
      </div>

      {/* Wallet section */}
      <div className="glass rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-purple-950/60 flex items-center justify-center">
            <ShieldCheck size={15} className="text-purple-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Ví nội bộ</h2>
            <p className="text-xs text-gray-500">Thanh toán bằng số dư ví (không cần chuyển khoản)</p>
          </div>
        </div>
        <div className="flex items-center gap-6 flex-wrap">
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Nạp tối thiểu</p>
            <p className="text-sm font-semibold text-white">{formatCurrency(Number(settings.MIN_DEPOSIT) || 10000)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Phương thức nạp</p>
            <p className="text-sm text-white">VietQR + xác nhận tự động</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Thanh toán qua ví</p>
            <span className="text-xs px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/50">Bật</span>
          </div>
          <div className="ml-auto">
            <button
              onClick={() => navigate("/system/settings")}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 glass rounded-lg text-gray-400 hover:text-white transition-colors"
            >
              <Pencil size={11} />
              Chỉnh cài đặt
            </button>
          </div>
        </div>
      </div>

      <EditModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        form={form}
        onChange={(k, v) => setForm((p) => ({ ...p, [k]: v }))}
        onSave={handleSave}
        saving={saveMut.isPending}
      />
    </div>
  );
}
