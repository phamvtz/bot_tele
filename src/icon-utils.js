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

export function buildCustomEmojiCheckResult(iconIds = {}, stickers = []) {
    const entries = Object.entries(iconIds)
        .map(([key, value]) => ({ key, id: normalizeCustomEmojiId(value) }))
        .filter((item) => item.id);
    const uniqueIds = new Set(entries.map((item) => item.id));
    if (uniqueIds.size > 200) {
        throw new Error("Chỉ có thể kiểm tra tối đa 200 Custom Emoji ID mỗi lần");
    }

    const stickersById = new Map(
        stickers
            .filter((sticker) => sticker?.custom_emoji_id)
            .map((sticker) => [String(sticker.custom_emoji_id), sticker]),
    );
    const items = entries.map(({ key, id }) => {
        const sticker = stickersById.get(id);
        return {
            key,
            id,
            valid: Boolean(sticker),
            emoji: sticker?.emoji || null,
            setName: sticker?.set_name || null,
        };
    });

    return {
        total: items.length,
        valid: items.filter((item) => item.valid).length,
        invalid: items.filter((item) => !item.valid).length,
        items,
    };
}
