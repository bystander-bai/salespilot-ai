import type { PrismaClient } from "@prisma/client";
import type { ChatResponse } from "@salespilot/contracts";
import type { Session } from "./agent.js";
import { hashText } from "./auth.js";
import { BusinessError } from "./errors.js";

export class SessionStore {
  private readonly busy = new Set<string>();
  constructor(private readonly db: PrismaClient) {}
  isBusy(id: string) {
    return this.busy.has(id);
  }
  async own(id: string, ownerId: string) {
    const session = await this.db.chatSession.findFirst({ where: { id, ownerId } });
    if (!session) throw new BusinessError("SESSION_NOT_FOUND", "会话不存在", 404);
    return session;
  }
  async recover() {
    const runs = await this.db.chatRun.findMany({ where: { status: "RUNNING" } });
    for (const run of runs) await this.interrupt(run.id, run.sessionId, run.requestId);
  }
  private async interrupt(id: string, sessionId: string | null, requestId: string) {
    const response: ChatResponse = {
      runId: requestId,
      mode: "demo",
      answer: "本次请求已中断，请重新发送。",
      intent: "general",
      steps: [],
      sources: [],
      error: { code: "RUN_INTERRUPTED", message: "本次请求已中断，请重新发送。", requestId },
    };
    await this.db.$transaction(async (tx) => {
      await tx.chatRun.update({
        where: { id },
        data: { status: "INTERRUPTED", response: JSON.stringify(response) },
      });
      const user = await tx.chatMessage.findUnique({ where: { id: `${id}:user` } });
      if (sessionId)
        await tx.chatMessage.upsert({
          where: { id: `${id}:assistant` },
          create: {
            id: `${id}:assistant`,
            sessionId,
            role: "assistant",
            content: response.answer,
            createdAt: new Date(Math.max(Date.now(), (user?.createdAt.getTime() ?? 0) + 1)),
            snapshot: JSON.stringify({ version: 1, response }),
          },
          update: {},
        });
    });
  }
  async acquire(sessionId: string, ownerId: string, runId: string, message: string) {
    await this.own(sessionId, ownerId);
    if (this.busy.has(sessionId))
      throw new BusinessError("SESSION_BUSY", "上一条请求仍在处理中，请稍后刷新", 409);
    this.busy.add(sessionId);
    const id = `${ownerId}:${runId}`;
    try {
      const previous = await this.db.chatRun.findUnique({ where: { id } });
      if (previous) {
        if (previous.sessionId !== sessionId || previous.messageHash !== hashText(message))
          throw new BusinessError("IDEMPOTENCY_CONFLICT", "请求编号已用于其他问题", 409);
        if (!previous.response) throw new BusinessError("SESSION_BUSY", "请求仍在处理中", 409);
        return {
          cached: JSON.parse(previous.response) as ChatResponse,
          session: undefined,
          remember: async (_: ChatResponse) => {},
          release: async () => {
            this.busy.delete(sessionId);
          },
        };
      }
      const record = await this.own(sessionId, ownerId);
      const completedRuns = await this.db.chatRun.findMany({
        where: { sessionId, status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: { id: true },
      });
      const messages = await this.db.chatMessage.findMany({
        where: {
          sessionId,
          id: { in: completedRuns.flatMap((r) => [`${r.id}:user`, `${r.id}:assistant`]) },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 12,
      });
      const parsed = JSON.parse(record.context);
      const session: Session = {
        ...(parsed.version === 1 ? parsed : {}),
        history: messages
          .reverse()
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        touchedAt: Date.now(),
      };
      await this.db.$transaction(async (tx) => {
        const running = await tx.chatRun.count({ where: { sessionId, status: "RUNNING" } });
        if (running) throw new BusinessError("SESSION_BUSY", "上一条请求仍在处理中", 409);
        await tx.chatRun.create({
          data: {
            id,
            requestId: runId,
            ownerId,
            sessionId,
            messageHash: hashText(message),
            status: "RUNNING",
          },
        });
        const latest = await tx.chatMessage.findFirst({
          where: { sessionId },
          orderBy: { createdAt: "desc" },
        });
        await tx.chatMessage.create({
          data: {
            id: `${id}:user`,
            sessionId,
            role: "user",
            content: message,
            createdAt: new Date(Math.max(Date.now(), (latest?.createdAt.getTime() ?? 0) + 1)),
          },
        });
        await tx.chatSession.update({
          where: { id: sessionId },
          data: {
            title:
              (await tx.chatMessage.count({ where: { sessionId } })) === 1 &&
              record.title === "新会话"
                ? Array.from(message).slice(0, 24).join("")
                : undefined,
            updatedAt: new Date(),
          },
        });
      });
      let completed = false;
      return {
        session,
        cached: undefined,
        remember: async (response: ChatResponse) => {
          const { history: _history, touchedAt: _touched, ...context } = session;
          await this.db.$transaction(async (tx) => {
            await tx.chatRun.update({
              where: { id },
              data: { status: "COMPLETED", response: JSON.stringify(response) },
            });
            const user = await tx.chatMessage.findUniqueOrThrow({ where: { id: `${id}:user` } });
            await tx.chatMessage.create({
              data: {
                id: `${id}:assistant`,
                sessionId,
                role: "assistant",
                content: response.answer,
                createdAt: new Date(Math.max(Date.now(), user.createdAt.getTime() + 1)),
                snapshot: JSON.stringify({ version: 1, response }),
              },
            });
            await tx.chatSession.update({
              where: { id: sessionId },
              data: { context: JSON.stringify({ version: 1, ...context }), updatedAt: new Date() },
            });
          });
          completed = true;
        },
        release: async () => {
          try {
            if (!completed) await this.interrupt(id, sessionId, runId);
          } finally {
            this.busy.delete(sessionId);
          }
        },
      };
    } catch (error) {
      this.busy.delete(sessionId);
      throw error;
    }
  }
}
