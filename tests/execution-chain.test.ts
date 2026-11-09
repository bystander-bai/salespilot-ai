import { describe, expect, it } from "vitest";
import type { TraceEvent, BusinessResult } from "@salespilot/contracts";
import { buildExecutionChain } from "../apps/web/src/execution-chain";
import type { Message } from "../apps/web/src/types";
const order: BusinessResult = {
  kind: "order",
  orderId: "SO1",
  status: "SHIPPED",
  customerName: "客户",
  items: [{ sku: "PHONE-001", name: "手机", quantity: 1 }],
  estimatedDelivery: null,
};
const call: TraceEvent = {
  type: "tool.call",
  data: { tool: "get_order", arguments: { orderId: "SO1" }, attempt: 1 },
};
const success: TraceEvent = {
  type: "tool.result",
  data: { tool: "get_order", success: true, result: order },
};
const failure: TraceEvent = {
  type: "tool.result",
  data: {
    tool: "get_order",
    success: false,
    error: { code: "TIMEOUT", message: "调用超时", requestId: "r" },
  },
};
function message(trace: TraceEvent[], extra: Partial<Message> = {}): Message {
  return { id: "a", role: "assistant", content: "回复", trace, ...extra };
}
describe("真实事件归并为业务执行链路", () => {
  it("缺参时不将调用或结果误报为成功", () => {
    const c = buildExecutionChain(
      message([
        { type: "arguments", data: { tool: "get_order", arguments: {} } },
        { type: "clarification", data: { fields: ["orderId"], message: "请补充订单号" } },
      ]),
      false,
    );
    expect(c.status).toBe("waiting");
    expect(c.callStatus).toBe("idle");
    expect(c.resultStatus).toBe("idle");
  });
  it("重试保留首次失败，最终成功", () => {
    const c = buildExecutionChain(
      message(
        [
          call,
          failure,
          { type: "retry", data: { message: "重试" } },
          { ...call, data: { ...call.data, attempt: 2 } },
          success,
        ],
        { result: order },
      ),
      false,
    );
    expect(c.calls.map((x) => x.status)).toEqual(["error", "done"]);
    expect(c.status).toBe("done");
  });
  it("失败与中断不生成成功结论", () => {
    expect(buildExecutionChain(message([call, failure], { error: "调用超时" }), false).status).toBe(
      "error",
    );
    expect(buildExecutionChain(message([call]), false).status).toBe("error");
    const failed = buildExecutionChain(message([call, failure]), false);
    expect(failed.status).toBe("error");
    expect(failed.summary).toBe("调用超时");
  });
  it("仅在实际订单商品与下一次参数匹配时显示依赖", () => {
    const c = buildExecutionChain(
      message([
        call,
        success,
        {
          type: "tool.call",
          data: {
            tool: "get_inventory",
            arguments: { sku: "PHONE-001", warehouse: "深圳仓" },
            attempt: 1,
          },
        },
      ]),
      true,
    );
    expect(c.calls[1].dependency).toContain("PHONE-001");
    expect(c.calls[1].status).toBe("running");
    expect(c.resultStatus).toBe("idle");
  });
  it("草稿准备完成仍等待用户确认", () => {
    const draft: BusinessResult = {
      kind: "ticketDraft",
      orderId: "SO1",
      type: "REPAIR",
      description: "维修",
      priority: "NORMAL",
      idempotencyKey: "key",
    };
    const c = buildExecutionChain(message([call, success], { result: draft }), false);
    expect(c.status).toBe("waiting");
    expect(c.summary).toContain("尚未提交");
  });
  it("无历史链路不补造，工具摘要仅恢复已有部分", () => {
    expect(buildExecutionChain(message([]), false).recorded).toBe(false);
    const c = buildExecutionChain(
      message([], { steps: [{ type: "tool", name: "get_order", success: true }] }),
      false,
    );
    expect(c.calls[0].args).toEqual({});
    expect(c.validation).toContain("未单独记录");
  });
});
