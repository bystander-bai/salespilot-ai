import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { BusinessLists } from "@salespilot/contracts";

export function registerBusinessRoutes(app: FastifyInstance, db: PrismaClient) {
  app.get("/api/orders", async (): Promise<BusinessLists["orders"]> => {
    const orders = await db.order.findMany({
      include: { customer: true, items: { include: { product: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    return orders.map((order) => ({
      orderId: order.id,
      customerName: order.customer.name,
      status: order.status,
      items: order.items.map((item) => ({
        sku: item.sku,
        name: item.product.name,
        quantity: item.quantity,
      })),
      estimatedDelivery: order.estimatedDelivery?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
    }));
  });

  app.get("/api/inventory", async (): Promise<BusinessLists["inventory"]> => {
    const inventory = await db.inventory.findMany({
      include: { product: true, site: true },
      orderBy: [{ sku: "asc" }, { warehouse: "asc" }],
    });
    return inventory.map((item) => ({
      sku: item.sku,
      productName: item.product.name,
      warehouse: item.warehouse,
      warehouseName: item.site.name,
      available: item.available,
      reserved: item.reserved,
      updatedAt: item.updatedAt.toISOString(),
    }));
  });

  app.get("/api/tickets", async (): Promise<BusinessLists["tickets"]> => {
    const tickets = await db.afterSalesTicket.findMany({
      include: { order: { include: { customer: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    return tickets.map((ticket) => ({
      ticketId: ticket.id,
      orderId: ticket.orderId,
      customerName: ticket.order.customer.name,
      type: ticket.type,
      description: ticket.description,
      status: ticket.status,
      priority: ticket.priority,
      estimatedResponseHours: ticket.priority === "HIGH" ? 8 : 24,
      createdAt: ticket.createdAt.toISOString(),
    }));
  });
}
