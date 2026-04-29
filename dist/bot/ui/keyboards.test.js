import { describe, expect, it } from 'vitest';
import { Keyboards, paginationRow } from './keyboards.js';
describe('Keyboards', () => {
    it('builds the main menu with the expected scene routes', () => {
        const callbacks = Keyboards.mainMenu().inline_keyboard
            .flat()
            .map((button) => button.callback_data)
            .filter((value) => Boolean(value));
        expect(callbacks).toEqual([
            'scene:SHOP',
            'scene:WALLET',
            'scene:ORDERS',
            'scene:PROFILE',
            'scene:SUPPORT',
            'scene:REFERRAL',
        ]);
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
