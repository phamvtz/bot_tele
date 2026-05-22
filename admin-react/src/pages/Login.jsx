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
        // 60s countdown before allow resend
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
        // Validate the returned secret against the API
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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 w-full max-w-sm p-8">
        {/* Logo */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-primary-500 flex items-center justify-center mb-3">
            <Lock size={22} className="text-white" />
          </div>
          <h1 className="text-lg font-bold text-gray-900">Admin Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Đăng nhập để quản lý hệ thống</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border border-gray-200 rounded-xl p-1 mb-6">
          <button
            onClick={() => { setTab("otp"); setOtpError(""); setStep(1); setOtp(""); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${tab === "otp" ? "bg-primary-500 text-white" : "text-gray-500 hover:bg-gray-50"}`}
          >
            <MessageSquare size={13} />
            OTP Telegram
          </button>
          <button
            onClick={() => { setTab("token"); setTokenError(""); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${tab === "token" ? "bg-primary-500 text-white" : "text-gray-500 hover:bg-gray-50"}`}
          >
            <KeyRound size={13} />
            Nhập Token
          </button>
        </div>

        {/* OTP Tab */}
        {tab === "otp" && (
          <div>
            {step === 1 ? (
              <form onSubmit={requestOtp} className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-gray-700 block mb-1.5">
                    Telegram ID của bạn
                  </label>
                  <input
                    type="text"
                    value={telegramId}
                    onChange={(e) => setTelegramId(e.target.value)}
                    placeholder="VD: 123456789"
                    autoFocus
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 transition-colors"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Dùng bot <code className="bg-gray-100 px-1 rounded">@userinfobot</code> để lấy ID
                  </p>
                </div>

                {otpError && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-600">
                    {otpError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!telegramId.trim() || otpLoading}
                  className="w-full py-3 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  <Send size={15} />
                  {otpLoading ? "Đang gửi..." : "Gửi mã OTP qua Telegram"}
                </button>
              </form>
            ) : (
              <form onSubmit={verifyOtp} className="space-y-4">
                <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-xs text-green-700">
                  ✓ Đã gửi mã OTP đến Telegram ID <strong>{telegramId}</strong>. Kiểm tra tin nhắn từ bot.
                </div>

                <div>
                  <label className="text-xs font-medium text-gray-700 block mb-1.5">
                    Mã OTP (6 chữ số)
                  </label>
                  <input
                    type="text"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="000000"
                    autoFocus
                    maxLength={6}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-center tracking-[0.4em] font-mono font-bold focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 transition-colors"
                  />
                </div>

                {otpError && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-600">
                    {otpError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={otp.length !== 6 || otpLoading}
                  className="w-full py-3 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 disabled:opacity-50 transition-colors"
                >
                  {otpLoading ? "Đang xác thực..." : "Đăng nhập"}
                </button>

                <div className="flex items-center justify-between text-xs text-gray-400">
                  <button
                    type="button"
                    onClick={() => { setStep(1); setOtp(""); setOtpError(""); }}
                    className="hover:text-gray-600 transition-colors"
                  >
                    ← Đổi Telegram ID
                  </button>
                  {countdown > 0 ? (
                    <span>Gửi lại sau {countdown}s</span>
                  ) : (
                    <button
                      type="button"
                      onClick={requestOtp}
                      className="text-primary-600 hover:text-primary-700 transition-colors"
                    >
                      Gửi lại mã
                    </button>
                  )}
                </div>
              </form>
            )}

            <div className="mt-5 p-4 bg-gray-50 rounded-xl">
              <p className="text-xs text-gray-500 font-medium mb-1">Điều kiện đăng nhập:</p>
              <p className="text-xs text-gray-400">
                Telegram ID của bạn phải có trong danh sách <code className="bg-white px-1 rounded border border-gray-200 text-gray-600">ADMIN_IDS</code> trên VPS.
              </p>
            </div>
          </div>
        )}

        {/* Token Tab */}
        {tab === "token" && (
          <form onSubmit={handleTokenLogin} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1.5">
                Admin Secret Token
              </label>
              <div className="relative">
                <input
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Nhập ADMIN_SECRET..."
                  autoFocus
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {tokenError && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-600">
                {tokenError}
              </div>
            )}

            <button
              type="submit"
              disabled={!token.trim() || tokenLoading}
              className="w-full py-3 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 disabled:opacity-50 transition-colors"
            >
              {tokenLoading ? "Đang xác thực..." : "Đăng nhập"}
            </button>

            <div className="p-4 bg-gray-50 rounded-xl">
              <p className="text-xs text-gray-500 font-medium mb-1">Cách lấy token:</p>
              <p className="text-xs text-gray-400">
                Xem giá trị <code className="bg-white px-1 rounded border border-gray-200 text-gray-600">ADMIN_SECRET</code> trong file{" "}
                <code className="bg-white px-1 rounded border border-gray-200 text-gray-600">.env</code> trên VPS.
              </p>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
