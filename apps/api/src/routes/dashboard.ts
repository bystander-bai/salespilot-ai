import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { DashboardResponse } from "@salespilot/contracts";

export function registerDashboardRoute(app: FastifyInstance, db: PrismaClient) {
  app.get("/api/dashboard", async () => {
    const [orders, tickets, inventory, logs, inventoryCount] = await Promise.all([
      db.order.count(),
      db.afterSalesTicket.count(),
      db.inventory.findMany({
        include: { product: true, site: true },
        orderBy: [{ available: "asc" }, { sku: "asc" }, { warehouse: "asc" }],
      }),
      db.operationLog.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
      db.inventory.count(),
    ]);
    const response: DashboardResponse = {
      orders,
      tickets,
      inventoryCount,
      inventory: inventory.map((item) => ({
        sku: item.sku,
        name: item.product.name,
        warehouse: item.site.name,
        available: item.available,
      })),
      activity: logs.map((log) => ({
        id: log.id,
        action: log.action,
        success: log.success,
        createdAt: log.createdAt.toISOString(),
      })),
    };
    return response;
  });
}
