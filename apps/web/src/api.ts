import type {
  BusinessLists,
  BusinessModule,
  ChatRequest,
  DashboardResponse,
  EventSink,
  Health,
} from "@salespilot/contracts";
import { readEventStream } from "./stream";

const REQUEST_FAILED = "请求失败，请稍后重试";

async function responseError(response: Response): Promise<Error> {
  const body: unknown = await response.json().catch(() => null);
  const message =
    body && typeof body === "object" && "message" in body && typeof body.message === "string"
      ? body.message
      : REQUEST_FAILED;
  return new Error(message);
}

export async function fetchBusinessList<T extends BusinessModule>(
  module: T,
  signal: AbortSignal,
): Promise<BusinessLists[T]> {
  const response = await fetch(`/api/${module}`, { signal });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export async function fetchDashboard(signal: AbortSignal) {
  const [healthResponse, statsResponse] = await Promise.all([
    fetch("/api/health", { signal }),
    fetch("/api/dashboard", { signal }),
  ]);
  // 健康检查的 503 仍携带有效的降级状态，需要展示给用户。
  const health: Health = await healthResponse.json();
  if (!statsResponse.ok) throw await responseError(statsResponse);
  const stats: DashboardResponse = await statsResponse.json();
  return { health, stats };
}

export async function streamChat(request: ChatRequest, onEvent: EventSink, signal: AbortSignal) {
  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify(request),
  });
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new Error(REQUEST_FAILED);
  await readEventStream(response.body, onEvent);
}
