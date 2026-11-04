import { LoaderCircle, Send } from "lucide-react";
import type { RefObject } from "react";
import { ResultCard } from "./ResultCard";
import { BrandLogo } from "./BrandLogo";
import type { Message } from "../types";

type Props = {
  messages: Message[];
  loading: boolean;
  input: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  messagesRef: RefObject<HTMLDivElement | null>;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onClear: () => void;
};

export function ChatPanel({
  messages,
  loading,
  input,
  inputRef,
  messagesRef,
  onInputChange,
  onSend,
  onClear,
}: Props) {
  const latest = messages[messages.length - 1];

  return (
    <div className="chat-card">
      <div className="chat-header">
        <div>
          <strong>智能对话</strong>
          <span className="muted"> · {messages.length - 1} 条消息</span>
        </div>
        <button className="text-button" disabled={loading} onClick={onClear}>
          清空对话
        </button>
      </div>
      <div
        className="messages"
        ref={messagesRef}
        role="log"
        aria-label="对话消息"
        aria-live="polite"
      >
        {messages.map((message) => (
          <MessageRow
            key={message.id}
            message={message}
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
          rows={1}
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

function MessageRow({ message, loading }: { message: Message; loading: boolean }) {
  return (
    <div className={`message-row ${message.role}`}>
      <div className={`message-avatar ${message.role}`}>
        {message.role === "assistant" ? <BrandLogo /> : "你"}
      </div>
      <div className="message-content">
        <div className="message-meta">
          {message.role === "assistant" ? "SalesPilot" : "你"}
          <span>{message.role === "assistant" ? "AI 助手" : ""}</span>
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
      </div>
    </div>
  );
}
