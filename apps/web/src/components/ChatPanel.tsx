import { Boxes, Truck, PackageCheck, LoaderCircle, Send, CheckCircle2 } from "lucide-react";
import type { RefObject } from "react";
import { ResultCard } from "./ResultCard";
import { BrandLogo } from "./BrandLogo";
import { samples } from "../constants";
import { useBusinessUI } from "../business-ui";
import type { Message } from "../types";

type Props = {
  onChain: (id: string) => void;
  onPrepare: (text: string) => void;
  messages: Message[];
  loading: boolean;
  input: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  messagesRef: RefObject<HTMLDivElement | null>;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onClear: () => void;
  hasOlder?: boolean;
  onLoadOlder?: () => void;
  onReload?: () => void;
};

export function ChatPanel({
  onChain,
  onPrepare,
  messages,
  loading,
  input,
  inputRef,
  messagesRef,
  onInputChange,
  onSend,
  onClear,
  hasOlder,
  onLoadOlder,
  onReload,
}: Props) {
  const latest = messages[messages.length - 1];
  const { user } = useBusinessUI();
  const hasConversation = messages.some((m) => m.role === "user");

  return (
    <div className="chat-card">
      <div className="chat-header">
        <div>
          <strong>智能对话</strong>
          <span className="muted"> · {messages.length - 1} 条消息</span>
        </div>
        <div className="action-row">
          <button className="text-button" onClick={onReload}>
            刷新会话
          </button>
        </div>
      </div>
      <div
        className="messages"
        ref={messagesRef}
        role="log"
        aria-label="对话消息"
        aria-live="polite"
      >
        {hasOlder && <button onClick={onLoadOlder}>加载更早消息</button>}
        {!hasConversation && (
          <div className="chat-welcome">
            <div className="welcome-mark">
              <BrandLogo />
            </div>
            <h2>你好，{user.name}。今天有什么可以帮忙？</h2>
            <p>从一笔订单，到一次售后。说出需求，剩下的交给我。</p>
            <div className="welcome-actions">
              {[Truck, Boxes, PackageCheck].map((Icon, i) => (
                <button key={i} onClick={() => onPrepare(samples[i])}>
                  <Icon size={22} />
                  <strong>{["查订单", "查库存", "申请售后"][i]}</strong>
                  <span>
                    {["订单明细与配送进度", "商品与跨仓库存信息", "准备申请，核对后提交"][i]} →
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {messages
          .filter((m) => m.id !== "welcome")
          .map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              onChain={onChain}
              loading={loading && message.id === latest.id}
            />
          ))}
      </div>
      <div className="composer">
        <textarea
          aria-label="业务需求"
          ref={inputRef}
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onSend();
            }
          }}
          placeholder="输入订单、库存或售后需求…"
          rows={2}
          maxLength={2000}
          disabled={loading}
        />
        <div className="composer-bottom">
          <span>Enter 发送 · Shift + Enter 换行</span>
          <button className="send-button" disabled={!input.trim() || loading} onClick={onSend}>
            {loading ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}
            <span>{loading ? "处理中" : "发送"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageRow({
  message,
  loading,
  onChain,
}: {
  message: Message;
  loading: boolean;
  onChain: (id: string) => void;
}) {
  return (
    <div className={`message-row ${message.role}`}>
      <div className={`message-avatar ${message.role}`}>
        {message.role === "assistant" ? <BrandLogo /> : "你"}
      </div>
      <div className="message-content">
        <div className="message-meta">
          {message.role === "assistant" ? "SalesPilot" : "你"}
          <span>
            {message.createdAt
              ? new Date(message.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
              : message.role === "assistant"
                ? "AI 助手"
                : ""}
          </span>
        </div>
        <div className={`bubble ${message.error ? "bubble-error" : ""}`}>
          {message.content.split("\n").map((line, index, lines) => (
            <span key={`${message.id}-${index}`}>
              {line}
              {index < lines.length - 1 && <br />}
            </span>
          ))}
          {loading && (
            <span className="typing">
              <i />
              <i />
              <i />
            </span>
          )}
        </div>
        {message.result && <ResultCard result={message.result} />}
        {message.role === "assistant" && (
          <div className="message-chain">
            <CheckCircle2 size={14} />
            <span>
              {loading
                ? "正在处理"
                : message.error
                  ? "本次处理未完成"
                  : message.result?.kind === "ticketDraft"
                    ? "草稿已准备，等待确认"
                    : "本次回复已完成"}
            </span>
            <button onClick={() => onChain(message.id)}>查看本次链路 →</button>
          </div>
        )}
      </div>
    </div>
  );
}
