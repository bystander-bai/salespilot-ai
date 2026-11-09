import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { createTicketSchema, ticketActionSchema, type BusinessLists } from "@salespilot/contracts";
import { z } from "zod";
import { parseInput } from "../auth.js";
import { getOrder } from "../tools/order.js";
import { actOnTicket, createTicket, getTicket, listTickets } from "../tools/ticket.js";

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

  app.get("/api/inventory", async (request): Promise<BusinessLists["inventory"]> => {
    const query = parseInput(
      z.object({ sku: z.string().trim().max(64).optional() }),
      request.query,
    );
    const inventory = await db.inventory.findMany({
      where: query.sku ? { sku: query.sku } : {},
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

  app.get("/api/tickets", async (request) => {
    const q = parseInput(
      z.object({
        scope: z.enum(["all", "mine", "unassigned", "assigned"]).default("all"),
        status: z.string().max(30).optional(),
        priority: z.enum(["NORMAL", "HIGH"]).optional(),
        assigneeId: z.string().max(100).optional(),
      }),
      request.query,
    );
    return listTickets(db, {
      ...(q.scope === "mine"
        ? { createdById: request.actor.id }
        : q.scope === "unassigned"
          ? { assigneeId: null, status: "CREATED" }
          : q.scope === "assigned"
            ? { assigneeId: request.actor.id }
            : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.priority ? { priority: q.priority } : {}),
      ...(q.assigneeId ? { assigneeId: q.assigneeId } : {}),
    });
  });
  app.get<{ Params: { id: string } }>("/api/orders/:id", (request) =>
    getOrder(db, { orderId: request.params.id }),
  );
  app.get<{ Params: { id: string } }>("/api/orders/:id/tickets", (request) =>
    listTickets(db, { orderId: request.params.id }),
  );
  app.get<{ Params: { id: string } }>("/api/tickets/:id", (request) =>
    getTicket(db, request.params.id, request.actor.id),
  );
  app.post("/api/tickets", async (request, reply) => {
    const result = await createTicket(
      db,
      parseInput(createTicketSchema, request.body),
      request.actor,
    );
    return reply.status(result.duplicate ? 200 : 201).send(result);
  });
  app.post<{ Params: { id: string } }>("/api/tickets/:id/actions", (request) =>
    actOnTicket(db, request.params.id, parseInput(ticketActionSchema, request.body), request.actor),
  );
}
