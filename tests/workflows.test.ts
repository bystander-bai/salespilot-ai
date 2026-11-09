import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { createApp } from "../apps/api/src/app.js";
import { testConfig, testDatabase, testPassword } from "./fixtures.js";
import type { Gateway } from "../apps/api/src/gateway.js";

let app: FastifyInstance;
let db: PrismaClient;
const cookies: Record<string, string> = {};
function call(
  user: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url: `/api${url}`,
    headers: { cookie: cookies[user] ?? "" },
    ...(payload === undefined ? {} : { payload }),
  });
}
async function session(user = "sales") {
  const response = await call(user, "POST", "/sessions", {});
  expect(response.statusCode).toBe(201);
  return response.json().id as string;
}
async function ticketInput(orderId = "SO202611001") {
  const response = await call("sales", "GET", `/orders/${orderId}`);
  const order = response.json();
  return {
    orderId,
    type: "REPAIR",
    description: "手机无法开机",
    priority: "NORMAL",
    idempotencyKey: randomUUID(),
    items: [{ orderItemId: order.items[0].orderItemId, quantity: 1 }],
  };
}
async function createTicket(orderId = "SO202611001") {
  const response = await call("sales", "POST", "/tickets", await ticketInput(orderId));
  expect(response.statusCode, response.body).toBe(201);
  return response.json().ticket;
}
beforeAll(async () => {
  ({ db } = await testDatabase());
  app = createApp(db, { config: testConfig, logger: false });
  await app.ready();
  for (const user of ["admin", "sales", "sales2", "service", "service2"]) {
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: user, password: testPassword },
    });
    expect(r.statusCode, r.body).toBe(200);
    cookies[user] = String(r.headers["set-cookie"]).split(";")[0];
  }
});
afterAll(async () => {
  await app?.close();
  await db?.$disconnect();
});

describe("来源校验", () => {
  it.each([
    ["localhost:5173", "http://localhost:5173"],
    ["127.0.0.1:5173", "http://127.0.0.1:5173"],
    ["localhost:5174", "http://localhost:5174"],
    ["192.168.1.10:8080", "http://192.168.1.10:8080"],
    ["[::1]:5173", "http://[::1]:5173"],
    ["localhost:80", "http://localhost"],
    ["localhost:3101", testConfig.corsOrigin],
  ])("允许同源代理或配置来源登录并注销：%s / %s", async (host, origin) => {
    const headers = { host, origin, "sec-fetch-site": "same-site" };
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers,
      payload: { username: "admin", password: testPassword },
    });
    expect(login.statusCode, login.body).toBe(200);
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    const me = await app.inject({ url: "/api/auth/me", headers: { host, cookie } });
    expect(me.json().username).toBe("admin");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: { ...headers, cookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect((await app.inject({ url: "/api/auth/me", headers: { host, cookie } })).statusCode).toBe(
      401,
    );
  });
  it.each([
    { origin: "http://localhost:5174" },
    { origin: "https://localhost:5173" },
    { origin: "http://127.0.0.1:5173" },
    { origin: "null" },
    { origin: "https://evil.example", "sec-fetch-site": "same-origin" },
    {
      origin: "https://evil.example",
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
      forwarded: "host=evil.example;proto=https",
    },
    { origin: "http://localhost:5173", "sec-fetch-site": "cross-site" },
    { origin: testConfig.corsOrigin, "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "cross-site" },
  ])("拒绝不同源、伪造转发头或跨站写请求：%j", async (headers) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { host: "localhost:5173", cookie: cookies.sales, ...headers },
      payload: {},
    });
    expect(response.statusCode, response.body).toBe(403);
    expect(response.body).toContain("请求来源不受信任");
  });
});

describe("团队账号及迁移", () => {
  it("保留旧工单，不伪造商品、人员和处理时间", async () => {
    const r = await call("admin", "GET", "/tickets/ASLEGACY");
    expect(r.statusCode).toBe(200);
    const t = r.json();
    expect(t.items).toEqual([]);
    expect(t.createdById).toBeNull();
    expect(t.firstResponseAt).toBeNull();
  });
  it("业务需要登录，健康检查公开，跨站写入被拒绝", async () => {
    expect((await app.inject("/api/orders")).statusCode).toBe(401);
    expect((await app.inject("/api/health")).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/sessions",
          headers: { cookie: cookies.sales, origin: "https://other.example" },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
  });
  it("销售不能管理账号，最后一个管理员不能停用", async () => {
    expect((await call("sales", "GET", "/users")).statusCode).toBe(403);
    expect((await call("admin", "PATCH", "/users/admin", { enabled: false })).statusCode).toBe(409);
    expect((await call("admin", "PATCH", "/users/admin", { role: "SALES" })).statusCode).toBe(409);
  });
  it("管理员创建账号并重置密码；停用和角色更新使旧登录失效", async () => {
    const create = await call("admin", "POST", "/users", {
      username: "temporary",
      name: "临时成员",
      password: testPassword,
      role: "SALES",
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().passwordHash).toBeUndefined();
    const id = create.json().id;
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "temporary", password: testPassword },
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    expect(
      (await call("admin", "PATCH", `/users/${id}`, { password: "Updated-password-2026" }))
        .statusCode,
    ).toBe(200);
    expect((await app.inject({ url: "/api/auth/me", headers: { cookie } })).statusCode).toBe(401);
    expect((await call("admin", "PATCH", `/users/${id}`, { enabled: false })).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { username: "temporary", password: "Updated-password-2026" },
        })
      ).statusCode,
    ).toBe(401);
  });
});
describe("私有会话与可恢复对话", () => {
  it("管理员和其他成员不能读写他人会话，搜索只匹配本人消息", async () => {
    const id = await session();
    await call("sales", "POST", "/chat", {
      sessionId: id,
      message: "私人内容测试",
      requestId: randomUUID(),
    });
    for (const user of ["admin", "sales2"]) {
      expect((await call(user, "GET", `/sessions/${id}/messages`)).statusCode).toBe(404);
      expect(
        (await call(user, "POST", "/chat", { sessionId: id, message: "你好" })).statusCode,
      ).toBe(404);
      expect(
        (await call(user, "GET", `/sessions?q=${encodeURIComponent("私人内容测试")}`)).json().total,
      ).toBe(0);
      expect((await call(user, "DELETE", `/sessions/${id}`)).statusCode).toBe(404);
    }
    expect(
      (await call("sales", "GET", `/sessions?q=${encodeURIComponent("私人内容测试")}`)).json()
        .total,
    ).toBe(1);
  });
  it("相同请求回放且不重复消息，不同内容复用请求号冲突", async () => {
    const id = await session();
    const requestId = randomUUID();
    const a = await call("sales", "POST", "/chat", {
      sessionId: id,
      message: "查询订单 SO202611001",
      requestId,
    });
    expect(a.statusCode, a.body).toBe(200);
    const b = await call("sales", "POST", "/chat", {
      sessionId: id,
      message: "查询订单 SO202611001",
      requestId,
    });
    expect(b.json()).toEqual(a.json());
    expect((await call("sales", "GET", `/sessions/${id}/messages`)).json().total).toBe(2);
    expect(
      (await call("sales", "POST", "/chat", { sessionId: id, message: "另一个问题", requestId }))
        .statusCode,
    ).toBe(409);
  });
  it("缺参数追问在重启后恢复，SSE 结束前已持久化；对话仅产生草稿", async () => {
    const id = await session();
    const pending = await call("sales", "POST", "/chat", { sessionId: id, message: "帮我查库存" });
    expect(pending.json().answer).toContain("补充");
    await app.close();
    app = createApp(db, { config: testConfig, logger: false });
    await app.ready();
    const completed = await call("sales", "POST", "/chat/stream", {
      sessionId: id,
      message: "深圳仓 PHONE-001",
      requestId: randomUUID(),
    });
    expect(completed.body).toContain("event: run.done");
    expect(completed.body).toContain('"kind":"inventory"');
    const messages = (await call("sales", "GET", `/sessions/${id}/messages`)).json();
    expect(messages.total).toBe(4);
    expect(messages.items.at(-1).result.sku).toBe("PHONE-001");
    const count = await db.afterSalesTicket.count();
    const draft = await call("sales", "POST", "/chat", {
      sessionId: id,
      message: "订单 SO202611001 的手机无法开机，帮我申请维修",
    });
    expect(draft.statusCode, draft.body).toBe(200);
    expect(draft.json().result.kind).toBe("ticketDraft");
    expect(await db.afterSalesTicket.count()).toBe(count);
  });
  it("重启将遗留运行标记为中断并恢复展示，原请求不会重跑", async () => {
    const id = await session();
    const requestId = randomUUID();
    const runKey = `sales:${requestId}`;
    const { hashText } = await import("../apps/api/src/auth.js");
    await db.chatRun.create({
      data: {
        id: runKey,
        ownerId: "sales",
        sessionId: id,
        requestId,
        messageHash: hashText("你好"),
        status: "RUNNING",
      },
    });
    await db.chatMessage.create({
      data: { id: `${runKey}:user`, sessionId: id, role: "user", content: "你好" },
    });
    await app.close();
    app = createApp(db, { config: testConfig, logger: false });
    await app.ready();
    const history = (await call("sales", "GET", `/sessions/${id}/messages`)).json();
    expect(history.total).toBe(2);
    expect(history.items[1].error).toContain("中断");
    expect(
      (await call("sales", "POST", "/chat", { sessionId: id, message: "你好", requestId })).json()
        .error.code,
    ).toBe("RUN_INTERRUPTED");
  });
});
describe("售后申请与工单处理", () => {
  it("校验订单状态、商品归属、数量及重复商品", async () => {
    const input = await ticketInput();
    expect(
      (await call("sales", "POST", "/tickets", { ...input, orderId: "SO202611002" })).statusCode,
    ).toBe(409);
    expect(
      (
        await call("sales", "POST", "/tickets", {
          ...input,
          items: [{ orderItemId: "not-in-order", quantity: 1 }],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call("sales", "POST", "/tickets", {
          ...input,
          items: [{ ...input.items[0], quantity: 999 }],
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await call("sales", "POST", "/tickets", {
          ...input,
          items: [{ ...input.items[0], quantity: 0 }],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call("sales", "POST", "/tickets", {
          ...input,
          items: [...input.items, ...input.items],
        })
      ).statusCode,
    ).toBe(400);
  });
  it("跨重启重复提交返回原工单，修改载荷复用幂等键被拒绝，删除来源会话保留业务", async () => {
    const id = await session();
    const input = { ...(await ticketInput()), sourceSessionId: id };
    const a = await call("sales", "POST", "/tickets", input);
    expect(a.statusCode, a.body).toBe(201);
    const t = a.json().ticket;
    expect(
      (await call("sales2", "GET", `/tickets/${t.ticketId}`)).json().sourceSessionId,
    ).toBeNull();
    expect((await call("sales", "GET", `/tickets/${t.ticketId}`)).json().sourceSessionId).toBe(id);
    await app.close();
    app = createApp(db, { config: testConfig, logger: false });
    await app.ready();
    const replay = await call("sales", "POST", "/tickets", input);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().ticket.ticketId).toBe(t.ticketId);
    expect(replay.json().duplicate).toBe(true);
    expect(
      (await call("sales", "POST", "/tickets", { ...input, description: "不同问题" })).statusCode,
    ).toBe(409);
    expect((await call("sales", "DELETE", `/sessions/${id}`)).statusCode).toBe(200);
    const retained = (await call("sales", "GET", `/tickets/${t.ticketId}`)).json();
    expect(retained.fromChat).toBe(true);
    expect(retained.sourceSessionId).toBeNull();
    await call("sales", "POST", `/tickets/${t.ticketId}/actions`, {
      action: "CANCEL",
      version: 0,
      requestId: randomUUID(),
      note: "测试取消",
    });
  });
  it("完整状态流转、角色权限、备注不可篡改及首次响应", async () => {
    const t = await createTicket();
    const path = `/tickets/${t.ticketId}/actions`;
    const action = (user: string, name: string, version: number, note = "") =>
      call(user, "POST", path, { action: name, version, requestId: randomUUID(), note });
    expect((await action("sales", "CLAIM", 0)).statusCode).toBe(403);
    const claim = await action("service", "CLAIM", 0);
    expect(claim.statusCode, claim.body).toBe(200);
    expect(claim.json().firstResponseAt).toBeTruthy();
    expect((await action("service2", "NOTE", 1, "越权备注")).statusCode).toBe(403);
    expect((await action("service", "RESOLVE", 1)).statusCode).toBe(400);
    const note = await action("service", "NOTE", 1, "已联系客户");
    expect(note.statusCode).toBe(200);
    const resolved = await action("service", "RESOLVE", 2, "已完成维修并通知客户");
    expect(resolved.json().status).toBe("RESOLVED");
    const closed = await action("service", "CLOSE", 3);
    expect(closed.json().status).toBe("CLOSED");
    expect(closed.json().events).toHaveLength(5);
    expect((await action("admin", "CLAIM", 4)).statusCode).toBe(409);
    expect(
      (await call("admin", "PATCH", `/tickets/${t.ticketId}`, { status: "CREATED" })).statusCode,
    ).toBe(404);
  });
  it("有效申请占用数量，取消后释放；竞争领取只有一个成功", async () => {
    const input = await ticketInput();
    const order = (await call("sales", "GET", "/orders/SO202611001")).json();
    input.items[0].quantity = order.items[0].availableForAfterSales;
    const created = await call("sales", "POST", "/tickets", input);
    expect(created.statusCode, created.body).toBe(201);
    const t = created.json().ticket;
    expect(
      (
        await call("sales", "POST", "/tickets", {
          ...input,
          idempotencyKey: randomUUID(),
          items: [{ ...input.items[0], quantity: 1 }],
        })
      ).statusCode,
    ).toBe(409);
    const result = await Promise.all(
      ["service", "service2"].map((user) =>
        call(user, "POST", `/tickets/${t.ticketId}/actions`, {
          action: "CLAIM",
          version: 0,
          requestId: randomUUID(),
          note: "",
        }),
      ),
    );
    expect(result.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(result.filter((r) => r.statusCode === 409)).toHaveLength(1);
    const cancelled = await call("admin", "POST", `/tickets/${t.ticketId}/actions`, {
      action: "CANCEL",
      version: 1,
      requestId: randomUUID(),
      note: "管理员取消",
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(
      (await call("sales", "GET", "/orders/SO202611001")).json().items[0].availableForAfterSales,
    ).toBe(order.items[0].quantity);
  });
  it("分配和转派校验负责人；操作可回放，超时工单只作提示", async () => {
    const t = await createTicket();
    const path = `/tickets/${t.ticketId}/actions`;
    expect(
      (
        await call("admin", "POST", path, {
          action: "ASSIGN",
          version: 0,
          requestId: randomUUID(),
          assigneeId: "sales",
        })
      ).statusCode,
    ).toBe(400);
    const body = { action: "ASSIGN", version: 0, requestId: randomUUID(), assigneeId: "service" };
    expect((await call("admin", "POST", path, body)).json().status).toBe("PROCESSING");
    expect((await call("admin", "POST", path, body)).statusCode).toBe(200);
    expect(
      (await call("admin", "POST", path, { ...body, assigneeId: "service2" })).statusCode,
    ).toBe(409);
    const transfer = await call("admin", "POST", path, {
      action: "ASSIGN",
      version: 1,
      requestId: randomUUID(),
      assigneeId: "service2",
    });
    expect(transfer.json().assigneeId).toBe("service2");
    expect(
      (
        await call("service", "POST", path, {
          action: "NOTE",
          version: 2,
          requestId: randomUUID(),
          note: "旧负责人",
        })
      ).statusCode,
    ).toBe(403);
    await call("admin", "POST", path, {
      action: "CANCEL",
      version: 2,
      requestId: randomUUID(),
      note: "测试结束",
    });
    const legacy = (await call("sales", "GET", "/tickets/ASLEGACY")).json();
    expect(legacy.overdue).toBe(false);
    await db.afterSalesTicket.update({
      where: { id: "ASLEGACY" },
      data: { createdAt: new Date(Date.now() - 48 * 3600000) },
    });
    expect((await call("sales", "GET", "/tickets/ASLEGACY")).json().overdue).toBe(true);
  });
  it("库存对比只返回指定商品，工单可通过对话查询", async () => {
    const stocks = (await call("sales", "GET", "/inventory?sku=PHONE-001")).json();
    expect(stocks).toHaveLength(3);
    expect(stocks.every((i: { sku: string }) => i.sku === "PHONE-001")).toBe(true);
    const id = await session();
    const lookup = await call("sales", "POST", "/chat", {
      sessionId: id,
      message: "查询订单 SO202611001 的售后进度",
    });
    expect(lookup.json().result.kind).toBe("tickets");
    expect(lookup.json().result.tickets.length).toBeGreaterThan(0);
  });
  it("多商品校验失败时整体回滚，不留下工单或创建日志", async () => {
    const input = await ticketInput();
    const before = await db.afterSalesTicket.count();
    const logs = await db.operationLog.count({ where: { action: "ticket.create" } });
    const response = await call("sales", "POST", "/tickets", {
      ...input,
      items: [...input.items, { orderItemId: "invalid-item", quantity: 1 }],
    });
    expect(response.statusCode).toBe(400);
    expect(await db.afterSalesTicket.count()).toBe(before);
    expect(await db.operationLog.count({ where: { action: "ticket.create" } })).toBe(logs);
  });
  it("并发申请不能超出可申请数量", async () => {
    const input = await ticketInput();
    const order = (await call("sales", "GET", "/orders/SO202611001")).json();
    input.items[0].quantity = order.items[0].availableForAfterSales;
    const responses = await Promise.all(
      [input, { ...input, idempotencyKey: randomUUID() }].map((body) =>
        call("sales", "POST", "/tickets", body),
      ),
    );
    expect(responses.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.statusCode === 409)).toHaveLength(1);
    const ticket = responses.find((r) => r.statusCode === 201)!.json().ticket;
    await call("sales", "POST", `/tickets/${ticket.ticketId}/actions`, {
      action: "CANCEL",
      version: 0,
      requestId: randomUUID(),
      note: "结束并发测试",
    });
  });
});
describe("模型网关及并发", () => {
  it("gateway 多步查询后只准备草稿，并发会话请求与删除受到保护", async () => {
    await app.close();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((r) => (entered = r));
    const barrier = new Promise<void>((r) => (release = r));
    const gateway: Gateway = {
      async plan(_message, _history, _signal, exchanges = []) {
        if (!exchanges.length) {
          entered();
          await barrier;
          return { tool: "get_order", args: { orderId: "SO202611001" } };
        }
        return {
          tool: "prepare_after_sales_ticket",
          args: {
            orderId: "SO202611001",
            type: "REPAIR",
            description: "手机故障",
            priority: "NORMAL",
          },
        };
      },
      async answer(_plan, result, _message, onDelta) {
        const answer =
          result.kind === "ticketDraft" ? "请确认售后申请，尚未创建工单。" : "订单已查询";
        onDelta(answer);
        return answer;
      },
    };
    app = createApp(db, { config: { ...testConfig, mode: "gateway" }, gateway, logger: false });
    await app.ready();
    const id = await session();
    const before = await db.afterSalesTicket.count();
    const active = call("sales", "POST", "/chat/stream", {
      sessionId: id,
      message: "查询订单并申请维修",
      requestId: randomUUID(),
    });
    // light-my-request starts execution when awaited/then is attached.
    const pending = Promise.resolve(active);
    await started;
    expect(
      (await call("sales", "POST", "/chat", { sessionId: id, message: "另一个请求" })).statusCode,
    ).toBe(409);
    expect((await call("sales", "DELETE", `/sessions/${id}`)).statusCode).toBe(409);
    release();
    const result = await pending;
    expect(result.body).toContain('"kind":"ticketDraft"');
    expect(await db.afterSalesTicket.count()).toBe(before);
    await app.close();
    app = createApp(db, { config: testConfig, logger: false });
    await app.ready();
  });
  it("真实 SSE 断连会中断模型请求并持久化可恢复的中断记录", async () => {
    await app.close();
    const gateway: Gateway = {
      async plan(_m, _h, signal) {
        await new Promise<void>((_resolve, reject) => {
          if (signal?.aborted) reject(new Error("aborted"));
          else
            signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
        return { args: {}, text: "不会执行到这里" };
      },
      async answer() {
        return "";
      },
    };
    app = createApp(db, { config: { ...testConfig, mode: "gateway" }, gateway, logger: false });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("missing address");
    const id = await session();
    const requestId = randomUUID();
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: cookies.sales },
      body: JSON.stringify({ sessionId: id, message: "你好", requestId }),
      signal: controller.signal,
    });
    await response.body!.getReader().read();
    controller.abort();
    await expect
      .poll(
        async () => (await db.chatRun.findUnique({ where: { id: `sales:${requestId}` } }))?.status,
      )
      .toBe("INTERRUPTED");
    const history = (await call("sales", "GET", `/sessions/${id}/messages`)).json();
    expect(history.items.at(-1).error).toContain("中断");
    expect(history.running).toBe(false);
    await app.close();
    app = createApp(db, { config: testConfig, logger: false });
    await app.ready();
  });
});
