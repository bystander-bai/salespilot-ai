import { createHash, randomUUID } from "node:crypto";
import { Prisma, type AfterSalesTicket, type PrismaClient } from "@prisma/client";
import type { TicketArguments, TicketResult } from "@salespilot/contracts";
import { BusinessError } from "../errors.js";

const TRANSACTION_TIMEOUT_MS = 4000;
const ALLOWED_ORDER_STATUSES = ["SHIPPED", "DELIVERED"];
const RESPONSE_HOURS = { HIGH: 8, NORMAL: 24 };

function idempotencyKey(args: TicketArguments, sessionId: string) {
  // 服务端生成稳定的键，模型重试和用户重复提交都不会重复写入工单。
  return (
    args.idempotencyKey ??
    createHash("sha256")
      .update(
        JSON.stringify([
          sessionId,
          args.orderId,
          args.type,
          args.description.trim().replace(/\s+/g, " "),
          args.priority,
        ]),
      )
      .digest("hex")
  );
}

function ticketResult(ticket: AfterSalesTicket, duplicate: boolean): TicketResult {
  return {
    kind: "ticket",
    ticketId: ticket.id,
    orderId: ticket.orderId,
    status: ticket.status,
    type: ticket.type,
    description: ticket.description,
    estimatedResponseHours:
      ticket.priority === "HIGH" ? RESPONSE_HOURS.HIGH : RESPONSE_HOURS.NORMAL,
    duplicate,
  };
}

async function replayTicket(db: PrismaClient, key: string, args: TicketArguments) {
  const existing = await db.afterSalesTicket.findUnique({ where: { idempotencyKey: key } });
  if (!existing) return null;
  if (
    existing.orderId !== args.orderId ||
    existing.type !== args.type ||
    existing.description !== args.description ||
    existing.priority !== args.priority
  ) {
    throw new BusinessError("IDEMPOTENCY_CONFLICT", "幂等键已用于另一项售后申请，请勿复用", 409);
  }
  return ticketResult(existing, true);
}

export async function createTicket(
  db: PrismaClient,
  args: TicketArguments,
  sessionId: string,
): Promise<TicketResult> {
  const key = idempotencyKey(args, sessionId);
  const existing = await replayTicket(db, key, args);
  if (existing) return existing;
  try {
    return await db.$transaction(
      async (tx) => {
        const order = await tx.order.findUnique({ where: { id: args.orderId } });
        if (!order) throw new BusinessError("ORDER_NOT_FOUND", "未找到对应订单，请核对订单号", 404);
        if (!ALLOWED_ORDER_STATUSES.includes(order.status)) {
          throw new BusinessError(
            "ORDER_STATUS_INVALID",
            "只有已发货或已签收的订单可以申请售后",
            409,
          );
        }
        const ticket = await tx.afterSalesTicket.create({
          data: {
            id: `AS${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
            orderId: args.orderId,
            type: args.type,
            description: args.description,
            priority: args.priority,
            status: "CREATED",
            idempotencyKey: key,
          },
        });
        return ticketResult(ticket, false);
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
  } catch (error) {
    // 并发请求可能同时通过首次查询，唯一约束命中后读取已创建工单。
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await replayTicket(db, key, args);
      if (duplicate) return duplicate;
    }
    throw error;
  }
}
