import { businessResultSchema, toolSchemas } from "@salespilot/contracts";
import { demoPlan } from "../demo.js";
import { BusinessError, normalizeError } from "../errors.js";
import type { ToolExchange } from "../gateway.js";
import {
  clarificationFields,
  MAX_TOOL_RETRIES,
  resultAnswer,
  resultSource,
  streamFallbackAnswer,
  TOOL_LABELS,
  withToolTimeout,
} from "./helpers.js";
import type { AgentState, NodeUpdate, RunContext } from "./types.js";

const MAX_TOOL_CALLS = 3;

export function createAgentNodes(context: RunContext) {
  const {
    config,
    gateway,
    message,
    session,
    sessionId,
    runId,
    signal,
    send,
    tools,
    steps,
    sources,
  } = context;
  const exchanges: ToolExchange[] = [];

  async function routeIntent(): Promise<NodeUpdate> {
    try {
      if (config.mode === "unconfigured") {
        throw new BusinessError(
          "MODEL_GATEWAY_ERROR",
          "网关模式尚未配置完整，请设置地址、密钥和模型名称，或切换为演示模式",
          503,
        );
      }
      const plan =
        config.mode === "demo"
          ? demoPlan(message, session)
          : await gateway!.plan(message, session.history, signal, exchanges);
      if (plan.tool && exchanges.length >= MAX_TOOL_CALLS) {
        throw new BusinessError(
          "MODEL_GATEWAY_ERROR",
          "模型未能在限定步骤内完成请求，请明确具体业务需求后重试",
          502,
        );
      }
      send({
        type: "intent",
        data: {
          intent: plan.tool ?? "general",
          label: plan.tool ? TOOL_LABELS[plan.tool] : "对话与引导",
        },
      });
      return { plan, retryCount: 0, shouldRetry: false, needsInput: false, answer: "" };
    } catch (error) {
      const failure =
        error instanceof BusinessError
          ? error
          : new BusinessError(
              "MODEL_GATEWAY_ERROR",
              "模型网关暂时不可用，请检查配置或稍后重试",
              502,
            );
      return { error: normalizeError(failure, runId) };
    }
  }

  async function validateArguments(state: AgentState): Promise<NodeUpdate> {
    if (!state.plan.tool) return { answer: state.plan.text ?? "请提供业务需求。" };
    const validated = toolSchemas[state.plan.tool].safeParse(state.plan.args);
    send({ type: "arguments", data: { tool: state.plan.tool, arguments: state.plan.args } });
    if (!validated.success) {
      session.pending = state.plan;
      const fields = clarificationFields(validated.error.issues);
      const answer = `请补充或核对${fields.join("、")}，我会继续处理。`;
      send({ type: "clarification", data: { fields, message: answer } });
      return { needsInput: true, answer };
    }
    // A previous lookup must not masquerade as the next tool's result on failure.
    return { plan: { ...state.plan, args: validated.data }, result: undefined };
  }

  async function callTool(state: AgentState): Promise<NodeUpdate> {
    const { tool, args } = state.plan;
    if (!tool) throw new Error("工具节点缺少工具名称");
    send({ type: "tool.call", data: { tool, arguments: args, attempt: state.retryCount + 1 } });
    try {
      signal?.throwIfAborted();
      const result = await withToolTimeout(
        () => tools.execute(tool, args, sessionId, runId),
        config.toolTimeout,
      );
      send({ type: "tool.result", data: { tool, success: true, result } });
      steps.push({ type: "tool", name: tool, success: true });
      return { result, error: undefined, shouldRetry: false };
    } catch (failure) {
      const error = normalizeError(failure, runId);
      send({ type: "tool.result", data: { tool, success: false, error } });
      // 仅重试可恢复的工具错误；业务校验失败与客户端断连不触发第二次调用。
      const shouldRetry =
        failure instanceof BusinessError &&
        failure.retryable &&
        state.retryCount < MAX_TOOL_RETRIES &&
        !signal?.aborted;
      if (shouldRetry) {
        return { retryCount: state.retryCount + 1, error, shouldRetry };
      }
      steps.push({ type: "tool", name: tool, success: false });
      return { error, shouldRetry };
    }
  }

  async function retry(): Promise<NodeUpdate> {
    send({ type: "retry", data: { message: "暂时未收到工具响应，正在重试一次" } });
    return {};
  }

  async function validateToolResult(state: AgentState): Promise<NodeUpdate> {
    const validated = businessResultSchema.safeParse(state.result);
    if (!validated.success) {
      return {
        result: undefined,
        error: {
          code: "INVALID_TOOL_RESULT",
          message: "业务工具返回的数据不完整，请稍后重试",
          requestId: runId,
        },
      };
    }
    const result = validated.data;
    exchanges.push({ plan: state.plan, result });
    session.pending = undefined;
    if (result.kind === "inventory") {
      session.lastSku = result.sku;
      session.lastWarehouse = result.warehouse;
    } else session.lastOrderId = result.orderId;
    sources.push(resultSource(result));
    return {};
  }

  async function composeAnswer(state: AgentState): Promise<NodeUpdate> {
    let answer = state.answer;
    if (state.error) {
      answer = state.error.message;
      send({ type: "run.error", data: state.error });
    } else if (state.result && !state.needsInput && !state.plan.text) {
      answer = resultAnswer(state.result);
      if (config.mode === "gateway" && gateway) {
        let streamed = "";
        try {
          const generated = await gateway.answer(
            exchanges.at(-1)!.plan,
            state.result,
            message,
            (token) => {
              streamed += token;
              send({ type: "message.delta", data: { content: token } });
            },
            signal,
          );
          if (generated) return { answer: generated };
        } catch {
          // 业务写入已经完成，回复生成失败时只补充文本，绝不重新执行售后创建。
          if (streamed) {
            send({ type: "message.delta", data: { content: `\n${answer}` } });
            return { answer: `${streamed}\n${answer}` };
          }
        }
      }
    }
    streamFallbackAnswer(answer ?? "请稍后重试。", send);
    return { answer };
  }

  return { routeIntent, validateArguments, callTool, retry, validateToolResult, composeAnswer };
}
