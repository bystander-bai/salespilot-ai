import type { FastifyInstance } from "fastify";
import { BusinessError, normalizeError } from "./errors.js";

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
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
