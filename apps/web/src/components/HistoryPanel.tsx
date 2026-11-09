import { useEffect, useState } from "react";
import type { Page, SessionSummary } from "@salespilot/contracts";
import { api } from "../api";

export function HistoryPanel({
  selected,
  revision,
  onSelect,
  onNew,
  notify,
}: {
  selected: string | null;
  revision: number;
  onSelect: (id: string | null) => void;
  onNew: () => void;
  notify: (message: string) => void;
}) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<SessionSummary>>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 15,
  });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<Page<SessionSummary>>(
        `/sessions?pageSize=15&page=${page}&q=${encodeURIComponent(q)}`,
        { signal: controller.signal },
      )
        .then(setData)
        .catch((e) => {
          if (!controller.signal.aborted) notify(e.message);
        });
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [q, page, revision, version, selected]);
  async function rename(s: SessionSummary) {
    const title = window.prompt("会话名称", s.title);
    if (!title?.trim()) return;
    try {
      await api(`/sessions/${s.id}`, { method: "PATCH", body: JSON.stringify({ title }) });
      setVersion((v) => v + 1);
    } catch (e) {
      notify(e instanceof Error ? e.message : "重命名失败");
    }
  }
  async function remove(s: SessionSummary) {
    if (!window.confirm("删除此会话及聊天记录？已经创建的工单会保留。")) return;
    try {
      await api(`/sessions/${s.id}`, { method: "DELETE" });
      if (selected === s.id) onSelect(null);
      setVersion((v) => v + 1);
    } catch (e) {
      notify(e instanceof Error ? e.message : "删除失败");
    }
  }
  return (
    <details className="history-panel" open>
      <summary>历史会话 · 仅自己可见</summary>
      <button className="primary-button" onClick={onNew}>
        ＋ 新建会话
      </button>
      <input
        aria-label="搜索历史会话"
        placeholder="搜索标题或消息"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
      />
      <div className="history-list">
        {data.items.map((s) => (
          <div key={s.id} className={`history-item ${selected === s.id ? "selected" : ""}`}>
            <button className="history-title" title={s.title} onClick={() => onSelect(s.id)}>
              {s.title}
              {s.running ? " · 处理中" : ""}
            </button>
            <details className="history-menu">
              <summary aria-label={`会话操作 ${s.title}`}>···</summary>
              <div>
                <button aria-label={`重命名 ${s.title}`} onClick={() => void rename(s)}>
                  重命名
                </button>
                <button aria-label={`删除 ${s.title}`} onClick={() => void remove(s)}>
                  删除
                </button>
              </div>
            </details>
          </div>
        ))}
        {!data.items.length && (
          <p className="muted">{q ? "没有匹配的会话" : "发送消息后自动保存"}</p>
        )}
      </div>
      <div className="history-paging">
        <button disabled={page <= 1} onClick={() => setPage((v) => v - 1)}>
          上一页
        </button>
        <span>
          {page} / {Math.max(1, Math.ceil(data.total / 15))}
        </span>
        <button disabled={page * 15 >= data.total} onClick={() => setPage((v) => v + 1)}>
          下一页
        </button>
      </div>
    </details>
  );
}
