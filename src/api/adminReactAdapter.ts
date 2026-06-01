import type { Request, Response, NextFunction } from 'express';

/**
 * admin-new gọi /api/admin-react với query khác admin cũ:
 * - page bắt đầu từ 1 (admin cũ từ 0)
 * - search thay vì q
 */
export function adaptAdminReactQuery(req: Request, _res: Response, next: NextFunction) {
  if (req.query.page !== undefined) {
    const p = parseInt(String(req.query.page), 10);
    if (!Number.isNaN(p) && p >= 1) {
      req.query.page = String(p - 1);
    }
  }
  if (typeof req.query.search === 'string' && req.query.search && !req.query.q) {
    req.query.q = req.query.search;
  }
  next();
}
