import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  CreateTicketInput,
  PublicUser,
  TicketActionInput,
  TicketDetail,
  TicketListItem,
} from "@salespilot/contracts";
import { hashText } from "../auth.js";
import { BusinessError } from "../errors.js";

const include = {
  order: { include: { customer: true } },
  assignee: true,
} satisfies Prisma.AfterSalesTicketInclude;
type ListedTicket = Prisma.AfterSalesTicketGetPayload<{ include: typeof include }>;
export function ticketListItem(ticket: ListedTicket): TicketListItem {
  const hours = ticket.priority === "HIGH" ? 8 : 24;
  return {
    ticketId: ticket.id,
    orderId: ticket.orderId,
    customerName: ticket.order.customer.name,
    status: ticket.status,
    type: ticket.type,
    description: ticket.description,
    priority: ticket.priority,
    createdAt: ticket.createdAt.toISOString(),
    estimatedResponseHours: hours,
    createdById: ticket.createdById,
    assigneeId: ticket.assigneeId,
    assigneeName: ticket.assignee?.name ?? null,
    assigneeAvailable:
      !!ticket.assignee?.enabled && ["ADMIN", "SERVICE"].includes(ticket.assignee.role),
    firstResponseAt: ticket.firstResponseAt?.toISOString() ?? null,
    overdue:
      ticket.status === "CREATED" &&
      !ticket.firstResponseAt &&
      Date.now() > ticket.createdAt.getTime() + hours * 3600000,
  };
}
export async function listTickets(db: PrismaClient, where: Prisma.AfterSalesTicketWhereInput = {}) {
  return (
    await db.afterSalesTicket.findMany({
      where,
      include,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    })
  ).map(ticketListItem);
}
export async function getTicket(
  db: PrismaClient,
  id: string,
  actorId: string,
): Promise<TicketDetail> {
  const ticket = await db.afterSalesTicket.findUnique({
    where: { id },
    include: {
      ...include,
      creator: true,
      sourceSession: { select: { ownerId: true } },
      items: true,
      events: { include: { actor: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
  if (!ticket) throw new BusinessError("TICKET_NOT_FOUND", "工单不存在", 404);
  const ids = [
    ...new Set(ticket.events.map((e) => e.assigneeId).filter((id): id is string => !!id)),
  ];
  const names = new Map(
    (await db.user.findMany({ where: { id: { in: ids } } })).map((u) => [u.id, u.name]),
  );
  return {
    ...ticketListItem(ticket),
    version: ticket.version,
    creatorName: ticket.creator?.name ?? null,
    fromChat: ticket.fromChat,
    sourceSessionId: ticket.sourceSession?.ownerId === actorId ? ticket.sourceSessionId : null,
    updatedAt: ticket.updatedAt.toISOString(),
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
    closedAt: ticket.closedAt?.toISOString() ?? null,
    items: ticket.items.map((i) => ({
      orderItemId: i.orderItemId,
      sku: i.sku,
      name: i.name,
      quantity: i.quantity,
    })),
    events: ticket.events.map((e) => ({
      id: e.id,
      action: e.action,
      actorName: e.actor.name,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      note: e.note,
      assigneeName: e.assigneeId ? (names.get(e.assigneeId) ?? "历史负责人") : null,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

export async function createTicket(db: PrismaClient, input: CreateTicketInput, actor: PublicUser) {
  const normalized = {
    ...input,
    items: [...input.items].sort((a, b) => a.orderItemId.localeCompare(b.orderItemId)),
  };
  const payloadHash = hashText(JSON.stringify(normalized));
  const key = `${actor.id}:${input.idempotencyKey}`;
  async function replay() {
    const existing = await db.afterSalesTicket.findUnique({ where: { idempotencyKey: key } });
    if (!existing) return null;
    if (existing.payloadHash !== payloadHash)
      throw new BusinessError(
        "IDEMPOTENCY_CONFLICT",
        "提交编号已用于不同申请，请重新生成申请",
        409,
      );
    return { ticket: await getTicket(db, existing.id, actor.id), duplicate: true };
  }
  const existing = await replay();
  if (existing) return existing;
  try {
    const id = await db.$transaction(async (tx) => {
      if (
        input.sourceSessionId &&
        !(await tx.chatSession.findFirst({
          where: { id: input.sourceSessionId, ownerId: actor.id },
        }))
      )
        throw new BusinessError("SESSION_NOT_FOUND", "来源会话不存在", 404);
      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        include: { items: { include: { product: true } } },
      });
      if (!order) throw new BusinessError("ORDER_NOT_FOUND", "订单不存在", 404);
      if (!["SHIPPED", "DELIVERED"].includes(order.status))
        throw new BusinessError("ORDER_STATUS_INVALID", "只有已发货或已签收订单可以申请售后", 409);
      if (new Set(input.items.map((i) => i.orderItemId)).size !== input.items.length)
        throw new BusinessError("INVALID_ARGUMENT", "同一商品不能重复选择");
      const occupied = await tx.ticketItem.groupBy({
        by: ["orderItemId"],
        where: { ticket: { orderId: order.id, status: { in: ["CREATED", "PROCESSING"] } } },
        _sum: { quantity: true },
      });
      const items = input.items.map((item) => {
        const source = order.items.find((i) => i.id === item.orderItemId);
        if (!source) throw new BusinessError("INVALID_ARGUMENT", "商品不属于该订单");
        const used = occupied.find((i) => i.orderItemId === source.id)?._sum.quantity ?? 0;
        if (item.quantity > source.quantity - used)
          throw new BusinessError(
            "QUANTITY_EXCEEDED",
            `${source.product.name} 可申请数量不足，请刷新订单详情`,
            409,
          );
        return {
          id: randomUUID(),
          orderItemId: source.id,
          sku: source.sku,
          name: source.product.name,
          quantity: item.quantity,
        };
      });
      const id = `AS${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
      await tx.afterSalesTicket.create({
        data: {
          id,
          orderId: order.id,
          type: input.type,
          description: input.description,
          priority: input.priority,
          status: "CREATED",
          idempotencyKey: key,
          payloadHash,
          createdById: actor.id,
          sourceSessionId: input.sourceSessionId,
          fromChat: !!input.sourceSessionId,
          items: { create: items },
          events: {
            create: {
              id: randomUUID(),
              actorId: actor.id,
              requestId: input.idempotencyKey,
              payloadHash,
              action: "CREATE",
              fromStatus: "",
              toStatus: "CREATED",
              note: input.description,
            },
          },
        },
      });
      await tx.operationLog.create({
        data: {
          id: randomUUID(),
          action: "ticket.create",
          requestId: input.idempotencyKey,
          success: true,
          detail: JSON.stringify({ actorId: actor.id, ticketId: id }),
        },
      });
      return id;
    });
    return { ticket: await getTicket(db, id, actor.id), duplicate: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await replay();
      if (duplicate) return duplicate;
    }
    throw error;
  }
}

export async function actOnTicket(
  db: PrismaClient,
  id: string,
  input: TicketActionInput,
  actor: PublicUser,
) {
  const payloadHash = hashText(JSON.stringify({ ticketId: id, ...input }));
  await db.$transaction(async (tx) => {
    const previous = await tx.ticketEvent.findUnique({
      where: { actorId_requestId: { actorId: actor.id, requestId: input.requestId } },
    });
    if (previous) {
      if (previous.payloadHash !== payloadHash)
        throw new BusinessError("IDEMPOTENCY_CONFLICT", "操作编号已用于不同操作", 409);
      return;
    }
    const ticket = await tx.afterSalesTicket.findUnique({ where: { id } });
    if (!ticket) throw new BusinessError("TICKET_NOT_FOUND", "工单不存在", 404);
    if (ticket.version !== input.version)
      throw new BusinessError("VERSION_CONFLICT", "工单已被其他成员更新，请刷新后操作", 409);
    let status = ticket.status;
    let assigneeId = ticket.assigneeId;
    const admin = actor.role === "ADMIN";
    const handler = admin || (actor.role === "SERVICE" && ticket.assigneeId === actor.id);
    const forbidden = () => {
      throw new BusinessError("FORBIDDEN", "没有此工单的操作权限", 403);
    };
    const invalid = () => {
      throw new BusinessError("STATUS_CONFLICT", "当前状态不能执行此操作", 409);
    };
    if (input.action === "CLAIM") {
      if (actor.role === "SALES") forbidden();
      if (status !== "CREATED" || assigneeId) invalid();
      assigneeId = actor.id;
      status = "PROCESSING";
    } else if (input.action === "ASSIGN") {
      if (!admin) forbidden();
      if (!["CREATED", "PROCESSING"].includes(status)) invalid();
      const user = await tx.user.findFirst({
        where: { id: input.assigneeId ?? "", enabled: true, role: { in: ["ADMIN", "SERVICE"] } },
      });
      if (!user) throw new BusinessError("INVALID_ARGUMENT", "请选择有效客服或管理员");
      assigneeId = user.id;
      status = "PROCESSING";
    } else if (input.action === "CANCEL") {
      if (!(admin || (status === "CREATED" && ticket.createdById === actor.id))) forbidden();
      if (!["CREATED", "PROCESSING"].includes(status)) invalid();
      status = "CANCELLED";
    } else {
      if (!handler) forbidden();
      if (input.action === "RESOLVE") {
        if (status !== "PROCESSING") invalid();
        status = "RESOLVED";
      }
      if (input.action === "CLOSE") {
        if (status !== "RESOLVED") invalid();
        status = "CLOSED";
      }
      if (input.action === "NOTE" && !["CREATED", "PROCESSING", "RESOLVED"].includes(status))
        invalid();
    }
    if (["RESOLVE", "CANCEL", "NOTE"].includes(input.action) && !input.note.trim())
      throw new BusinessError("INVALID_ARGUMENT", "请填写处理说明或原因");
    const now = new Date();
    const updated = await tx.afterSalesTicket.updateMany({
      where: { id, version: input.version },
      data: {
        status,
        assigneeId,
        version: { increment: 1 },
        firstResponseAt: !ticket.firstResponseAt && status === "PROCESSING" ? now : undefined,
        resolvedAt: status === "RESOLVED" && ticket.status !== status ? now : undefined,
        closedAt: status === "CLOSED" || status === "CANCELLED" ? now : undefined,
      },
    });
    if (!updated.count) throw new BusinessError("VERSION_CONFLICT", "工单已更新，请刷新", 409);
    await tx.ticketEvent.create({
      data: {
        id: randomUUID(),
        ticketId: id,
        actorId: actor.id,
        requestId: input.requestId,
        payloadHash,
        action: input.action,
        fromStatus: ticket.status,
        toStatus: status,
        note: input.note,
        assigneeId,
      },
    });
    await tx.operationLog.create({
      data: {
        id: randomUUID(),
        action: `ticket.${input.action.toLowerCase()}`,
        requestId: input.requestId,
        success: true,
        detail: JSON.stringify({ actorId: actor.id, ticketId: id }),
      },
    });
  });
  return getTicket(db, id, actor.id);
}
