import { randomUUID } from "node:crypto";
import { mkdir, cp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../apps/api/src/auth.js";
import { seedData } from "../apps/api/prisma/seed-data.js";
import type { Config } from "../apps/api/src/config.js";

export const testPassword = "Test-only-password-2026";
export const testConfig: Config = {
  port: 3101,
  corsOrigin: "http://127.0.0.1:4173",
  mode: "demo",
  modelTimeout: 2000,
  toolTimeout: 2000,
  baseURL: undefined,
  apiKey: undefined,
  model: undefined,
};
export async function testDatabase() {
  const dir = resolve(".cache", `verification-${randomUUID()}`);
  await mkdir(resolve(dir, "migrations"), { recursive: true });
  await writeFile(resolve(dir, "schema.prisma"), await readFile("apps/api/prisma/schema.prisma"));
  await cp(
    "apps/api/prisma/migrations/20261101020740_init",
    resolve(dir, "migrations/20261101020740_init"),
    { recursive: true },
  );
  await cp(
    "apps/api/prisma/migrations/migration_lock.toml",
    resolve(dir, "migrations/migration_lock.toml"),
  );
  const url = `file:${resolve(dir, "test.db").replaceAll("\\", "/")}`;
  function deploy() {
    const result = spawnSync(
      process.execPath,
      [
        "node_modules/prisma/build/index.js",
        "migrate",
        "deploy",
        "--schema",
        resolve(dir, "schema.prisma"),
      ],
      { encoding: "utf8", env: { ...process.env, DATABASE_URL: url } },
    );
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  }
  const db = new PrismaClient({ datasources: { db: { url } } });
  await db.$queryRawUnsafe("SELECT 1");
  await db.$disconnect();
  deploy();
  await db.$executeRawUnsafe(
    `INSERT INTO "Customer" (id,name,email) VALUES ('legacy-customer','Legacy customer','legacy@example.test')`,
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "Order" (id,customerId,status) VALUES ('SO202600000','legacy-customer','DELIVERED')`,
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "AfterSalesTicket" (id,orderId,type,description,priority,status,idempotencyKey) VALUES ('ASLEGACY','SO202600000','REPAIR','Legacy problem','NORMAL','CREATED','legacy-idempotency-key')`,
  );
  await db.$disconnect();
  await cp(
    "apps/api/prisma/migrations/20261106000000_team_workflows",
    resolve(dir, "migrations/20261106000000_team_workflows"),
    { recursive: true },
  );
  deploy();
  await seedData(db);
  const passwordHash = await hashPassword(testPassword);
  for (const [username, name, role] of [
    ["admin", "测试管理员", "ADMIN"],
    ["sales", "测试销售", "SALES"],
    ["sales2", "另一销售", "SALES"],
    ["service", "测试客服", "SERVICE"],
    ["service2", "另一客服", "SERVICE"],
  ]) {
    await db.user.create({ data: { id: username, username, name, role, passwordHash } });
  }
  return { db, dir };
}
