import { Annotation } from "@langchain/langgraph";
import type {
  ApiError,
  BusinessResult,
  EventSink,
  Source,
  Step,
  ToolName,
} from "@salespilot/contracts";
import type { Config } from "../config.js";
import type { Conversation } from "../demo.js";
import type { Gateway, HistoryEntry, Plan } from "../gateway.js";

export interface ToolRunner {
  execute(
    name: ToolName,
    args: Record<string, unknown>,
    sessionId: string,
    requestId: string,
  ): Promise<BusinessResult>;
}
export type Session = Conversation & { history: HistoryEntry[]; touchedAt: number };

export const stateDefinition = Annotation.Root({
  plan: Annotation<Plan>,
  answer: Annotation<string>,
  result: Annotation<BusinessResult | undefined>,
  error: Annotation<ApiError | undefined>,
  retryCount: Annotation<number>,
  shouldRetry: Annotation<boolean>,
  needsInput: Annotation<boolean>,
});
export type AgentState = typeof stateDefinition.State;
export type NodeUpdate = Partial<AgentState>;
export type RunContext = {
  config: Config;
  tools: ToolRunner;
  gateway?: Gateway;
  message: string;
  sessionId: string;
  runId: string;
  session: Session;
  send: EventSink;
  signal?: AbortSignal;
  steps: Step[];
  sources: Source[];
};
