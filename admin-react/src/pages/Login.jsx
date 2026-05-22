import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, Eye, EyeOff } from "lucide-react";

export default function Login() {
  const [token, setToken] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleLogin(e) {
    e.preventDefault();
    if (!token.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/stats", {
        headers: { "x-admin-token": token.trim() },
      });
      if (res.ok) {
        localStorage.setItem("admin_token", token.trim());
        navigate("/", { replace: true });
      } else {
        setError("Token không đúng. Kiểm tra lại ADMIN_SECRET trong file .env trên VPS.");
      }
    } catch {
      setError("Không kết nối được server.");
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 w-full max-w-sm p-8">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-primary-500 flex items-center justify-center mb-3">
            <Lock size={22} className="text-white" />
          </div>
          <h1 className="text-lg font-bold text-gray-900">Admin Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Nhập Admin Secret để tiếp tục</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1.5">
              Admin Secret Token
            </label>
            <div className="relative">
              <input
                type={show ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Nhập ADMIN_SECRET..."
                autoFocus
                className="w-full border border-gray-200 rounded-xl px-4 py-3 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              >
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-600">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!token.trim() || loading}
            className="w-full py-3 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 disabled:opacity-50 transition-colors"
          >
            {loading ? "Đang xác thực..." : "Đăng nhập"}
          </button>
        </form>

        <div className="mt-6 p-4 bg-gray-50 rounded-xl">
          <p className="text-xs text-gray-500 font-medium mb-1">Cách lấy token:</p>
          <p className="text-xs text-gray-400">
            Xem giá trị <code className="bg-white px-1 rounded border border-gray-200 text-gray-600">ADMIN_SECRET</code> trong file{" "}
            <code className="bg-white px-1 rounded border border-gray-200 text-gray-600">.env</code> trên VPS.
          </p>
        </div>
      </div>
    </div>
  );
}
