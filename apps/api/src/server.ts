import { prisma } from "./db.js";
import { createApp } from "./app.js";
import { readConfig } from "./config.js";

const config = readConfig();
const app = createApp(prisma);
const close = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
}
