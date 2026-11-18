/**
 * Wrapper an toàn cho Telegram WebApp SDK (`window.Telegram.WebApp`)
 */
export function getWebApp() {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp || null;
}

export function getRawInitData() {
  const twa = getWebApp();
  if (twa?.initData) return twa.initData;
  if (typeof window !== "undefined") {
    const hash = window.location.hash.replace(/^#/, "");
    const hashParams = new URLSearchParams(hash);
    if (hashParams.get("tgWebAppData")) return hashParams.get("tgWebAppData");
  }
  return "";
}

export function getStartParam() {
  const twa = getWebApp();
  if (twa?.initDataUnsafe?.start_param) return String(twa.initDataUnsafe.start_param);
  if (typeof window !== "undefined") {
    const searchParams = new URLSearchParams(window.location.search);
    return searchParams.get("tgWebAppStartParam") || searchParams.get("startapp") || "";
  }
  return "";
}

export function initTelegramApp() {
  const twa = getWebApp();
  if (!twa) return false;
  try {
    twa.ready();
    twa.expand();
    twa.disableVerticalSwipes?.();
    twa.setHeaderColor?.("#09090b");
    twa.setBackgroundColor?.("#09090b");
  } catch {}
  return true;
}

export function hapticImpact(style = "light") {
  try {
    getWebApp()?.HapticFeedback?.impactOccurred?.(style);
  } catch {}
}

export function hapticNotify(type = "success") {
  try {
    getWebApp()?.HapticFeedback?.notificationOccurred?.(type);
  } catch {}
}

export function openTelegramUrl(url) {
  if (!url) return;
  const twa = getWebApp();
  try {
    if (/^https?:\/\/t\.me\//i.test(url) && twa?.openTelegramLink) {
      twa.openTelegramLink(url);
      return;
    }
    if (twa?.openLink) {
      twa.openLink(url);
      return;
    }
  } catch {}
  window.open(url, "_blank", "noopener,noreferrer");
}

export function shareTelegramUrl(url, text = "") {
  if (!url) return;
  const shareLink = `https://t.me/share/url?url=${encodeURIComponent(url)}${
    text ? `&text=${encodeURIComponent(text)}` : ""
  }`;
  openTelegramUrl(shareLink);
}

export async function copyToClipboard(value) {
  const str = String(value ?? "");
  if (!str) return false;
  try {
    await navigator.clipboard.writeText(str);
    hapticNotify("success");
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = str;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) hapticNotify("success");
      return ok;
    } catch {
      return false;
    }
  }
}
