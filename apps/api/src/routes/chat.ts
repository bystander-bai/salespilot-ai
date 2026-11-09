import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { chatSchema, type AgentEvent, type TraceEvent } from "@salespilot/contracts";
import type { SalesAgent } from "../agent.js";
import { BusinessError, errorStatus, normalizeError } from "../errors.js";
import type { SessionStore } from "../session-store.js";
import { SseConnection } from "../sse.js";

type ChatRouteContext = { request: FastifyRequest; reply: FastifyReply; stream: boolean };

export function registerChatRoutes(app: FastifyInstance, agent: SalesAgent, store: SessionStore) {
  app.post("/api/chat", (request, reply) =>
    handleChat({ request, reply, stream: false }, agent, store),
  );
  app.post("/api/chat/stream", (request, reply) =>
    handleChat({ request, reply, stream: true }, agent, store),
  );
}

async function handleChat(
  { request, reply, stream }: ChatRouteContext,
  agent: SalesAgent,
  store: SessionStore,
) {
  const parsed = chatSchema.safeParse(request.body);
  if (!parsed.success)
    throw new BusinessError(
      "INVALID_ARGUMENT",
      parsed.error.issues.map((issue) => issue.message).join("；"),
    );
  const { sessionId, message, requestId } = parsed.data;
  const runId = requestId ?? randomUUID();
  const sessionRequest = await store.acquire(sessionId, request.actor.id, runId, message);
  const { cached, session } = sessionRequest;
  const connection = stream ? new SseConnection(reply.raw) : undefined;
  const trace: TraceEvent[] = [];
  // Final results are sent only after the database commit.
  const emit = (event: AgentEvent) => {
    if (event.type !== "run.start" && event.type !== "run.done" && event.type !== "message.delta")
      trace.push(event);
    if (event.type !== "run.done") connection?.send(event);
  };

  try {
    if (connection) {
      reply.hijack();
      connection.open();
    }
    if (cached) {
      if (stream) {
        connection?.replay(cached);
      } else return reply.send(cached);
    } else {
      const response = await agent.run(
        message,
        sessionId,
        runId,
        session!,
        emit,
        connection?.signal,
      );
      response.trace = trace;
      await sessionRequest.remember(response);
      connection?.send({ type: "run.done", data: response });
      if (!stream)
        return reply.status(response.error ? errorStatus(response.error.code) : 200).send(response);
    }
  } catch (error) {
    if (!connection?.signal.aborted) {
      if (stream) {
        emit({ type: "run.error", data: normalizeError(error, runId) });
        connection?.send({ type: "run.done", data: { runId, failed: true } });
      } else throw error;
    }
  } finally {
    try {
      await sessionRequest.release();
    } finally {
      connection?.close();
    }
  }
}
