import { getRawInitData } from "./telegram.js";

const SESSION_STORAGE_KEY = "tma_session_v1";

let _channelGateHandler = null;
export function onChannelGateRequired(fn) {
  _channelGateHandler = fn;
}

export function getSavedSessionToken() {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function saveSessionToken(token) {
  if (!token) return;
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, token);
  } catch {}
}

export async function tmaFetch(path, { method = "GET", body, signal } = {}) {
  const initData = getRawInitData();
  const sessionToken = getSavedSessionToken();

  const headers = {
    Accept: "application/json",
  };
  if (initData) {
    headers.Authorization = `tma ${initData}`;
    if (sessionToken) headers["x-tma-session"] = sessionToken;
  } else if (sessionToken) {
    headers.Authorization = `Bearer ${sessionToken}`;
  }

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`/api/tma${path.startsWith("/") ? path : `/${path}`}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  let data = {};
  try {
    data = await res.json();
  } catch {}

  if (!res.ok) {
    if (res.status === 403 && data?.code === "CHANNEL_JOIN_REQUIRED") {
      _channelGateHandler?.(data);
    }
    const err = new Error(data?.error || `Lỗi kết nối (${res.status})`);
    err.status = res.status;
    err.code = data?.code || null;
    err.payload = data;
    throw err;
  }

  if (data?.sessionToken) {
    saveSessionToken(data.sessionToken);
  }

  return data;
}

export function makeClientRef(prefix = "tma") {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}
