import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, Eye, EyeOff, Send, KeyRound, MessageSquare } from "lucide-react";

export default function Login() {
  const [tab, setTab] = useState("otp");
  const navigate = useNavigate();

  // OTP flow state
  const [telegramId, setTelegramId] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState(1); // 1 = enter ID, 2 = enter OTP
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState("");
  const [countdown, setCountdown] = useState(0);

  // Token flow state
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState("");

  async function requestOtp(e) {
    e.preventDefault();
    if (!telegramId.trim()) return;
    setOtpLoading(true);
    setOtpError("");
    try {
      const res = await fetch("/admin/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramId: telegramId.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setStep(2);
        setCountdown(60);
        const interval = setInterval(() => {
          setCountdown((c) => { if (c <= 1) { clearInterval(interval); return 0; } return c - 1; });
        }, 1000);
      } else {
        setOtpError(data.error || "Lỗi không xác định");
      }
    } catch {
      setOtpError("Không kết nối được server.");
    }
    setOtpLoading(false);
  }

  async function verifyOtp(e) {
    e.preventDefault();
    if (!otp.trim()) return;
    setOtpLoading(true);
    setOtpError("");
    try {
      const res = await fetch("/admin/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramId: telegramId.trim(), otp: otp.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.secret) {
        const check = await fetch("/api/admin-react/stats", {
          headers: { "x-admin-token": data.secret },
        });
        if (check.ok) {
          localStorage.setItem("admin_token", data.secret);
          navigate("/", { replace: true });
        } else {
          setOtpError("Xác thực thành công nhưng không truy cập được API. Kiểm tra cấu hình server.");
        }
      } else {
        setOtpError(data.error || "Mã OTP không đúng");
      }
    } catch {
      setOtpError("Không kết nối được server.");
    }
    setOtpLoading(false);
  }

  async function handleTokenLogin(e) {
    e.preventDefault();
    if (!token.trim()) return;
    setTokenLoading(true);
    setTokenError("");
    try {
      const res = await fetch("/api/admin-react/stats", {
        headers: { "x-admin-token": token.trim() },
      });
      if (res.ok) {
        localStorage.setItem("admin_token", token.trim());
        navigate("/", { replace: true });
      } else {
        setTokenError("Token không đúng. Kiểm tra lại ADMIN_SECRET trong file .env trên VPS.");
      }
    } catch {
      setTokenError("Không kết nối được server.");
    }
    setTokenLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="bento-card w-full max-w-sm p-7 border-slate-800/90 shadow-2xl">
        {/* Logo & Eyebrow */}
        <div className="flex flex-col items-center mb-6 text-center">
          <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center mb-3 text-indigo-400">
            <Lock size={18} />
          </div>
          <span className="eyebrow text-slate-400 mb-1">SYSTEM // CONTROL PANEL</span>
          <h1 className="text-lg font-bold text-slate-100 tracking-tight">Admin Console</h1>
          <p className="text-xs text-slate-400 mt-1">Đăng nhập để điều hành bot & storefront</p>
        </div>

        {/* Linear Segmented Tabs */}
        <div className="flex gap-1 bg-slate-900/80 border border-slate-800/80 rounded-lg p-1 mb-5">
          <button
            onClick={() => { setTab("otp"); setOtpError(""); setStep(1); setOtp(""); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-mono transition-all ${tab === "otp" ? "bg-slate-800 text-slate-100 border border-slate-700/80 shadow-sm" : "text-slate-400 hover:text-slate-200"}`}
          >
            <MessageSquare size={12} />
            OTP TELEGRAM
          </button>
          <button
            onClick={() => { setTab("token"); setTokenError(""); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-mono transition-all ${tab === "token" ? "bg-slate-800 text-slate-100 border border-slate-700/80 shadow-sm" : "text-slate-400 hover:text-slate-200"}`}
          >
            <KeyRound size={12} />
            SECRET TOKEN
          </button>
        </div>

        {/* OTP Tab */}
        {tab === "otp" && (
          <div>
            {step === 1 ? (
              <form onSubmit={requestOtp} className="space-y-4">
                <div>
                  <label className="text-[11px] font-mono uppercase text-slate-400 block mb-1.5 tracking-wider">
                    Telegram ID người nhận
                  </label>
                  <input
                    type="text"
                    value={telegramId}
                    onChange={(e) => setTelegramId(e.target.value)}
                    placeholder="VD: 123456789"
                    autoFocus
                    className="w-full dev-input rounded-lg px-3.5 py-2.5 text-xs font-mono"
                  />
                  <p className="text-[11px] text-slate-500 mt-1 font-mono">
                    Lấy ID qua bot <code className="bg-slate-900 border border-slate-800 px-1 py-0.5 rounded text-indigo-300">@userinfobot</code>
                  </p>
                </div>

                {otpError && (
                  <div className="bg-rose-950/40 border border-rose-800/50 rounded-lg px-3 py-2 text-xs text-rose-300 font-mono">
                    {otpError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!telegramId.trim() || otpLoading}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-mono font-semibold disabled:opacity-50 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                >
                  <Send size={13} />
                  {otpLoading ? "ĐANG GỬI..." : "GỬI MÃ OTP QUA BOT"}
                </button>
              </form>
            ) : (
              <form onSubmit={verifyOtp} className="space-y-4">
                <div className="bg-emerald-950/40 border border-emerald-800/50 rounded-lg px-3 py-2.5 text-xs text-emerald-300 font-mono">
                  ✓ Đã gửi mã OTP đến ID <strong>{telegramId}</strong>
                </div>

                <div>
                  <label className="text-[11px] font-mono uppercase text-slate-400 block mb-1.5 tracking-wider">
                    Mã xác thực (6 số)
                  </label>
                  <input
                    type="text"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="000000"
                    autoFocus
                    maxLength={6}
                    className="w-full dev-input rounded-lg px-4 py-2.5 text-sm text-center tracking-[0.4em] font-mono font-bold"
                  />
                </div>

                {otpError && (
                  <div className="bg-rose-950/40 border border-rose-800/50 rounded-lg px-3 py-2 text-xs text-rose-300 font-mono">
                    {otpError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={otp.length !== 6 || otpLoading}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-mono font-semibold disabled:opacity-50 transition-all cursor-pointer shadow-sm"
                >
                  {otpLoading ? "ĐANG XÁC THỰC..." : "XÁC NHẬN VÀ TRUY CẬP"}
                </button>

                <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                  <button
                    type="button"
                    onClick={() => { setStep(1); setOtp(""); setOtpError(""); }}
                    className="hover:text-slate-200 transition-colors"
                  >
                    ← Đổi ID
                  </button>
                  {countdown > 0 ? (
                    <span className="text-slate-500">Gửi lại sau {countdown}s</span>
                  ) : (
                    <button
                      type="button"
                      onClick={requestOtp}
                      className="text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      Gửi lại mã
                    </button>
                  )}
                </div>
              </form>
            )}

            <div className="mt-5 p-3 rounded-lg bg-slate-900/60 border border-slate-800 text-[11px] text-slate-400 font-mono">
              <span className="text-slate-400 font-semibold block mb-0.5">YÊU CẦU:</span>
              Telegram ID phải cấu hình trong <code className="text-indigo-300">ADMIN_IDS</code> trên VPS.
            </div>
          </div>
        )}

        {/* Token Tab */}
        {tab === "token" && (
          <form onSubmit={handleTokenLogin} className="space-y-4">
            <div>
              <label className="text-[11px] font-mono uppercase text-slate-400 block mb-1.5 tracking-wider">
                Admin Secret Key
              </label>
              <div className="relative">
                <input
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Nhập ADMIN_SECRET..."
                  autoFocus
                  className="w-full dev-input rounded-lg px-3.5 py-2.5 pr-10 text-xs font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {tokenError && (
              <div className="bg-rose-950/40 border border-rose-800/50 rounded-lg px-3 py-2 text-xs text-rose-300 font-mono">
                {tokenError}
              </div>
            )}

            <button
              type="submit"
              disabled={!token.trim() || tokenLoading}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-mono font-semibold disabled:opacity-50 transition-all cursor-pointer shadow-sm"
            >
              {tokenLoading ? "ĐANG XÁC THỰC..." : "ĐĂNG NHẬP HỆ THỐNG"}
            </button>

            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 text-[11px] text-slate-400 font-mono">
              <span className="text-slate-400 font-semibold block mb-0.5">HƯỚNG DẪN:</span>
              Token được đặt trong biến môi trường <code className="text-indigo-300">ADMIN_SECRET</code> của bot.
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
