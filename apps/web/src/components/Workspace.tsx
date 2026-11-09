import { PanelLeft, PanelRight } from "lucide-react";
import type { ChatSession } from "../hooks/useChatSession";
import { ChatPanel } from "./ChatPanel";
export function Workspace({
  chat,
  onPanel,
  onHistory,
  onChain,
}: {
  chat: ChatSession;
  onPanel: () => void;
  onHistory: () => void;
  onChain: (id: string) => void;
}) {
  const question = chat.messages.find((m) => m.role === "user")?.content;
  return (
    <section className="workspace chat-workspace">
      <header className="workspace-session">
        <button
          className="icon-button history-toggle"
          onClick={onHistory}
          aria-label="打开历史会话"
        >
          <PanelLeft size={19} />
        </button>
        <div>
          <h1>{question || "智能工作台"}</h1>
          <p>把查询交给助手，把时间留给业务。</p>
        </div>
        <button className="secondary-button" onClick={onPanel}>
          <PanelRight size={17} />
          辅助面板
        </button>
      </header>
      <ChatPanel
        messages={chat.messages}
        loading={chat.loading}
        input={chat.input}
        inputRef={chat.inputRef}
        messagesRef={chat.messagesRef}
        onInputChange={chat.setInput}
        onSend={() => void chat.send()}
        onClear={chat.clear}
        onChain={onChain}
        onPrepare={chat.prepare}
        hasOlder={chat.hasOlder}
        onLoadOlder={() => void chat.loadOlder()}
        onReload={chat.reload}
      />
    </section>
  );
}
