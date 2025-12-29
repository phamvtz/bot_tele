import vi from "./vi.js";
import en from "./en.js";

const languages = { vi, en };

/**
 * i18n - Internationalization module
 */
export function t(key, lang = "vi", params = {}) {
    const translations = languages[lang] || languages.vi;
    let text = translations[key] || languages.vi[key] || key;

    // Replace params
    for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, "g"), v);
    }

    return text;
}

export function getLanguages() {
    return [
        { code: "vi", name: "🇻🇳 Tiếng Việt" },
        { code: "en", name: "🇬🇧 English" },
    ];
}

export default { t, getLanguages };
