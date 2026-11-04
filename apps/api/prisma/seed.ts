import "../src/config.js";
import { PrismaClient } from "@prisma/client";
import { seedData } from "./seed-data.js";
const prisma = new PrismaClient();
try {
  await seedData(prisma);
  console.log("演示数据已就绪（保留已有工单和操作记录）");
} finally {
  await prisma.$disconnect();
}
