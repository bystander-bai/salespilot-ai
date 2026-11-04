import type { ApiError } from "@salespilot/contracts";
export class BusinessError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public retryable = false,
  ) {
    super(message);
  }
}
export function normalizeError(error: unknown, requestId: string): ApiError {
  return error instanceof BusinessError
    ? { code: error.code, message: error.message, requestId }
    : { code: "INTERNAL_ERROR", message: "服务暂时不可用，请稍后重试", requestId };
}
export function errorStatus(code: string): number {
  if (code.endsWith("NOT_FOUND")) return 404;
  if (["ORDER_STATUS_INVALID", "IDEMPOTENCY_CONFLICT", "SESSION_BUSY"].includes(code)) return 409;
  if (code === "MODEL_GATEWAY_ERROR") return 502;
  if (code === "TOOL_TIMEOUT") return 504;
  if (code === "INTERNAL_ERROR" || code === "INVALID_TOOL_RESULT") return 500;
  if (code === "SERVICE_BUSY") return 503;
  return 400;
}
