import type { FastifyInstance } from "fastify";
import { BusinessError, normalizeError } from "./errors.js";
import { Prisma } from "@prisma/client";

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (["P2002", "P2034", "P2028", "P1008"].includes(error.code))
        return reply.status(409).send({
          code: "DATA_CONFLICT",
          message: "数据已存在或正在被其他操作更新，请刷新后重试",
          requestId: request.id,
        });
    }
    const statusCode =
      error &&
      typeof error === "object" &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    const body =
      statusCode === 400 && !(error instanceof BusinessError)
        ? {
            code: "INVALID_ARGUMENT",
            message: "请求格式不正确，请发送有效 JSON",
            requestId: request.id,
          }
        : normalizeError(error, request.id);
    reply.status(error instanceof BusinessError ? error.status : statusCode).send(body);
  });
}
