import { Activity } from "lucide-react";
import { samples } from "../constants";
import type { ChatSession } from "../hooks/useChatSession";
import { ChatPanel } from "./ChatPanel";

const QUICK_ACTION_LIMIT = 3;
type Props = { chat: ChatSession; onSendSample: (sample: string) => void };

export function Workspace({ chat, onSendSample }: Props) {
  return (
    <section className="workspace">
      <div className="workspace-heading">
        <div>
          <div className="eyebrow">AI OPERATIONS DESK</div>
          <h1>今天有什么可以帮忙？</h1>
          <p>用一句话描述你的业务需求，Agent 会自动识别意图并调用对应工具。</p>
        </div>
        <div className="heading-badge">
          <Activity size={15} />
          <span>实时执行链路</span>
        </div>
      </div>
      <div className="quick-actions">
        <span>试试这样问</span>
        {samples.slice(0, QUICK_ACTION_LIMIT).map((sample) => (
          <button key={sample} onClick={() => onSendSample(sample)} disabled={chat.loading}>
            {sample.replace(/[？?]/, "")}
          </button>
        ))}
      </div>
      <ChatPanel
        messages={chat.messages}
        loading={chat.loading}
        input={chat.input}
        inputRef={chat.inputRef}
        messagesRef={chat.messagesRef}
        onInputChange={chat.setInput}
        onSend={() => void chat.send()}
        onClear={chat.clear}
      />
    </section>
  );
}
