import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { type BusinessResult, type ToolName, toolSchemas, toolNames } from "@salespilot/contracts";
import type { Config } from "./config.js";
import { BusinessError } from "./errors.js";
import type { Conversation } from "./demo.js";

export type HistoryEntry = { role: "user" | "assistant"; content: string };
export type Plan = {
  tool?: ToolName;
  args: Record<string, unknown>;
  text?: string;
  callId?: string;
};
export type ToolExchange = { plan: Plan; result: BusinessResult };
export interface Gateway {
  plan(
    message: string,
    history: HistoryEntry[],
    signal?: AbortSignal,
    exchanges?: ToolExchange[],
    context?: Conversation,
  ): Promise<Plan>;
  answer(
    plan: Plan,
    result: BusinessResult,
    message: string,
    onDelta: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<string>;
}
const descriptions = {
  get_order: "按订单号查询订单状态、客户、商品、预计送达日期。订单号为 SO 开头的数字编号。",
  get_inventory: "查询商品在仓库的可用和预留库存。深圳仓=SZ-01，上海仓=SH-01，北京仓=BJ-01。",
  prepare_after_sales_ticket:
    "用户要求售后时准备申请草稿，不创建工单。type 为 RETURN/REPAIR/EXCHANGE，priority 为 NORMAL/HIGH。需要订单号和具体问题描述；用户必须在页面确认商品与数量并提交。",
  get_tickets: "按工单号或订单号查询售后处理状态。多个匹配时全部展示，不猜测目标。",
};
function assertPublicText(text: string) {
  if (/<\s*\/?\s*(?:[｜|]+\s*)?DSML\b/i.test(text))
    throw new BusinessError("MODEL_GATEWAY_ERROR", "模型返回了未解析的工具调用，请稍后重试", 502);
}

export class OpenAICompatibleGateway implements Gateway {
  private model: ChatOpenAI;
  constructor(config: Config) {
    this.model = new ChatOpenAI({
      apiKey: config.apiKey,
      model: config.model,
      configuration: { baseURL: config.baseURL },
      timeout: config.modelTimeout,
      maxRetries: 0,
      temperature: 0,
      maxTokens: 900,
    });
  }
  async plan(
    message: string,
    history: HistoryEntry[],
    signal?: AbortSignal,
    exchanges: ToolExchange[] = [],
    context?: Conversation,
  ): Promise<Plan> {
    const schemas = {
      ...toolSchemas,
      prepare_after_sales_ticket: toolSchemas.prepare_after_sales_ticket.omit({
        idempotencyKey: true,
      }),
    };
    const model = this.model.bindTools(
      Object.entries(schemas).map(([name, schema]) => ({
        name,
        description: descriptions[name as ToolName],
        schema,
      })),
      { parallel_tool_calls: false },
    );
    const response = await model.invoke(
      [
        new SystemMessage(
          "你是销售订单助手，支持查询订单、库存、售后进度和准备售后草稿。不能直接创建工单、修改状态或分配人员。售后草稿完成后引导用户点击卡片确认商品与数量并提交，不得声称已创建工单。每一步只调用一个工具。必须通过工具查询业务信息，禁止编造或将工具调用写入正文。缺少必要参数用中文追问，不能猜测订单号、商品编码和仓库；售后类型不明确时追问退货、换货或维修。参考会话补全明确提供的字段。任务完成后简短回应，不重复调用已完成工具。不要输出隐藏推理。",
        ),
        new SystemMessage(
          `本会话已确认的业务引用与待补参数：${JSON.stringify({ lastOrderId: context?.lastOrderId, lastSku: context?.lastSku, lastWarehouse: context?.lastWarehouse, pending: context?.pending })}。仅在用户指代前文时参考这些字段。`,
        ),
        ...history.map((h) =>
          h.role === "user" ? new HumanMessage(h.content) : new AIMessage(h.content),
        ),
        new HumanMessage(message),
        ...exchanges.flatMap(({ plan, result }, index) => {
          const id = plan.callId ?? `call_salespilot_${index}`;
          return [
            new AIMessage({
              content: "",
              tool_calls: [{ name: plan.tool!, args: plan.args, id, type: "tool_call" }],
            }),
            new ToolMessage({ content: JSON.stringify(result), tool_call_id: id }),
          ];
        }),
      ],
      { signal },
    );
    if (response.invalid_tool_calls?.length)
      throw new BusinessError("MODEL_GATEWAY_ERROR", "模型返回的工具参数格式无效，请重试", 502);
    if ((response.tool_calls?.length ?? 0) > 1)
      throw new BusinessError("MODEL_GATEWAY_ERROR", "请一次提出一个业务操作", 502);
    const call = response.tool_calls?.[0];
    if (call) {
      if (!toolNames.includes(call.name as ToolName))
        throw new BusinessError("MODEL_GATEWAY_ERROR", "模型返回了不支持的工具", 502);
      return { tool: call.name as ToolName, args: call.args, callId: call.id ?? "call_salespilot" };
    }
    const text =
      typeof response.content === "string"
        ? response.content
        : "请提供订单号或商品编码，以便继续处理。";
    assertPublicText(text);
    return { args: {}, text };
  }
  async answer(
    plan: Plan,
    result: BusinessResult,
    message: string,
    onDelta: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const stream = await this.model.stream(
      [
        new SystemMessage(
          "业务执行阶段已经结束，根据 JSON 简洁回复，只陈述返回数据，不调用工具。kind=ticketDraft 仅为草稿，必须引导点击确认售后申请并选择商品数量，不能声称工单已创建。kind=tickets 展示实际进度；kind=order 仅为查询订单成功。不要声称已退款或批准售后。",
        ),
        new HumanMessage(message),
        // Summarization is a separate text-only request, not another tool turn.
        new HumanMessage(`已执行工具 ${plan.tool}，执行结果 JSON：\n${JSON.stringify(result)}`),
      ],
      { signal },
    );
    let answer = "";
    let pending = "";
    for await (const chunk of stream) {
      if (typeof chunk.content === "string" && chunk.content) {
        pending += chunk.content;
        assertPublicText(pending);
        // Hold unfinished tags to catch protocol markers split across chunks.
        const tag = pending.lastIndexOf("<");
        const boundary = tag >= 0 && !pending.slice(tag).includes(">") ? tag : pending.length;
        const text = pending.slice(0, boundary);
        if (text) {
          answer += text;
          onDelta(text);
        }
        pending = pending.slice(boundary);
      }
    }
    assertPublicText(pending);
    if (pending) {
      if (/^<\s*\/?\s*[｜|]/.test(pending))
        throw new BusinessError("MODEL_GATEWAY_ERROR", "模型回复不完整，请重试", 502);
      answer += pending;
      onDelta(pending);
    }
    return answer;
  }
}
