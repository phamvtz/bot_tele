import { describe, expect, it } from 'vitest';
import { Keyboards, paginationRow } from './keyboards.js';
describe('Keyboards', () => {
    it('builds the main menu with the expected scene routes', () => {
        const callbacks = Keyboards.mainMenu().inline_keyboard
            .flat()
            .map((button) => button.callback_data)
            .filter((value) => Boolean(value));
        expect(callbacks).toEqual([
            '_cls:primary:scene:SHOP',
            '_cls:primary:scene:DEPOSIT',
            '_cls:primary:scene:PROFILE',
            '_cls:primary:scene:ORDERS',
            '_cls:primary:scene:SUPPORT',
            '_cls:primary:close',
        ]);
    });
    it('builds the main menu with green user status row when user data is provided', () => {
        const user = { vipLevel: { name: 'Vàng' }, wallet: { balance: 50000 } };
        const rows = Keyboards.mainMenu(user).inline_keyboard;
        expect(rows[0][0].text).toContain('Hạng: Vàng | Số dư: 50.000 VNĐ');
        expect(rows[0][0].callback_data).toBe('_cls:success:scene:PROFILE');
    });
    it('builds pagination rows for the first page', () => {
        expect(paginationRow(0, 3, 'shop:page')).toEqual([
            { text: '1/3', callback_data: 'noop' },
            { text: 'Sau ▶️', callback_data: 'shop:page:1' },
        ]);
    });
    it('builds pagination rows for a middle page', () => {
        expect(paginationRow(1, 3, 'shop:page')).toEqual([
            { text: '◀️ Trước', callback_data: 'shop:page:0' },
            { text: '2/3', callback_data: 'noop' },
            { text: 'Sau ▶️', callback_data: 'shop:page:2' },
        ]);
    });
});
