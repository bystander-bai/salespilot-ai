import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient, User } from "@prisma/client";
import { z } from "zod";
import { roles, type PublicUser } from "@salespilot/contracts";
import type { Config } from "./config.js";
import { BusinessError } from "./errors.js";

const scrypt = promisify(scryptCallback);
const COOKIE = "salespilot_auth";
const MAX_AGE = 8 * 60 * 60;
const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_-]{3,40}$/, "账号需为 3–40 位字母、数字、下划线或短横线");
export const passwordSchema = z.string().min(10, "密码至少 10 位").max(128, "密码最多 128 位");
export const userCreateSchema = z
  .object({
    username: usernameSchema,
    name: z.string().trim().min(1).max(60),
    password: passwordSchema,
    role: z.enum(roles),
  })
  .strict();
export const hashText = (text: string) => createHash("sha256").update(text).digest("hex");
export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BusinessError(
      "INVALID_ARGUMENT",
      result.error.issues.map((i) => i.message).join("；"),
    );
  return result.data;
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}
async function verifyPassword(password: string, stored: string) {
  const [salt, hex] = stored.split(":");
  const expected = Buffer.from(hex, "hex");
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function publicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role as PublicUser["role"],
    enabled: user.enabled,
  };
}
declare module "fastify" {
  interface FastifyRequest {
    actor: PublicUser;
  }
}
export function requireAdmin(request: FastifyRequest) {
  if (request.actor.role !== "ADMIN")
    throw new BusinessError("FORBIDDEN", "仅管理员可执行此操作", 403);
}

function isSameOrigin(request: FastifyRequest, origin: string) {
  if (!request.headers.host) return false;
  try {
    // Proxies must preserve the browser's Host, including its port. Do not trust
    // client-supplied X-Forwarded-Host or X-Forwarded-Proto for this comparison.
    return origin === new URL(`${request.protocol}://${request.headers.host}`).origin;
  } catch {
    return false;
  }
}

export function registerAuth(app: FastifyInstance, db: PrismaClient, config: Config) {
  const attempts = new Map<string, { count: number; until: number }>();
  const allowedOrigins = new Set(config.corsOrigin.split(",").map((v) => v.trim()));
  const secure = process.env.COOKIE_SECURE === "true";
  const cookie = (token: string, age: number) =>
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? "; Secure" : ""}`;
  app.decorateRequest("actor", null as unknown as PublicUser);
  app.addHook("onRequest", async (request) => {
    const path = request.url.split("?")[0];
    if (!path.startsWith("/api/") || request.method === "OPTIONS") return;
    if (!["GET", "HEAD"].includes(request.method)) {
      const origin = request.headers.origin;
      if (
        request.headers["sec-fetch-site"] === "cross-site" ||
        (origin && !allowedOrigins.has(origin) && !isSameOrigin(request, origin))
      ) {
        throw new BusinessError("FORBIDDEN", "请求来源不受信任", 403);
      }
    }
    if (path === "/api/health" || (path === "/api/auth/login" && request.method === "POST")) return;
    const token = request.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      throw new BusinessError("UNAUTHORIZED", "请先登录", 401);
    const login = await db.loginSession.findUnique({
      where: { tokenHash: hashText(token) },
      include: { user: true },
    });
    if (!login || login.expiresAt.getTime() <= Date.now() || !login.user.enabled)
      throw new BusinessError("UNAUTHORIZED", "登录已失效，请重新登录", 401);
    request.actor = publicUser(login.user);
  });

  app.post("/api/auth/login", async (request, reply) => {
    const now = Date.now();
    for (const [ip, entry] of attempts) if (entry.until < now) attempts.delete(ip);
    const entry = attempts.get(request.ip) ?? { count: 0, until: now + 15 * 60_000 };
    if (entry.count >= 30) throw new BusinessError("RATE_LIMITED", "登录尝试过多，请稍后再试", 429);
    entry.count++;
    attempts.set(request.ip, entry);
    const input = parseInput(
      z.object({ username: usernameSchema, password: z.string().min(1).max(128) }).strict(),
      request.body,
    );
    const user = await db.user.findUnique({ where: { username: input.username } });
    // A fixed salt keeps unknown-user verification comparable without storing a default password.
    const valid = await verifyPassword(
      input.password,
      user?.passwordHash ?? `${"0".repeat(32)}:${"0".repeat(128)}`,
    );
    if (!user?.enabled || !valid)
      throw new BusinessError("UNAUTHORIZED", "账号或密码错误，或账号已停用", 401);
    const token = randomBytes(32).toString("hex");
    await db.loginSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await db.loginSession.create({
      data: {
        tokenHash: hashText(token),
        userId: user.id,
        expiresAt: new Date(now + MAX_AGE * 1000),
      },
    });
    reply.header("Set-Cookie", cookie(token, MAX_AGE));
    return publicUser(user);
  });
  app.get("/api/auth/me", async (request) => request.actor);
  app.post("/api/auth/logout", async (request, reply) => {
    const token =
      request.headers.cookie
        ?.split(";")
        .map((v) => v.trim())
        .find((v) => v.startsWith(`${COOKIE}=`))
        ?.slice(COOKIE.length + 1) ?? "";
    await db.loginSession.deleteMany({ where: { tokenHash: hashText(token) } });
    reply.header("Set-Cookie", cookie("", 0));
    return { success: true };
  });
  app.get("/api/users/assignees", async () =>
    (
      await db.user.findMany({
        where: { enabled: true, role: { in: ["ADMIN", "SERVICE"] } },
        orderBy: { name: "asc" },
      })
    ).map(publicUser),
  );
  app.get("/api/users", async (request) => {
    requireAdmin(request);
    return (await db.user.findMany({ orderBy: { createdAt: "asc" } })).map(publicUser);
  });
  app.post("/api/users", async (request, reply) => {
    requireAdmin(request);
    const input = parseInput(userCreateSchema, request.body);
    const passwordHash = await hashPassword(input.password);
    const user = await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          id: randomUUID(),
          username: input.username,
          name: input.name,
          role: input.role,
          passwordHash,
        },
      });
      await tx.operationLog.create({
        data: {
          id: randomUUID(),
          action: "user.create",
          requestId: request.id,
          success: true,
          detail: JSON.stringify({ actorId: request.actor.id, userId: created.id }),
        },
      });
      return created;
    });
    return reply.status(201).send(publicUser(user));
  });
  app.patch<{ Params: { id: string } }>("/api/users/:id", async (request) => {
    requireAdmin(request);
    const input = parseInput(
      z
        .object({
          name: z.string().trim().min(1).max(60).optional(),
          role: z.enum(roles).optional(),
          enabled: z.boolean().optional(),
          password: passwordSchema.optional(),
        })
        .strict(),
      request.body,
    );
    const passwordHash = input.password ? await hashPassword(input.password) : undefined;
    return db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: request.params.id } });
      if (!user) throw new BusinessError("USER_NOT_FOUND", "账号不存在", 404);
      if (
        user.role === "ADMIN" &&
        user.enabled &&
        (input.enabled === false || (input.role && input.role !== "ADMIN")) &&
        (await tx.user.count({ where: { enabled: true, role: "ADMIN" } })) <= 1
      )
        throw new BusinessError("LAST_ADMIN", "至少保留一个有效管理员", 409);
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { name: input.name, role: input.role, enabled: input.enabled, passwordHash },
      });
      if (input.password || input.role || input.enabled !== undefined)
        await tx.loginSession.deleteMany({ where: { userId: user.id } });
      await tx.operationLog.create({
        data: {
          id: randomUUID(),
          action: "user.update",
          requestId: request.id,
          success: true,
          detail: JSON.stringify({ actorId: request.actor.id, userId: user.id }),
        },
      });
      return publicUser(updated);
    });
  });
}
