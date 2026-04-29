import { describe, expect, it } from 'vitest';
import { E, p } from './emojis.js';
describe('emoji helpers', () => {
    it('returns the fallback emoji when no premium id is provided', () => {
        expect(p('⬅️')).toBe('⬅️');
    });
    it('wraps the fallback emoji in a tg-emoji tag when an id is provided', () => {
        expect(p('⬅️', '123456')).toBe('<tg-emoji emoji-id="123456">⬅️</tg-emoji>');
    });
    it('exports plain fallback icons for standard UI emojis', () => {
        expect(E.HOME).toBe('🏠');
        expect(E.BUY).toBe('🛒');
    });
});
