import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@collabhq.com';
  const password = 'Password123!';

  console.log('Checking for existing default user...');
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    console.log(`Default user ${email} already exists.`);
    return;
  }

  console.log('Hashing default user password...');
  const passwordHash = await bcrypt.hash(password, 10);

  console.log('Seeding default admin user...');
  const user = await prisma.user.create({
    data: {
      name: 'Admin User',
      email,
      passwordHash,
      role: 'admin',
      status: 'offline',
    },
  });

  console.log(`Successfully seeded default user: ${user.name} (${user.email})`);
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
