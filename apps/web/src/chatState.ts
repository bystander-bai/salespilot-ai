import type { AgentEvent } from "@salespilot/contracts";
import { welcomeMessage } from "./constants";
import type { ExecutionStep, Message } from "./types";

export type ChatState = {
  messages: Message[];
  steps: ExecutionStep[];
  assistantId?: string;
  streamedContent: string;
};

export type ChatAction =
  | { type: "reset" }
  | { type: "start"; requestId: string; assistantId: string; message: string }
  | { type: "event"; event: AgentEvent }
  | { type: "fail"; message: string };

export function initialChatState(): ChatState {
  return {
    messages: [{ id: "welcome", role: "assistant", content: welcomeMessage, runId: "welcome" }],
    steps: [],
    streamedContent: "",
  };
}

function updateAssistant(state: ChatState, patch: Partial<Message>): ChatState {
  return {
    ...state,
    messages: state.messages.map((message) =>
      message.id === state.assistantId ? { ...message, ...patch } : message,
    ),
  };
}

function settleRunningSteps(steps: ExecutionStep[], outcome: "done" | "error") {
  return steps.map((step) => (step.state === "running" ? { ...step, state: outcome } : step));
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "reset":
      return initialChatState();
    case "start":
      return {
        messages: [
          ...state.messages,
          { id: action.requestId, role: "user", content: action.message },
          { id: action.assistantId, role: "assistant", content: "" },
        ],
        assistantId: action.assistantId,
        steps: [],
        streamedContent: "",
      };
    case "event":
      return applyAgentEvent(state, action.event);
    case "fail":
      return {
        ...updateAssistant(state, { content: action.message, error: action.message }),
        steps: [
          ...settleRunningSteps(state.steps, "error"),
          { id: "error", label: "请求失败", detail: action.message, state: "error" },
        ],
      };
  }
}

/** 纯状态转换：一次事件只更新一次状态，流式文本与追问提示分别处理。 */
export function applyAgentEvent(state: ChatState, event: AgentEvent): ChatState {
  switch (event.type) {
    case "run.start":
      return state;
    case "intent":
      return {
        ...state,
        steps: [
          ...state.steps,
          {
            id: `intent-${state.steps.length}`,
            label: `识别意图：${event.data.label}`,
            state: "done",
          },
        ],
      };
    case "arguments":
      return {
        ...state,
        steps: [
          ...state.steps,
          {
            id: `arguments-${state.steps.length}`,
            label: "提取并校验业务参数",
            detail: JSON.stringify(event.data.arguments),
            state: "done",
          },
        ],
      };
    case "clarification":
      return {
        ...updateAssistant(state, { content: event.data.message }),
        steps: [
          ...state.steps,
          {
            id: "clarification",
            label: "需要补充信息",
            detail: event.data.fields.join(","),
            state: "error",
          },
        ],
      };
    case "tool.call":
      return {
        ...state,
        steps: [
          ...settleRunningSteps(state.steps, "done"),
          {
            id: `tool-${state.steps.length}-${event.data.attempt}`,
            label: `调用工具：${event.data.tool}`,
            detail: JSON.stringify(event.data.arguments),
            state: "running",
          },
        ],
      };
    case "tool.result": {
      const data = event.data;
      // 重试会新增工具步骤，只结束最近一次调用，保留上一次失败记录。
      const index = state.steps
        .map((step) => step.id.startsWith("tool-") && step.state === "running")
        .lastIndexOf(true);
      return {
        ...state,
        steps: state.steps.map((step, current) =>
          current === index
            ? {
                ...step,
                state: data.success ? "done" : "error",
                detail: data.success ? "业务数据已返回" : data.error.message,
              }
            : step,
        ),
      };
    }
    case "retry":
      return {
        ...state,
        steps: [
          ...state.steps,
          { id: `retry-${state.steps.length}`, label: "工具响应超时，正在重试", state: "running" },
        ],
      };
    case "message.delta": {
      const content = state.streamedContent + event.data.content;
      return { ...updateAssistant(state, { content }), streamedContent: content };
    }
    case "run.error":
      return {
        ...updateAssistant(state, { content: event.data.message, error: event.data.message }),
        steps: settleRunningSteps(state.steps, "error"),
      };
    case "run.done": {
      const data = event.data;
      if ("failed" in data) return { ...state, steps: settleRunningSteps(state.steps, "error") };
      return {
        ...updateAssistant(state, {
          runId: data.runId,
          result: data.result,
          steps: data.steps,
          content: data.answer,
          error: data.error?.message,
        }),
        steps: settleRunningSteps(state.steps, data.error ? "error" : "done"),
      };
    }
  }
}
