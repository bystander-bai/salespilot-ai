import type { ChatResponse } from "@salespilot/contracts";
import type { Session } from "./agent.js";
import { BusinessError } from "./errors.js";

export const SESSION_TTL_MS = 60 * 60 * 1000;
export const MAX_SESSIONS = 1000;
export const MAX_RESPONSES = 1000;

type CachedResponse = { message: string; response: ChatResponse; created: number };
type SessionRequest = {
  session: Session;
  cached?: ChatResponse;
  remember: (response: ChatResponse) => void;
  release: () => void;
};

export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly responses = new Map<string, CachedResponse>();
  private readonly busySessions = new Set<string>();

  constructor(private readonly clock: () => number = Date.now) {}

  acquire(sessionId: string, runId: string, message: string): SessionRequest {
    const now = this.clock();
    this.cleanup(now);
    const cacheKey = `${sessionId}:${runId}`;
    const cached = this.responses.get(cacheKey);
    if (cached && cached.message !== message) {
      throw new BusinessError(
        "IDEMPOTENCY_CONFLICT",
        "requestId 已用于不同问题，请生成新的请求编号",
        409,
      );
    }
    if (this.busySessions.has(sessionId)) {
      throw new BusinessError("SESSION_BUSY", "上一条请求仍在处理中，请稍后再试", 409);
    }
    if (this.sessions.size >= MAX_SESSIONS && !this.sessions.has(sessionId)) {
      throw new BusinessError("SERVICE_BUSY", "演示服务繁忙，请稍后重试", 503);
    }
    const session = this.sessions.get(sessionId) ?? { history: [], touchedAt: now };
    this.sessions.set(sessionId, session);
    this.busySessions.add(sessionId);
    let released = false;

    return {
      session,
      cached: cached?.response,
      remember: (response) => {
        // 失败允许重试；成功结果回放时跳过 Agent，避免再次执行业务写入。
        if (!released && !response.error) {
          this.cacheResponse(cacheKey, { message, response, created: this.clock() });
        }
      },
      release: () => {
        // 释放只生效一次，防止旧请求清理时误解除后续请求的并发锁。
        if (released) return;
        released = true;
        session.touchedAt = this.clock();
        this.busySessions.delete(sessionId);
      },
    };
  }

  private cacheResponse(key: string, value: CachedResponse) {
    if (!this.responses.has(key) && this.responses.size >= MAX_RESPONSES) {
      this.responses.delete(this.responses.keys().next().value!);
    }
    this.responses.set(key, value);
  }

  private cleanup(now: number) {
    for (const [key, session] of this.sessions) {
      if (now - session.touchedAt > SESSION_TTL_MS && !this.busySessions.has(key))
        this.sessions.delete(key);
    }
    for (const [key, response] of this.responses) {
      if (now - response.created > SESSION_TTL_MS) this.responses.delete(key);
    }
  }
}
