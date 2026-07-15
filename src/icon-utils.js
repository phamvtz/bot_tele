const CUSTOM_EMOJI_ID_PATTERN = /^\d{5,30}$/;

export function normalizeCustomEmojiId(value) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const id = String(value).trim();
    if (!id) return null;
    if (!CUSTOM_EMOJI_ID_PATTERN.test(id)) {
        throw new Error("Custom Emoji ID phải gồm 5-30 chữ số");
    }
    return id;
}

export function extractIconPayloadFromText(message, fallbackIcon = "✨") {
    const text = String(message?.text || "").trim();
    if (!text) return null;

    const customEmojiEntity = (message?.entities || []).find((entity) => entity.type === "custom_emoji");
    if (customEmojiEntity?.custom_emoji_id) {
        return {
            icon: text,
            iconEmojiId: normalizeCustomEmojiId(customEmojiEntity.custom_emoji_id),
        };
    }

    try {
        const directId = normalizeCustomEmojiId(text);
        if (directId) return { icon: fallbackIcon || "✨", iconEmojiId: directId };
    } catch {
        // Text không phải ID thì được dùng như emoji tĩnh bình thường.
    }

    return { icon: text, iconEmojiId: null };
}
