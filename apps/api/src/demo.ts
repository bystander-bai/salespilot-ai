import type { ToolName } from "@salespilot/contracts";
import type { Plan } from "./gateway.js";

export type Conversation = {
  pending?: Plan;
  lastOrderId?: string;
  lastSku?: string;
  lastWarehouse?: string;
};

/** Deterministic demo router. This is deliberately separate from the real model integration. */
export function demoPlan(message: string, context: Conversation): Plan {
  let tool: ToolName | undefined;
  if (
    /AS[A-Z0-9]+/i.test(message) ||
    (/(售后|工单)/.test(message) &&
      /查|进度|怎么样|处理|状态/.test(message) &&
      !/创建|申请|帮我.*退货|帮我.*维修/.test(message))
  )
    tool = "get_tickets";
  else if (/售后|工单|退货|换货|维修/.test(message)) tool = "prepare_after_sales_ticket";
  else if (/库存|仓库|仓|SKU|还有多少/i.test(message)) tool = "get_inventory";
  else if (/订单|SO\d/i.test(message))
    tool =
      context.pending?.tool === "prepare_after_sales_ticket" ||
      context.pending?.tool === "get_tickets"
        ? context.pending.tool
        : "get_order";
  else tool = context.pending?.tool;
  if (!tool)
    return {
      args: {},
      text: /你好|您好|hello|hi\b/i.test(message)
        ? "你好，我是 SalesPilot。可以帮你查订单、查库存，或创建售后工单。"
        : "我目前支持查询订单、查询库存和创建售后工单。请提供具体需求，一次处理一项业务。",
    };
  const args = context.pending?.tool === tool ? { ...context.pending.args } : {};
  const ticket = message.match(/AS[A-Z0-9]+/i)?.[0]?.toUpperCase();
  if (tool === "get_tickets" && ticket) args.ticketId = ticket;
  const order = message.match(/SO\d+/i)?.[0]?.toUpperCase();
  const sku = message.match(/\b(?!SO\d|SZ-|SH-|BJ-)([A-Z][A-Z0-9]*-\d+)\b/i)?.[0]?.toUpperCase();
  const warehouse =
    message.match(/\b(?:SZ|SH|BJ)-\d+\b/i)?.[0]?.toUpperCase() ??
    (/深圳/.test(message)
      ? "SZ-01"
      : /上海/.test(message)
        ? "SH-01"
        : /北京/.test(message)
          ? "BJ-01"
          : undefined);
  if (tool !== "get_inventory") {
    if (order) args.orderId = order;
    else if (!ticket && /这个|该订单|刚才|上个/.test(message) && context.lastOrderId)
      args.orderId = context.lastOrderId;
  } else {
    if (sku && !/^(SZ|SH|BJ)-/.test(sku)) args.sku = sku;
    if (warehouse) args.warehouse = warehouse;
    if (!sku && /这个|刚才|该商品/.test(message) && context.lastSku) args.sku = context.lastSku;
  }
  if (tool === "prepare_after_sales_ticket") {
    if (/换货/.test(message)) args.type = "EXCHANGE";
    else if (/退货/.test(message)) args.type = "RETURN";
    else if (/维修/.test(message)) args.type = "REPAIR";
    args.priority = /紧急|加急/.test(message) ? "HIGH" : (args.priority ?? "NORMAL");
    const problem = message.match(
      /(?:无法开机|不能开机|屏幕破损|质量问题|损坏|故障|不满意|漏发|少件|无法充电|耳机无声|收到错货)[^，。！？]*/,
    )?.[0];
    const explicit = message.match(/(?:问题[是为：:]|原因[是为：:])(.+)/)?.[1];
    if (problem || explicit) args.description = (problem ?? explicit)!.trim();
    else if (
      context.pending?.tool === tool &&
      !args.description &&
      !order &&
      !/^(退货|换货|维修|普通|紧急|加急|高优先级)$/.test(message.trim()) &&
      message.trim().length >= 2
    )
      args.description = message.trim();
  }
  return { tool, args };
}
