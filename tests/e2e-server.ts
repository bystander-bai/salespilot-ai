import { createApp } from "../apps/api/src/app.js";
import { testConfig, testDatabase } from "./fixtures.js";

async function main() {
  const { db } = await testDatabase();
  // Keep the default allowlist while the browser uses 127.0.0.1:4173 through Vite.
  // This catches same-origin proxy regressions hidden by an exact allowlist match.
  const app = createApp(db, {
    config: { ...testConfig, corsOrigin: "http://localhost:5173" },
    logger: false,
  });
  await app.listen({ host: "127.0.0.1", port: 3101 });
  console.log("E2E fixture API ready on 3101 (isolated database)");
  async function close() {
    await app.close();
    await db.$disconnect();
    process.exit(0);
  }
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}
void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
