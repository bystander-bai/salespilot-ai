import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { Health } from "@salespilot/contracts";
import type { Config } from "../config.js";

export function registerHealthRoute(app: FastifyInstance, db: PrismaClient, config: Config) {
  app.get("/api/health", async (_request, reply) => {
    let database: Health["database"] = "available";
    try {
      await db.order.count();
    } catch {
      database = "unavailable";
    }
    const body: Health = {
      status: database === "available" && config.mode !== "unconfigured" ? "ok" : "degraded",
      database,
      mode: config.mode,
      modelGateway:
        config.mode === "demo" ? "demo" : config.mode === "gateway" ? "configured" : "unconfigured",
    };
    return reply.status(body.status === "ok" ? 200 : 503).send(body);
  });
}
