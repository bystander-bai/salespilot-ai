import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const apiDirectory = fileURLToPath(new URL("../", import.meta.url));
dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });
process.env.DATABASE_URL ??= "file:./dev.db";
// Initialize a missing SQLite file before asking the migration engine to inspect
// it. Some Windows Prisma engine versions otherwise fail with no useful error.
const db = new PrismaClient();
try {
  await db.$queryRawUnsafe("SELECT 1");
} finally {
  await db.$disconnect();
}
const cli = createRequire(import.meta.url).resolve("prisma/build/index.js");
const result = spawnSync(process.execPath, [cli, "migrate", "deploy"], {
  cwd: apiDirectory,
  stdio: "inherit",
  env: process.env,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
