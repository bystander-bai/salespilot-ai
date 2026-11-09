import { END, START, StateGraph } from "@langchain/langgraph";
import type { ChatResponse, EventSink, Source, Step } from "@salespilot/contracts";
import type { Config } from "./config.js";
import type { Gateway } from "./gateway.js";
import { HISTORY_MESSAGE_LIMIT } from "./agent/helpers.js";
import { createAgentNodes } from "./agent/nodes.js";
import { stateDefinition, type Session, type ToolRunner } from "./agent/types.js";

export type { Session, ToolRunner } from "./agent/types.js";
export { resultAnswer } from "./agent/helpers.js";

const GRAPH_RECURSION_LIMIT = 32;

export class SalesAgent {
  constructor(
    private config: Config,
    private tools: ToolRunner,
    private gateway?: Gateway,
  ) {}

  async run(
    message: string,
    sessionId: string,
    runId: string,
    session: Session,
    emit: EventSink,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    const steps: Step[] = [];
    const sources: Source[] = [];
    const send: EventSink = (event) => {
      if (!signal?.aborted) emit(event);
    };
    const nodes = createAgentNodes({
      config: this.config,
      tools: this.tools,
      gateway: this.gateway,
      message,
      sessionId,
      runId,
      session,
      send,
      signal,
      steps,
      sources,
    });

    const graph = new StateGraph(stateDefinition)
      .addNode("routeIntent", nodes.routeIntent)
      .addNode("validateArguments", nodes.validateArguments)
      .addNode("callTool", nodes.callTool)
      .addNode("retry", nodes.retry)
      .addNode("validateToolResult", nodes.validateToolResult)
      .addNode("composeAnswer", nodes.composeAnswer)
      .addEdge(START, "routeIntent")
      .addConditionalEdges("routeIntent", (state) =>
        state.error ? "composeAnswer" : "validateArguments",
      )
      .addConditionalEdges("validateArguments", (state) =>
        !state.plan.tool || state.needsInput ? "composeAnswer" : "callTool",
      )
      .addConditionalEdges("callTool", (state) =>
        state.result ? "validateToolResult" : state.shouldRetry ? "retry" : "composeAnswer",
      )
      .addEdge("retry", "callTool")
      .addConditionalEdges("validateToolResult", (state) =>
        !state.error &&
        this.config.mode === "gateway" &&
        (state.result?.kind === "order" || state.result?.kind === "inventory")
          ? "routeIntent"
          : "composeAnswer",
      )
      .addEdge("composeAnswer", END)
      .compile();

    send({ type: "run.start", data: { runId, mode: this.config.mode } });
    const output = await graph.invoke(
      { plan: { args: {} }, answer: "", retryCount: 0, shouldRetry: false, needsInput: false },
      { signal, recursionLimit: GRAPH_RECURSION_LIMIT },
    );
    const response: ChatResponse = {
      runId,
      mode: this.config.mode,
      answer: output.answer,
      intent: output.plan.tool ?? steps.at(-1)?.name ?? "general",
      steps,
      sources,
      ...(output.result ? { result: output.result } : {}),
      ...(output.error ? { error: output.error } : {}),
    };
    session.history.push(
      { role: "user", content: message },
      { role: "assistant", content: response.answer },
    );
    session.history = session.history.slice(-HISTORY_MESSAGE_LIMIT);
    session.touchedAt = Date.now();
    send({ type: "run.done", data: response });
    return response;
  }
}
