import { secretEquals } from "../lib/secret-compare.js";

export function adminAuth(req, res, next) {
    const token = req.headers["x-admin-token"];
    // So sánh thời gian không đổi (M7) — `!==` rò rỉ prefix đúng qua thời gian.
    if (!secretEquals(token, process.env.ADMIN_SECRET)) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
}
