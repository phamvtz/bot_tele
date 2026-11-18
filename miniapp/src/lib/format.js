const ICON_CDN = "https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons";

const ICON_MAP = [
  { k: ["chatgpt", "chat gpt", "openai"], s: "openai" },
  { k: ["claude"], s: "claude" },
  { k: ["gemini"], s: "google-gemini" },
  { k: ["cursor"], s: "cursor" },
  { k: ["canva"], s: "canva" },
  { k: ["capcut", "cap cut"], s: "capcut" },
  { k: ["adobe photoshop", "photoshop"], s: "adobe-photoshop" },
  { k: ["adobe premiere", "premiere"], s: "adobe-premiere-pro" },
  { k: ["adobe"], s: "adobe" },
  { k: ["netflix"], s: "netflix" },
  { k: ["spotify"], s: "spotify" },
  { k: ["youtube", "yt premium"], s: "youtube" },
  { k: ["midjourney"], s: "midjourney" },
  { k: ["notion"], s: "notion" },
  { k: ["figma"], s: "figma" },
  { k: ["github"], s: "github" },
  { k: ["discord"], s: "discord" },
  { k: ["telegram"], s: "telegram" },
  { k: ["microsoft", "office"], s: "microsoft" },
  { k: ["google"], s: "google" },
  { k: ["nordvpn"], s: "nordvpn" },
  { k: ["expressvpn"], s: "expressvpn" },
  { k: ["steam"], s: "steam" },
];

export function resolveProductIconUrl(product) {
  if (product?.imageUrl) return product.imageUrl;
  if (product?.iconSlug) return `${ICON_CDN}/${product.iconSlug}/default.svg`;
  const hay = `${product?.name || ""} ${product?.code || ""} ${product?.categoryName || ""}`.toLowerCase();
  for (const { k, s } of ICON_MAP) {
    if (k.some((kw) => hay.includes(kw))) {
      return `${ICON_CDN}/${s}/default.svg`;
    }
  }
  return null;
}

export function formatVnd(amount) {
  return `${new Intl.NumberFormat("vi-VN").format(Math.round(Number(amount || 0)))}đ`;
}

export function formatUsd(amount, digits = 2) {
  return `$${Number(amount || 0).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function formatDualPrice(amountVnd, usdVndRate = 26500) {
  const rate = Number(usdVndRate) > 0 ? Number(usdVndRate) : 26500;
  const usd = Number(amountVnd || 0) / rate;
  return `${formatUsd(usd)} · ${formatVnd(amountVnd)}`;
}

export function formatTokensCompact(tokens) {
  const n = Number(tokens || 0);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000_000) {
    const b = n / 1_000_000_000;
    return `${Number.isInteger(b) ? b : b.toFixed(1).replace(/\.0$/, "")}B`;
  }
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1_000) {
    return `${Math.round(n / 1000)}K`;
  }
  return String(n);
}

export function formatDateTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function formatCountdown(expiresAt, now = Date.now()) {
  if (!expiresAt) return null;
  const diffSec = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  return {
    expired: diffSec <= 0,
    totalSec: diffSec,
    text: `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`,
  };
}
