import axios from "axios";

const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN || localStorage.getItem("admin_token") || "";

const client = axios.create({
  baseURL: "/api/admin-react",
  headers: { "x-admin-token": ADMIN_TOKEN },
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem("admin_token");
  if (token) config.headers["x-admin-token"] = token;
  return config;
});

client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("admin_token");
      window.location.href = "/admin-new/login";
    }
    return Promise.reject(err);
  }
);

export default client;
