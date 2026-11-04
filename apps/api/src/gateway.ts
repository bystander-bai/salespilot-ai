import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { type BusinessResult, type ToolName, toolSchemas, toolNames } from "@salespilot/contracts";
import type { Config } from "./config.js";
import { BusinessError } from "./errors.js";

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
  create_after_sales_ticket:
    "用户明确要求创建售后、退货、换货或维修申请时创建工单。type 为 RETURN/REPAIR/EXCHANGE，priority 为 NORMAL/HIGH。需要订单号和具体问题描述。",
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
  ): Promise<Plan> {
    const schemas = {
      ...toolSchemas,
      create_after_sales_ticket: toolSchemas.create_after_sales_ticket.omit({
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
          "你是销售订单助手。仅支持查询订单、查询库存和创建售后工单。每一步只调用一个工具，收到查询结果后继续完成用户原始请求；用户要求创建售后时，查询订单不代表已创建工单。必须使用提供的工具定义和参数，禁止将工具调用写入正文。业务信息必须通过工具查询，不能编造。缺少必要参数请用中文追问，不能猜测订单号、商品编码和仓库；售后类型不明确时追问退货、换货或维修。参考会话补全用户明确提供的字段。任务完成后简短回应，不要重复调用已完成的工具。普通问候简短回应。超出业务范围时说明支持的功能。不要输出隐藏推理或声称已执行尚未调用的工具。",
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
          "业务执行阶段已经结束。根据提供的执行结果 JSON 用中文简洁回复，不再调用工具，也不输出工具调用标记。只陈述已返回的数据，不补充未知信息。kind=order 只表示查询订单成功，不代表创建售后成功。duplicate=true 表示已存在相同工单，应说明未重复创建。不要声称已退款或批准售后。",
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
