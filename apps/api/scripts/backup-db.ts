import "../src/config.js";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
try {
  const directory = fileURLToPath(new URL("../../../.cache/backups/", import.meta.url));
  await mkdir(directory, { recursive: true });
  const destination = join(
    directory,
    `salespilot-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.db`,
  );
  await db.$executeRaw`VACUUM INTO ${destination}`;
  console.log(`SQLite 一致性备份已保存：${destination}`);
} finally {
  await db.$disconnect();
}
