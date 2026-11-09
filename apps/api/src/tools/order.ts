import type { PrismaClient } from "@prisma/client";
import type { OrderArguments, OrderResult } from "@salespilot/contracts";
import { BusinessError } from "../errors.js";

export async function getOrder(db: PrismaClient, args: OrderArguments): Promise<OrderResult> {
  const order = await db.order.findUnique({
    where: { id: args.orderId },
    include: { customer: true, items: { include: { product: true } } },
  });
  if (!order) throw new BusinessError("ORDER_NOT_FOUND", "未找到对应订单，请核对订单号", 404);
  const occupied = await db.ticketItem.groupBy({
    by: ["orderItemId"],
    where: { ticket: { orderId: order.id, status: { in: ["CREATED", "PROCESSING"] } } },
    _sum: { quantity: true },
  });
  return {
    kind: "order",
    orderId: order.id,
    status: order.status,
    customerName: order.customer.name,
    items: order.items.map((item) => ({
      orderItemId: item.id,
      availableForAfterSales: Math.max(
        0,
        item.quantity - (occupied.find((i) => i.orderItemId === item.id)?._sum.quantity ?? 0),
      ),
      sku: item.sku,
      name: item.product.name,
      quantity: item.quantity,
    })),
    estimatedDelivery: order.estimatedDelivery?.toISOString().slice(0, 10) ?? null,
  };
}
