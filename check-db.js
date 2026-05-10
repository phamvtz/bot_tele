// Quick check script - run this to verify database
import prisma from './src/lib/prisma.js';

async function check() {
    console.log('\n📊 DATABASE CHECK\n');

    // Check categories
    const categories = await prisma.category.findMany({
        include: {
            _count: { select: { products: true } }
        }
    });

    console.log(`📁 Categories: ${categories.length}`);
    categories.forEach(cat => {
        console.log(`   ${cat.isActive ? '✅' : '❌'} ${cat.icon} ${cat.name} - ${cat._count.products} products`);
    });

    // Check products
    const products = await prisma.product.findMany({
        include: { category: true }
    });

    console.log(`\n📦 Products: ${products.length}`);
    products.forEach(p => {
        const catName = p.category?.name || 'NO CATEGORY';
        console.log(`   ${p.isActive ? '✅' : '❌'} ${p.name} - ${catName}`);
    });

    // Check active products per category
    console.log('\n📊 Active products per category:');
    for (const cat of categories) {
        const activeCount = await prisma.product.count({
            where: { categoryId: cat.id, isActive: true }
        });
        console.log(`   ${cat.icon} ${cat.name}: ${activeCount} active`);
    }

    await prisma.$disconnect();
}

check();
