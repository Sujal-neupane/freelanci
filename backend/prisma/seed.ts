import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  const adminEmail = 'admin@freelanci.com';
  const adminPassword = 'FreelanciAdminSecure2026!';
  const adminHash = await bcrypt.hash(adminPassword, 12);

  // Seed Admin User
  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      passwordHash: adminHash,
      role: 'ADMIN'
    },
    create: {
      email: adminEmail,
      name: 'System Administrator',
      passwordHash: adminHash,
      role: 'ADMIN',
      passwordChangedAt: new Date()
    }
  });

  // Create password history for admin if not exists
  const hasHistory = await prisma.passwordHistory.findFirst({
    where: { userId: adminUser.id }
  });
  if (!hasHistory) {
    await prisma.passwordHistory.create({
      data: {
        userId: adminUser.id,
        passwordHash: adminHash
      }
    });
  }

  console.log('Admin credentials seeded successfully:');
  console.log(`- Email: ${adminEmail}`);
  console.log(`- Password: ${adminPassword}`);
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
