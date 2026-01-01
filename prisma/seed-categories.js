import prisma from '../src/lib/prisma.js';

const categories = [
    { name: 'Mail Reg Phone New', icon: '📧', order: 1 },
    { name: 'Chat GPT', icon: '🤖', order: 2 },
    { name: 'CapCut Pro', icon: '✂️', order: 3 },
    { name: 'Youtube Pre', icon: '▶️', order: 4 },
    { name: 'Src Code Bot', icon: '💻', order: 5 },
    { name: 'Tool Quản Lý Chrome', icon: '🌐', order: 6 },
    { name: 'Tool Veo 3 Tạo AI', icon: '🎬', order: 7 },
];

const products = [
    // Mail Reg Phone New
    { category: 'Mail Reg Phone New', code: 'MAIL001', name: 'Mail Reg Phone New 24H', price: 15000, deliveryMode: 'TEXT', payload: 'Liên hệ Admin @vanggohh' },
    { category: 'Mail Reg Phone New', code: 'MAIL002', name: 'Mail Reg Dính Phone Ẩn', price: 50000, deliveryMode: 'TEXT', payload: 'Liên hệ Admin @vanggohh' },
    { category: 'Mail Reg Phone New', code: 'MAIL003', name: 'Mail Trial YTB', price: 0, deliveryMode: 'TEXT', payload: 'Liên hệ Admin @vanggohh' },
    { category: 'Mail Reg Phone New', code: 'MAIL004', name: 'Mail GG One', price: 0, deliveryMode: 'TEXT', payload: 'Liên hệ Admin @vanggohh' },

    // Chat GPT
    { category: 'Chat GPT', code: 'GPT001', name: 'Chat GPT Chính Chủ', price: 0, deliveryMode: 'TEXT', payload: 'Liên hệ Admin @vanggohh' },
    { category: 'Chat GPT', code: 'GPT002', name: 'Chat GPT 1 Tháng BH Full Fam Business', price: 50000, deliveryMode: 'TEXT', payload: 'Liên hệ Admin @vanggohh' },
    { category: 'Chat GPT', code: 'GPT003', name: 'Chat GPT Cấp 1 Tháng BH Full', price: 0, deliveryMode: 'TEXT', payload: 'Liên hệ Admin @vanggohh' },

    // CapCut Pro
    { category: 'CapCut Pro', code: 'CAP001', name: 'CapCut Pro 7D', price: 2000, deliveryMode: 'TEXT', payload: 'Liên hệ Admin @vanggohh' },
    { category: 'CapCut Pro', code: 'CAP002', name: 'CapCut Pro Chính Chủ', price: 0, deliveryMode: 'TEXT', payload: 'Liên hệ Admin @vanggohh' },

    // Youtube Pre
    { category: 'Youtube Pre', code: 'YTB001', name: 'Acc Fam Add 5 Người', price: 35000, deliveryMode: 'TEXT', payload: 'Liên hệ Admin @vanggohh' },

    // Src Code Bot
    { category: 'Src Code Bot', code: 'BOT001', name: 'Src Code Bot Này', price: 200000, deliveryMode: 'TEXT', payload: 'Liên hệ Admin @vanggohh' },
    { category: 'Src Code Bot', code: 'BOT002', name: 'Src Code Bot Làm Riêng', price: 0, deliveryMode: 'TEXT', payload: 'Liên hệ: 200k-500k - @vanggohh' },

    // Tool Quản Lý Chrome
    { category: 'Tool Quản Lý Chrome', code: 'TOOL001', name: 'GpmLogin Crack VV', price: 400000, deliveryMode: 'TEXT', payload: 'Liên hệ Admin @vanggohh' },
    { category: 'Tool Quản Lý Chrome', code: 'TOOL002', name: 'GenLogin Crack VV', price: 400000, deliveryMode: 'TEXT', payload: 'Liên hệ Admin @vanggohh' },

    // Tool Veo 3
    { category: 'Tool Veo 3 Tạo AI', code: 'VEO001', name: 'Tool Veo 3 Tạo AI', price: 0, deliveryMode: 'TEXT', payload: 'Liên hệ Admin @vanggohh (Tất cả Liên Hệ chuyển qua Admin)' },
];

async function main() {
    console.log('🗑️  Deleting old data...');

    // Delete old products and categories
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();

    console.log('✅ Old data deleted');
    console.log('📁 Creating categories...');

    // Create categories
    for (const cat of categories) {
        await prisma.category.create({ data: cat });
        console.log(`   ✅ ${cat.icon} ${cat.name}`);
    }

    console.log('📦 Creating products...');

    // Create products
    for (const prod of products) {
        const category = await prisma.category.findUnique({
            where: { name: prod.category }
        });

        await prisma.product.create({
            data: {
                code: prod.code,
                name: prod.name,
                price: prod.price,
                deliveryMode: prod.deliveryMode,
                payload: prod.payload,
                categoryId: category.id,
                currency: 'VND',
            }
        });
        console.log(`   ✅ ${prod.name} (${prod.price.toLocaleString()}đ)`);
    }

    console.log('🎉 Seed completed!');
    console.log(`📊 Created ${categories.length} categories and ${products.length} products`);
}

main()
    .catch(e => {
        console.error('❌ Seed failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
