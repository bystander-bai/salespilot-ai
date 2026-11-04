import type { ServerResponse } from "node:http";
import type { AgentEvent, ChatResponse } from "@salespilot/contracts";

const HEARTBEAT_MS = 15_000;

export class SseConnection {
  private heartbeat?: ReturnType<typeof setInterval>;
  private readonly controller = new AbortController();

  constructor(private readonly response: ServerResponse) {}

  get signal() {
    return this.controller.signal;
  }

  private readonly onClose = () => {
    clearInterval(this.heartbeat);
    // 断连后停止后续节点与模型生成；已经提交的数据库事务由幂等键保护。
    if (!this.response.writableEnded) this.controller.abort();
  };

  open() {
    this.response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    this.response.write(": connected\n\n");
    this.response.on("close", this.onClose);
    this.heartbeat = setInterval(() => {
      if (!this.response.destroyed) this.response.write(": heartbeat\n\n");
    }, HEARTBEAT_MS);
  }

  send(event: AgentEvent) {
    if (this.response.destroyed || this.response.writableEnded || this.signal.aborted) return;
    this.response.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
  }

  replay(response: ChatResponse) {
    this.send({
      type: "run.start",
      data: { runId: response.runId, mode: response.mode, replay: true },
    });
    this.send({ type: "message.delta", data: { content: response.answer } });
    this.send({ type: "run.done", data: response });
  }

  close() {
    clearInterval(this.heartbeat);
    this.response.off("close", this.onClose);
    if (!this.response.writableEnded) this.response.end();
  }
}
