import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { ChatResponse, StoredMessage } from "@salespilot/contracts";
import { parseInput } from "../auth.js";
import type { SessionStore } from "../session-store.js";
import { BusinessError } from "../errors.js";

const paging = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  q: z.string().trim().max(200).default(""),
});
export function registerSessionRoutes(app: FastifyInstance, db: PrismaClient, store: SessionStore) {
  app.post("/api/sessions", async (request, reply) => {
    const s = await db.chatSession.create({
      data: { id: randomUUID(), ownerId: request.actor.id },
    });
    return reply.status(201).send({ ...s, context: undefined, ownerId: undefined, running: false });
  });
  app.get("/api/sessions", async (request) => {
    const { page, pageSize, q } = parseInput(paging, request.query);
    const where = {
      ownerId: request.actor.id,
      ...(q
        ? { OR: [{ title: { contains: q } }, { messages: { some: { content: { contains: q } } } }] }
        : {}),
    };
    const [items, total] = await db.$transaction([
      db.chatSession.findMany({
        where,
        select: { id: true, title: true, createdAt: true, updatedAt: true },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.chatSession.count({ where }),
    ]);
    return {
      items: items.map((s) => ({ ...s, running: store.isBusy(s.id) })),
      total,
      page,
      pageSize,
    };
  });
  app.get<{ Params: { id: string } }>("/api/sessions/:id/messages", async (request) => {
    const s = await store.own(request.params.id, request.actor.id);
    const { page, pageSize } = parseInput(paging, request.query);
    const [rows, total] = await db.$transaction([
      db.chatMessage.findMany({
        where: { sessionId: s.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.chatMessage.count({ where: { sessionId: s.id } }),
    ]);
    const items: StoredMessage[] = rows.map((m) => {
      const snapshot = m.snapshot ? JSON.parse(m.snapshot) : null;
      const r = snapshot?.version === 1 ? (snapshot.response as ChatResponse) : undefined;
      return {
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        createdAt: m.createdAt.toISOString(),
        result: r?.result,
        steps: r?.steps,
        runId: r?.runId,
        error: r?.error?.message,
        trace: r?.trace,
      };
    });
    return { items, total, page, pageSize, running: store.isBusy(s.id), title: s.title };
  });
  app.patch<{ Params: { id: string } }>("/api/sessions/:id", async (request) => {
    await store.own(request.params.id, request.actor.id);
    const { title } = parseInput(
      z.object({ title: z.string().trim().min(1).max(100) }).strict(),
      request.body,
    );
    return db.chatSession.update({
      where: { id: request.params.id },
      data: { title, updatedAt: new Date() },
      select: { id: true, title: true, updatedAt: true },
    });
  });
  app.delete<{ Params: { id: string } }>("/api/sessions/:id", async (request) => {
    await store.own(request.params.id, request.actor.id);
    if (store.isBusy(request.params.id))
      throw new BusinessError("SESSION_BUSY", "运行中的会话暂不能删除", 409);
    await db.$transaction(async (tx) => {
      await tx.chatRun.updateMany({
        where: { sessionId: request.params.id },
        data: { response: null },
      });
      await tx.chatSession.delete({ where: { id: request.params.id } });
    });
    return { success: true };
  });
}
