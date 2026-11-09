import {
  orderStatusLabels,
  ticketStatusLabels,
  toolLabels,
  type BusinessResult,
  type TraceEvent,
  type ToolName,
} from "@salespilot/contracts";
import type { Message } from "./types";
export type ChainStatus = "done" | "running" | "waiting" | "error" | "idle" | "skipped";
export type ChainCall = {
  tool: string;
  args: Record<string, unknown>;
  status: ChainStatus;
  summary: string;
  result?: BusinessResult;
  dependency?: string;
  attempt: number;
};
const fieldNames: Record<string, string> = {
  orderId: "订单号",
  ticketId: "工单号",
  sku: "商品编号",
  warehouse: "仓库",
  warehouseName: "仓库",
  type: "售后类型",
  description: "问题描述",
  priority: "优先级",
};
export function readableArguments(args: Record<string, unknown>) {
  return (
    Object.entries(args)
      .filter(([key, value]) => key in fieldNames && value !== undefined && value !== null)
      .map(([key, value]) => `${fieldNames[key]}：${String(value)}`)
      .join(" · ") || "该次执行未记录关键参数"
  );
}
export function resultSummary(result: BusinessResult): string {
  switch (result.kind) {
    case "order":
      return `订单 ${result.orderId} ${orderStatusLabels[result.status] ?? result.status}${result.estimatedDelivery ? `，预计 ${result.estimatedDelivery} 送达` : "，暂无预计送达日期"}。`;
    case "inventory":
      return `${result.warehouseName} ${result.productName}：可用 ${result.available} 件，预留 ${result.reserved} 件。`;
    case "ticketDraft":
      return `订单 ${result.orderId} 的售后草稿已准备，尚未提交。`;
    case "ticket":
      return `工单 ${result.ticketId}：${ticketStatusLabels[result.status] ?? result.status}。`;
    case "tickets":
      return result.tickets.length
        ? result.tickets
            .map((t) => `${t.ticketId}：${ticketStatusLabels[t.status] ?? t.status}`)
            .join("；")
        : "未找到匹配的售后工单。";
  }
}
export function buildExecutionChain(message: Message, loading: boolean) {
  const trace = message.trace ?? [];
  const calls: ChainCall[] = [];
  let intent = "",
    args: Record<string, unknown> = {},
    clarification = "",
    failure = message.error ?? "";
  let lastArgumentsIndex = -1,
    lastCallIndex = -1;
  trace.forEach((event: TraceEvent, index) => {
    switch (event.type) {
      case "intent":
        intent = event.data.label;
        break;
      case "arguments":
        args = event.data.arguments;
        lastArgumentsIndex = index;
        break;
      case "clarification":
        clarification = event.data.message;
        break;
      case "tool.call": {
        clarification = "";
        lastCallIndex = index;
        const previous = calls.at(-1)?.result;
        const sku = event.data.arguments.sku;
        const dependency =
          previous?.kind === "order" &&
          typeof sku === "string" &&
          previous.items.some((item) => item.sku === sku)
            ? `根据上一步订单返回的商品编号 ${sku}，继续查询。`
            : undefined;
        calls.push({
          tool: event.data.tool,
          args: event.data.arguments,
          status: "running",
          summary: "正在等待业务数据返回…",
          attempt: event.data.attempt,
          dependency,
        });
        break;
      }
      case "tool.result": {
        const call = [...calls]
          .reverse()
          .find((c) => c.tool === event.data.tool && c.status === "running");
        if (call) {
          call.status = event.data.success ? "done" : "error";
          call.summary = event.data.success
            ? resultSummary(event.data.result)
            : event.data.error.message;
          if (event.data.success) call.result = event.data.result;
        }
        break;
      }
      case "run.error":
        failure = event.data.message;
        break;
    }
  });
  if (!trace.length && message.steps?.length)
    for (const step of message.steps)
      calls.push({
        tool: step.name,
        args: {},
        status: step.success ? "done" : "error",
        summary: step.success
          ? "历史记录显示工具调用成功，未记录返回详情"
          : "历史记录显示工具调用失败",
        attempt: 1,
      });
  const recorded = !!trace.length || !!message.steps?.length;
  const failed =
    !!failure ||
    (!loading && (calls.some((c) => c.status === "running") || calls.at(-1)?.status === "error"));
  if (!failure && failed && calls.at(-1)?.status === "error") failure = calls.at(-1)!.summary;
  if (!loading)
    calls.forEach((c) => {
      if (c.status === "running") {
        c.status = "error";
        c.summary = "调用中断，未记录完成结果";
      }
    });
  const status: ChainStatus = failed
    ? "error"
    : clarification || message.result?.kind === "ticketDraft"
      ? "waiting"
      : loading
        ? "running"
        : "done";
  const thought: ChainStatus = clarification
    ? "waiting"
    : intent || calls.length
      ? "done"
      : loading
        ? "running"
        : recorded
          ? "done"
          : "idle";
  const callStatus: ChainStatus = calls.length
    ? calls.some((c) => c.status === "running")
      ? "running"
      : failed || calls.at(-1)?.status === "error"
        ? "error"
        : "done"
    : clarification || failed
      ? "idle"
      : loading
        ? "idle"
        : recorded
          ? "skipped"
          : "idle";
  const resultStatus: ChainStatus = failed
    ? "error"
    : clarification
      ? "idle"
      : loading
        ? "idle"
        : "done";
  return {
    recorded,
    status,
    thought,
    callStatus,
    resultStatus,
    calls,
    intent,
    args,
    clarification,
    failure,
    validation: clarification
      ? clarification
      : lastCallIndex >= lastArgumentsIndex && lastCallIndex >= 0
        ? "关键参数已进入实际工具调用"
        : lastArgumentsIndex >= 0
          ? "已提取参数，尚未确认通过校验"
          : "该次执行未单独记录参数校验",
    summary: failed
      ? failure || "执行中断，请重新发送需求"
      : clarification ||
        (message.result ? resultSummary(message.result) : message.content || "尚未产生结果"),
  };
}
export function toolLabel(tool: string) {
  return toolLabels[tool as ToolName] ?? tool;
}
