import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { toolSchemas, type BusinessResult, type ToolName } from "@salespilot/contracts";
import { parseInput } from "./auth.js";
import { BusinessError } from "./errors.js";
import { getInventory } from "./tools/inventory.js";
import { getOrder } from "./tools/order.js";
import { listTickets } from "./tools/ticket.js";

export class BusinessTools {
  constructor(private readonly db: PrismaClient) {}
  async execute(
    name: ToolName,
    args: Record<string, unknown>,
    sessionId: string,
    requestId: string,
  ): Promise<BusinessResult> {
    const session = await this.db.chatSession.findUnique({
      where: { id: sessionId },
      include: { owner: true },
    });
    if (!session?.owner.enabled) throw new BusinessError("UNAUTHORIZED", "会话账号已失效", 401);
    try {
      let result: BusinessResult;
      switch (name) {
        case "get_order":
          result = await getOrder(this.db, parseInput(toolSchemas.get_order, args));
          break;
        case "get_inventory":
          result = await getInventory(this.db, parseInput(toolSchemas.get_inventory, args));
          break;
        case "prepare_after_sales_ticket": {
          const input = parseInput(toolSchemas.prepare_after_sales_ticket, args);
          const order = await getOrder(this.db, { orderId: input.orderId });
          if (!["SHIPPED", "DELIVERED"].includes(order.status))
            throw new BusinessError(
              "ORDER_STATUS_INVALID",
              "只有已发货或已签收订单可以申请售后",
              409,
            );
          result = { ...input, kind: "ticketDraft", idempotencyKey: randomUUID() };
          break;
        }
        case "get_tickets": {
          const input = parseInput(toolSchemas.get_tickets, args);
          result = {
            kind: "tickets",
            orderId: input.orderId,
            tickets: await listTickets(this.db, {
              ...(input.orderId ? { orderId: input.orderId } : {}),
              ...(input.ticketId ? { id: input.ticketId } : {}),
            }),
          };
          break;
        }
      }
      await this.db.operationLog.create({
        data: { id: randomUUID(), action: name, requestId, success: true },
      });
      return result;
    } catch (error) {
      await this.db.operationLog
        .create({
          data: {
            id: randomUUID(),
            action: name,
            requestId,
            success: false,
            detail: error instanceof BusinessError ? error.code : "INTERNAL_ERROR",
          },
        })
        .catch(() => undefined);
      throw error;
    }
  }
}
