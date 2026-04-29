import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── Dữ liệu danh mục ──────────────────────────────────────────────────────────

const categories = [
  { name: 'NETFLIX',      slug: 'netflix',      emoji: '🎬', sortOrder: 1 },
  { name: 'YOUTUBE',      slug: 'youtube',      emoji: '▶️', sortOrder: 2 },
  { name: 'GG ONE PIXEL', slug: 'gg-one-pixel', emoji: '☁️', sortOrder: 3 },
  { name: 'VEO 3 ULTRA',  slug: 'veo-3-ultra',  emoji: '🎥', sortOrder: 4 },
  { name: 'GROK',         slug: 'grok',         emoji: '🤖', sortOrder: 5 },
  { name: 'CHATGPT',      slug: 'chatgpt',      emoji: '💬', sortOrder: 6 },
];

// ── Dữ liệu sản phẩm (2 sản phẩm mỗi danh mục) ───────────────────────────────

const productsByCategory: Record<string, Array<{
  name: string; slug: string; emoji: string; desc: string; price: number; vipPrice: number;
  stocks: string[];
}>> = {
  netflix: [
    {
      name: 'Netflix Premium 1 Tháng',
      slug: 'netflix-premium-1m',
      emoji: '🎬',
      desc: 'Tài khoản Netflix Premium 4K - 1 tháng',
      price: 55000,
      vipPrice: 49000,
      stocks: [
        'email: netflix_user1@gmail.com | pass: NetFlix@2024#A | profile: 1',
        'email: netflix_user2@gmail.com | pass: NetFlix@2024#B | profile: 2',
        'email: netflix_user3@gmail.com | pass: NetFlix@2024#C | profile: 1',
      ],
    },
    {
      name: 'Netflix Premium 4K - 3 Tháng',
      slug: 'netflix-premium-3m',
      emoji: '🎬',
      desc: 'Tài khoản Netflix Premium 4K - 3 tháng',
      price: 149000,
      vipPrice: 129000,
      stocks: [
        'email: netflix_vip1@gmail.com | pass: VipNetFlix@2024#A | gói: 3 tháng',
        'email: netflix_vip2@gmail.com | pass: VipNetFlix@2024#B | gói: 3 tháng',
      ],
    },
  ],
  youtube: [
    {
      name: 'YouTube Premium 1 Tháng',
      slug: 'youtube-premium-1m',
      emoji: '▶️',
      desc: 'Tài khoản YouTube Premium - không quảng cáo - 1 tháng',
      price: 39000,
      vipPrice: 34000,
      stocks: [
        'email: yt_premium1@gmail.com | pass: YouTube@Premium#1 | hết hạn: 30 ngày',
        'email: yt_premium2@gmail.com | pass: YouTube@Premium#2 | hết hạn: 30 ngày',
        'email: yt_premium3@gmail.com | pass: YouTube@Premium#3 | hết hạn: 30 ngày',
      ],
    },
    {
      name: 'YouTube Premium 3 Tháng',
      slug: 'youtube-premium-3m',
      emoji: '▶️',
      desc: 'Tài khoản YouTube Premium - không quảng cáo - 3 tháng',
      price: 99000,
      vipPrice: 89000,
      stocks: [
        'email: yt_vip1@gmail.com | pass: YT_VIP@2024#A | hết hạn: 90 ngày',
        'email: yt_vip2@gmail.com | pass: YT_VIP@2024#B | hết hạn: 90 ngày',
      ],
    },
  ],
  'gg-one-pixel': [
    {
      name: 'Google One 100GB - 1 Tháng',
      slug: 'gg-one-100gb-1m',
      emoji: '☁️',
      desc: 'Google One 100GB lưu trữ đám mây - 1 tháng',
      price: 35000,
      vipPrice: 30000,
      stocks: [
        'email: ggone_100g_1@gmail.com | pass: GGOne@100GB#1 | dung lượng: 100GB',
        'email: ggone_100g_2@gmail.com | pass: GGOne@100GB#2 | dung lượng: 100GB',
      ],
    },
    {
      name: 'Google One 200GB - 3 Tháng',
      slug: 'gg-one-200gb-3m',
      emoji: '☁️',
      desc: 'Google One 200GB lưu trữ đám mây - 3 tháng',
      price: 89000,
      vipPrice: 79000,
      stocks: [
        'email: ggone_200g_1@gmail.com | pass: GGOne@200GB#1 | dung lượng: 200GB | 3 tháng',
        'email: ggone_200g_2@gmail.com | pass: GGOne@200GB#2 | dung lượng: 200GB | 3 tháng',
      ],
    },
  ],
  'veo-3-ultra': [
    {
      name: 'Veo 3 Ultra - 1 Tháng',
      slug: 'veo3-ultra-1m',
      emoji: '🎥',
      desc: 'Tài khoản Veo 3 Ultra - tạo video AI chất lượng cao - 1 tháng',
      price: 199000,
      vipPrice: 179000,
      stocks: [
        'email: veo3_ultra1@gmail.com | pass: Veo3Ultra@2024#A | gói: Ultra 1 tháng',
        'email: veo3_ultra2@gmail.com | pass: Veo3Ultra@2024#B | gói: Ultra 1 tháng',
      ],
    },
    {
      name: 'Veo 3 Ultra Pro - 3 Tháng',
      slug: 'veo3-ultra-pro-3m',
      emoji: '🎥',
      desc: 'Tài khoản Veo 3 Ultra Pro - tạo video 4K AI - 3 tháng',
      price: 549000,
      vipPrice: 499000,
      stocks: [
        'email: veo3_pro1@gmail.com | pass: Veo3Pro@2024#A | gói: Ultra Pro 3 tháng',
        'email: veo3_pro2@gmail.com | pass: Veo3Pro@2024#B | gói: Ultra Pro 3 tháng',
      ],
    },
  ],
  grok: [
    {
      name: 'Grok Premium - 1 Tháng',
      slug: 'grok-premium-1m',
      emoji: '🤖',
      desc: 'Tài khoản Grok AI (xAI) Premium - 1 tháng',
      price: 89000,
      vipPrice: 79000,
      stocks: [
        'email: grok_prem1@gmail.com | pass: GrokAI@2024#1 | gói: Premium 1 tháng',
        'email: grok_prem2@gmail.com | pass: GrokAI@2024#2 | gói: Premium 1 tháng',
      ],
    },
    {
      name: 'Grok SuperGrok - 3 Tháng',
      slug: 'grok-supergrok-3m',
      emoji: '🤖',
      desc: 'Tài khoản Grok SuperGrok - không giới hạn - 3 tháng',
      price: 249000,
      vipPrice: 219000,
      stocks: [
        'email: grok_super1@gmail.com | pass: SuperGrok@2024#A | gói: SuperGrok 3 tháng',
        'email: grok_super2@gmail.com | pass: SuperGrok@2024#B | gói: SuperGrok 3 tháng',
      ],
    },
  ],
  chatgpt: [
    {
      name: 'ChatGPT Plus - 1 Tháng',
      slug: 'chatgpt-plus-1m',
      emoji: '💬',
      desc: 'Tài khoản ChatGPT Plus (GPT-4o) - 1 tháng',
      price: 99000,
      vipPrice: 89000,
      stocks: [
        'email: chatgpt_plus1@gmail.com | pass: ChatGPT_Plus@2024#1 | gói: Plus 1 tháng',
        'email: chatgpt_plus2@gmail.com | pass: ChatGPT_Plus@2024#2 | gói: Plus 1 tháng',
        'email: chatgpt_plus3@gmail.com | pass: ChatGPT_Plus@2024#3 | gói: Plus 1 tháng',
      ],
    },
    {
      name: 'ChatGPT Team - 3 Tháng',
      slug: 'chatgpt-team-3m',
      emoji: '💬',
      desc: 'Tài khoản ChatGPT Team - không giới hạn GPT-4o - 3 tháng',
      price: 279000,
      vipPrice: 249000,
      stocks: [
        'email: chatgpt_team1@gmail.com | pass: ChatGPT_Team@2024#A | gói: Team 3 tháng',
        'email: chatgpt_team2@gmail.com | pass: ChatGPT_Team@2024#B | gói: Team 3 tháng',
      ],
    },
  ],
};

// ── Main Seed ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Bắt đầu seed dữ liệu...\n');

  for (const [i, catData] of categories.entries()) {
    // Upsert Category
    const category = await prisma.category.upsert({
      where: { slug: catData.slug },
      update: { name: catData.name, emoji: catData.emoji, sortOrder: catData.sortOrder },
      create: { ...catData, isActive: true },
    });
    console.log(`✅ Danh mục [${i + 1}]: ${category.name} (id: ${category.id})`);

    // Tạo products cho category này
    const products = productsByCategory[catData.slug] ?? [];
    for (const [j, prod] of products.entries()) {
      // Upsert Product
      const product = await prisma.product.upsert({
        where: { slug: prod.slug },
        update: {
          name: prod.name,
          basePrice: prod.price,
          vipPrice: prod.vipPrice,
          shortDescription: prod.desc,
        },
        create: {
          categoryId: category.id,
          name: prod.name,
          slug: prod.slug,
          thumbnailEmoji: prod.emoji,
          shortDescription: prod.desc,
          productType: 'AUTO_DELIVERY',
          deliveryType: 'ACCOUNT',
          basePrice: prod.price,
          vipPrice: prod.vipPrice,
          stockMode: 'TRACKED',
          stockCount: prod.stocks.length,
          isActive: true,
          isFeatured: j === 0, // sản phẩm đầu tiên là featured
        },
      });

      // Thêm stock items (chỉ thêm nếu chưa có)
      const existingCount = await prisma.stockItem.count({ where: { productId: product.id, status: 'AVAILABLE' } });
      if (existingCount === 0) {
        await prisma.stockItem.createMany({
          data: prod.stocks.map(content => ({
            productId: product.id,
            content,
            status: 'AVAILABLE',
          })),
        });
        console.log(`   📦 Sản phẩm [${j + 1}]: ${product.name} — ${prod.stocks.length} stock items`);
      } else {
        console.log(`   📦 Sản phẩm [${j + 1}]: ${product.name} — đã có ${existingCount} stock items (bỏ qua)`);
      }
    }
    console.log('');
  }

  console.log('🎉 Seed hoàn tất!');
  console.log(`   📁 ${categories.length} danh mục`);
  const totalProducts = Object.values(productsByCategory).reduce((sum, p) => sum + p.length, 0);
  console.log(`   🛍  ${totalProducts} sản phẩm`);
}

main()
  .catch((e) => {
    console.error('❌ Seed lỗi:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
