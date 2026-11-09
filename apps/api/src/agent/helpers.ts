import { orderStatusLabels, type BusinessResult, type Source } from "@salespilot/contracts";
import { BusinessError } from "../errors.js";
import type { RunContext } from "./types.js";

const ARGUMENT_LABELS: Record<string, string> = {
  orderId: "订单号（如 SO202611001）",
  sku: "商品编码（如 PHONE-001）",
  warehouse: "仓库（如深圳仓）",
  description: "具体问题描述",
  type: "售后类型（退货、换货或维修）",
  priority: "工单优先级",
  ticketId: "工单号",
};
export const TOOL_LABELS = {
  get_order: "查询订单",
  get_inventory: "查询库存",
  prepare_after_sales_ticket: "准备售后申请",
  get_tickets: "查询售后进度",
};
export const MAX_TOOL_RETRIES = 1;
export const HISTORY_MESSAGE_LIMIT = 12;
const ANSWER_CHUNK_SIZE = 12;

export function clarificationFields(issues: { path: PropertyKey[] }[]) {
  return [
    ...new Set(
      issues.map((issue) =>
        issue.path.length
          ? (ARGUMENT_LABELS[String(issue.path[0])] ?? "有效的业务参数")
          : "订单号或工单号",
      ),
    ),
  ];
}

export function resultAnswer(result: BusinessResult): string {
  if (result.kind === "ticketDraft")
    return `已整理订单 ${result.orderId} 的售后申请草稿。请点击“确认售后申请”，选择商品及数量并确认提交；当前尚未创建工单。`;
  if (result.kind === "tickets")
    return result.tickets.length
      ? `查询到 ${result.tickets.length} 个售后工单，请查看下方处理进度。`
      : "未找到对应售后工单。";
  if (result.kind === "order") {
    const items = result.items.map((item) => `${item.name} × ${item.quantity}`).join("、");
    const delivery = result.estimatedDelivery
      ? `预计送达日期：${result.estimatedDelivery}。`
      : "暂未提供送达日期。";
    return `订单 ${result.orderId} ${orderStatusLabels[result.status] ?? result.status}，包含${items}。${delivery}`;
  }
  if (result.kind === "inventory") {
    return `${result.warehouseName}的${result.productName}（${result.sku}）可用库存 ${result.available} 件，预留库存 ${result.reserved} 件。`;
  }
  return `${result.duplicate ? "已存在相同售后工单，未重复创建" : "已创建售后工单"}：${result.ticketId}。预计 ${result.estimatedResponseHours} 小时内响应；具体处理结果以客服审核为准。`;
}

export function resultSource(result: BusinessResult): Source {
  const reference =
    result.kind === "order"
      ? `orders:${result.orderId}`
      : result.kind === "ticket"
        ? `after_sales_tickets:${result.ticketId}`
        : result.kind === "inventory"
          ? `inventory:${result.sku}:${result.warehouse}`
          : result.kind === "ticketDraft"
            ? `orders:${result.orderId}`
            : `after_sales_tickets:${result.orderId ?? "search"}`;
  return { type: "database", reference };
}

export async function withToolTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new BusinessError("TOOL_TIMEOUT", "业务工具响应超时，请稍后重试", 504, true)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function streamFallbackAnswer(answer: string, send: RunContext["send"]) {
  // 仅模拟文本分段，不暴露模型的隐藏推理。
  const characters = Array.from(answer);
  for (let index = 0; index < characters.length; index += ANSWER_CHUNK_SIZE) {
    send({
      type: "message.delta",
      data: { content: characters.slice(index, index + ANSWER_CHUNK_SIZE).join("") },
    });
  }
}
