import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import {
  DollarSign, TrendingUp, Clock, CheckCircle2,
  QrCode, Landmark, Zap, RefreshCw, Pencil, Save,
  ExternalLink, AlertCircle, ShieldCheck, X, Bot, TrendingUp as TrendUp,
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
    <div className="bento-card p-4 flex items-center gap-3.5">
      <div className={`w-9 h-9 rounded-lg ${iconBg} border border-slate-700/60 flex items-center justify-center flex-shrink-0`}>
        <Icon size={16} className={iconColor} />
      </div>
      <div className="min-w-0">
        <p className="eyebrow text-slate-400 mb-0.5">{label}</p>
        <p className="text-base font-bold text-slate-100 font-mono tracking-tight">{value}</p>
        {sub && <p className="text-[10px] font-mono text-slate-500 mt-0.5">{sub}</p>}
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
    <div className="space-y-4 pb-10">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="eyebrow text-slate-400">FINANCE // GATEWAY & REVENUE</span>
            <span className="w-1 h-1 rounded-full bg-slate-600" />
            <span className="text-[10px] font-mono text-emerald-400">VIETQR & MBBANK</span>
          </div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            Cài đặt Thanh toán
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 tracking-tight">
            Quản lý tài khoản ngân hàng nhận tiền VietQR và cơ chế đối soát giao dịch tự động
          </p>
        </div>
        <button
          onClick={() => refetchBank()}
          disabled={bankFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-md text-xs font-mono text-slate-300 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw size={12} className={bankFetching ? "animate-spin text-indigo-400" : "text-slate-400"} />
          LÀM MỚI
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard
          icon={TrendingUp}
          label="DOANH THU HÔM NAY"
          value={formatCurrency(todayRevenue)}
          iconBg="bg-emerald-950/60" iconColor="text-emerald-400"
        />
        <StatCard
          icon={DollarSign}
          label="ĐƠN HÀNG HÔM NAY"
          value={todayOrders}
          sub="ĐÃ HOÀN TẤT"
          iconBg="bg-indigo-950/60" iconColor="text-indigo-400"
        />
        <StatCard
          icon={Clock}
          label="ĐƠN CHỜ THANH TOÁN"
          value={bankStatus.pendingOrders ?? "—"}
          sub="VIETQR PENDING"
          iconBg="bg-amber-950/60" iconColor="text-amber-400"
        />
        <StatCard
          icon={CheckCircle2}
          label="TỰ ĐỘNG KHỚP HÔM NAY"
          value={bankStatus.todayProcessed ?? "—"}
          sub="MB BANK POLLER"
          iconBg="bg-cyan-950/60" iconColor="text-cyan-400"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Bank config card */}
        <div className="bento-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-md bg-emerald-950/60 border border-emerald-800/50 flex items-center justify-center">
                <QrCode size={15} className="text-emerald-400" />
              </div>
              <div>
                <h2 className="text-xs font-mono font-semibold text-slate-200 uppercase tracking-wide">TÀI KHOẢN NHẬN TIỀN</h2>
                <p className="text-[11px] text-slate-400 tracking-tight">Tạo mã VietQR tự động cho từng đơn hàng</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border ${
                bankConfigured
                  ? "bg-emerald-950/60 text-emerald-400 border-emerald-800/50"
                  : "bg-rose-950/60 text-rose-400 border-rose-800/50"
              }`}>
                {bankConfigured ? "ĐÃ CẤU HÌNH" : "CHƯA CẤU HÌNH"}
              </span>
              <button
                onClick={() => setEditOpen(true)}
                className="flex items-center gap-1 px-2.5 py-1 bg-slate-900 border border-slate-800 rounded-md text-xs font-mono text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Pencil size={11} />
                SỬA
              </button>
            </div>
          </div>

          {bankConfigured ? (
            <div className="space-y-2.5 text-xs font-mono">
              <div className="flex items-center justify-between py-2 border-b border-slate-800/60">
                <span className="text-slate-400">NGÂN HÀNG</span>
                <span className="font-semibold text-slate-100">{bankNameDisplay}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-800/60">
                <span className="text-slate-400">SỐ TÀI KHOẢN</span>
                <span className="font-mono text-indigo-300 tracking-wider font-bold">{bankAccount}</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-slate-400">CHỦ TÀI KHOẢN</span>
                <span className="font-medium text-slate-100 uppercase">{bankOwner}</span>
              </div>
            </div>
          ) : (
            <div className="text-center py-6 space-y-2">
              <QrCode size={28} className="text-slate-600 mx-auto" />
              <p className="text-xs font-mono text-slate-500">Chưa cấu hình thông tin tài khoản ngân hàng</p>
              <button
                onClick={() => setEditOpen(true)}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-xs font-mono font-medium transition-colors cursor-pointer"
              >
                CẤU HÌNH NGAY
              </button>
            </div>
          )}
        </div>

        {/* Bank polling card */}
        <div className="bento-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-md ${polling ? "bg-cyan-950/60 border border-cyan-800/50" : "bg-slate-900 border border-slate-800"} flex items-center justify-center`}>
                <Landmark size={15} className={polling ? "text-cyan-400" : "text-slate-500"} />
              </div>
              <div>
                <h2 className="text-xs font-mono font-semibold text-slate-200 uppercase tracking-wide">ĐỐI SOÁT TỰ ĐỘNG</h2>
                <p className="text-[11px] text-slate-400 tracking-tight">MB Bank Poller kiểm tra mỗi 15 giây</p>
              </div>
            </div>
            <button
              onClick={() => navigate("/system/bank")}
              className="flex items-center gap-1 px-2.5 py-1 bg-slate-900 border border-slate-800 rounded-md text-xs font-mono text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <ExternalLink size={11} />
              MONITOR
            </button>
          </div>

          <div className="space-y-2.5 text-xs font-mono">
            <div className="flex items-center justify-between py-2 border-b border-slate-800/60">
              <span className="text-slate-400">TRẠNG THÁI POLLING</span>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${polling ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
                <span className={`text-xs font-bold ${polling ? "text-emerald-400" : "text-slate-500"}`}>
                  {polling ? "ĐANG HOẠT ĐỘNG" : "ĐÃ TẮT"}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between py-2 border-b border-slate-800/60">
              <span className="text-slate-400">TÀI KHOẢN THEO DÕI</span>
              <span className="font-mono text-slate-200">{bankStatus.accountNo || "—"}</span>
            </div>

            <div className="flex items-center justify-between py-2 border-b border-slate-800/60">
              <span className="text-slate-400">CHỦ TÀI KHOẢN MB</span>
              <span className="text-slate-200">{bankStatus.accountName || "—"}</span>
            </div>

            <div className="flex items-center justify-between py-2">
              <span className="text-slate-400">NGUỒN CẤU HÌNH</span>
              <span className="text-[10px] font-mono text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">ENV / SETTINGS</span>
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/60 rounded-md p-3 text-xs font-mono text-indigo-300 flex gap-2">
            <Zap size={13} className="flex-shrink-0 mt-0.5 text-indigo-400" />
            <span className="leading-relaxed">MB Bank Poller tự động match giao dịch theo số tiền và cú pháp chuyển khoản, tự động giao hàng sau vài giây.</span>
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
