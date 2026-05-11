/**
 * emoji-map.js
 * Loads custom emoji packs from DB and maps product names to custom emoji IDs
 * via keyword matching.
 */

import prisma from "./lib/prisma.js";

const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

let _cache = null;
let _cacheAt = 0;

// keyword → standard emoji fallback char
// Order matters: more specific rules first
const KEYWORD_RULES = [
    { keywords: ["chatgpt", "gpt-4", "gpt4", "gpt-3", "gpt3", "openai"], char: "🤖" },
    { keywords: ["claude", "anthropic"], char: "🧠" },
    { keywords: ["gemini", "bard", "google ai", "google one"], char: "✨" },
    { keywords: ["grok", "xai", "x.ai"], char: "🔮" },
    { keywords: ["copilot", "bing", "microsoft 365", "office 365", "m365"], char: "🖥️" },
    { keywords: ["midjourney", "midj"], char: "🎨" },
    { keywords: ["dall-e", "dalle", "stable diffusion", "ideogram", "flux"], char: "🖼️" },
    { keywords: ["perplexity", "pplx"], char: "🔍" },
    { keywords: ["cursor", "windsurf", "codeium", "github copilot"], char: "💻" },
    { keywords: ["suno", "udio", "nhạc ai", "music ai"], char: "🎵" },
    { keywords: ["veo", "sora", "runway", "kling", "video ai"], char: "🎬" },
    { keywords: ["capcut", "cap cut", "video edit"], char: "✂️" },
    { keywords: ["canva"], char: "🎨" },
    { keywords: ["adobe", "photoshop", "lightroom", "premiere", "after effect", "illustrator", "firefly"], char: "🎨" },
    { keywords: ["figma"], char: "🖌️" },
    { keywords: ["notion"], char: "📝" },
    { keywords: ["netflix"], char: "🎥" },
    { keywords: ["spotify"], char: "🎵" },
    { keywords: ["youtube premium", "youtube music"], char: "▶️" },
    { keywords: ["youtube"], char: "▶️" },
    { keywords: ["tiktok", "tik tok"], char: "🎶" },
    { keywords: ["discord"], char: "💬" },
    { keywords: ["instagram", "insta"], char: "📷" },
    { keywords: ["facebook"], char: "👥" },
    { keywords: ["twitter", "x pro"], char: "🐦" },
    { keywords: ["telegram premium"], char: "✈️" },
    { keywords: ["duolingo", "duo"], char: "🦉" },
    { keywords: ["apple one", "icloud", "itunes", "apple tv", "apple music"], char: "🍎" },
    { keywords: ["amazon prime", "prime video"], char: "📺" },
    { keywords: ["hma", "nordvpn", "expressvpn", "surfshark", "vpn"], char: "🔒" },
    { keywords: ["proton", "protonmail", "protonvpn"], char: "🔐" },
    { keywords: ["1password", "bitwarden", "lastpass"], char: "🔑" },
    { keywords: ["grammarly"], char: "✍️" },
    { keywords: ["replit"], char: "💻" },
    { keywords: ["poe"], char: "🤖" },
    { keywords: ["character.ai", "character ai"], char: "🤖" },
    { keywords: ["twitch"], char: "🎮" },
    { keywords: ["steam", "game pass", "xbox"], char: "🎮" },
    { keywords: ["zoom", "meet", "teams meeting"], char: "📹" },
    { keywords: ["dropbox", "onedrive", "google drive"], char: "☁️" },
    { keywords: ["wordtune", "quillbot"], char: "✍️" },
    { keywords: ["elevenlabs", "murf", "giọng ai", "voice ai"], char: "🎙️" },
    { keywords: ["heygen", "d-id", "avatar ai"], char: "👤" },
    { keywords: ["remove.bg", "photoroom", "cleanup.pictures"], char: "🖼️" },
    { keywords: ["crunchyroll", "funimation", "anime"], char: "🎌" },
];

async function loadPacks() {
    const now = Date.now();
    if (_cache && now - _cacheAt < CACHE_TTL) return _cache;

    try {
        const setting = await prisma.setting.findUnique({ where: { key: "emoji_packs" } });
        if (!setting?.value) {
            _cache = new Map();
            _cacheAt = now;
            return _cache;
        }

        const packs = JSON.parse(setting.value);
        // Build emojiChar → first sticker with a custom_emoji_id
        const byChar = new Map();
        for (const stickers of Object.values(packs)) {
            for (const s of stickers) {
                if (s.id && s.emoji && !byChar.has(s.emoji)) {
                    byChar.set(s.emoji, { char: s.emoji, id: s.id });
                }
            }
        }
        _cache = byChar;
        _cacheAt = now;
    } catch {
        _cache = _cache || new Map();
    }

    return _cache;
}

export function invalidateEmojiCache() {
    _cache = null;
    _cacheAt = 0;
}

/**
 * Match a product name to a custom emoji using keyword rules.
 * Returns { char, id } or null if no pack sticker matched (caller can use char as fallback).
 */
export async function matchEmojiByName(name = "") {
    if (!name) return null;
    const lower = name.toLowerCase();
    const byChar = await loadPacks();

    for (const rule of KEYWORD_RULES) {
        if (rule.keywords.some((kw) => lower.includes(kw))) {
            const sticker = byChar.get(rule.char);
            if (sticker) return sticker;
            // Return char-only fallback (no custom ID) so caller still gets the emoji
            return { char: rule.char, id: null };
        }
    }

    return null;
}

/**
 * Build a Map<productId, { char, id }> for a list of products.
 * Respects manually set product.iconEmojiId first.
 */
export async function getProductEmojis(products = []) {
    if (!products.length) return new Map();

    // Preload cache once
    await loadPacks();

    const result = new Map();
    await Promise.all(
        products.map(async (product) => {
            if (product.iconEmojiId) {
                result.set(product.id, { char: "📦", id: product.iconEmojiId });
                return;
            }
            const match = await matchEmojiByName(product.name);
            if (match) result.set(product.id, match);
        }),
    );

    return result;
}
