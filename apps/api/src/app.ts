import Fastify from "fastify";
import cors from "@fastify/cors";
import type { PrismaClient } from "@prisma/client";
import { SalesAgent, type ToolRunner } from "./agent.js";
import { readConfig, type Config } from "./config.js";
import { registerErrorHandler } from "./error-handler.js";
import { OpenAICompatibleGateway, type Gateway } from "./gateway.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerBusinessRoutes } from "./routes/business.js";
import { registerDashboardRoute } from "./routes/dashboard.js";
import { registerHealthRoute } from "./routes/health.js";
import { SessionStore } from "./session-store.js";
import { BusinessTools } from "./tools.js";

const REQUEST_BODY_LIMIT_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;
type AppOptions = { config?: Config; gateway?: Gateway; tools?: ToolRunner; logger?: boolean };

export function createApp(db: PrismaClient, options: AppOptions = {}) {
  const config = options.config ?? readConfig();
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: REQUEST_BODY_LIMIT_BYTES,
    requestTimeout: REQUEST_TIMEOUT_MS,
  });
  const store = new SessionStore();
  const agent = new SalesAgent(
    config,
    options.tools ?? new BusinessTools(db),
    options.gateway ??
      (config.mode === "gateway" ? new OpenAICompatibleGateway(config) : undefined),
  );

  app.register(cors, { origin: config.corsOrigin.split(",").map((origin) => origin.trim()) });
  registerErrorHandler(app);
  registerHealthRoute(app, db, config);
  registerDashboardRoute(app, db);
  registerBusinessRoutes(app, db);
  registerChatRoutes(app, agent, store);
  return app;
}
