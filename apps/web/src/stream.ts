import type { AgentEvent } from "@salespilot/contracts";

function parseEvent(block: string): AgentEvent | undefined {
  let type = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return;
  // JSON 边界集中在传输层，后续状态更新按共享事件联合类型收窄。
  const parsed: unknown = JSON.parse(data.join("\n"));
  return { type, data: parsed } as AgentEvent;
}

export async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: AgentEvent) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneSeen = false;
  const dispatchBlock = (block: string) => {
    const event = parseEvent(block);
    if (!event) return;
    if (event.type === "run.done") doneSeen = true;
    onEvent(event);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let index: number;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        dispatchBlock(block);
      }
      if (done) break;
    }
    if (buffer.trim()) dispatchBlock(buffer);
    if (!doneSeen) throw new Error("连接提前中断，请重试。已提交的售后申请会进行重复校验。");
  } finally {
    // 解析失败或回调抛错时也取消响应体，避免遗留仍在读取的网络连接。
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
