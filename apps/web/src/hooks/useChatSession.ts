import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Page, StoredMessage } from "@salespilot/contracts";
import { api, streamChat } from "../api";
import { chatReducer, initialChatState } from "../chatState";

export type ChatSession = ReturnType<typeof useChatSession>;
type MessagePage = Page<StoredMessage> & { running: boolean; title: string };
export function useChatSession(
  refreshDashboard: () => Promise<unknown>,
  sessionId: string | null,
  onSelect: (id: string | null) => boolean,
) {
  const [state, dispatch] = useReducer(chatReducer, undefined, initialChatState);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [revision, setRevision] = useState(0);
  const [olderPage, setOlderPage] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const loadingOlder = useRef(false);
  const prependScroll = useRef<number | null>(null);
  const currentId = useRef(sessionId);
  const loadedId = useRef<string | null>(null);
  const mounted = useRef(false);
  const drafts = useRef(new Map<string, string>());
  const previousId = useRef<string | null>(sessionId);
  const inputValue = useRef(input);
  inputValue.current = input;
  currentId.current = sessionId;
  const [reload, setReload] = useState(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      activeRequest.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (loadedId.current === sessionId && activeRequest.current) return;
    activeRequest.current?.abort();
    activeRequest.current = null;
    drafts.current.set(previousId.current ?? "new", inputValue.current);
    previousId.current = sessionId;
    setInput(drafts.current.get(sessionId ?? "new") ?? "");
    loadedId.current = sessionId;
    dispatch({ type: "reset" });
    setOlderPage(0);
    if (!sessionId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const first = await api<MessagePage>(`/sessions/${sessionId}/messages?pageSize=100`, {
          signal: controller.signal,
        });
        const lastPage = Math.max(1, Math.ceil(first.total / 100));
        const data =
          lastPage > 1
            ? await api<MessagePage>(
                `/sessions/${sessionId}/messages?pageSize=100&page=${lastPage}`,
                { signal: controller.signal },
              )
            : first;
        if (controller.signal.aborted || currentId.current !== sessionId) return;
        dispatch({
          type: "restore",
          messages: data.running
            ? [
                ...data.items,
                {
                  id: `running-${sessionId}`,
                  role: "assistant",
                  content: "请求仍在处理中，完成后会自动刷新。",
                },
              ]
            : data.items,
        });
        setOlderPage(lastPage - 1);
        setLoading(data.running);
        if (data.running) timer = setTimeout(() => void load(), 1500);
      } catch (error) {
        if (!controller.signal.aborted) {
          setToast(error instanceof Error ? error.message : "加载会话失败");
          setLoading(false);
        }
      }
    }
    setLoading(true);
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [sessionId, reload]);

  const clear = useCallback(() => {
    if (onSelect(null)) {
      setInput("");
      dispatch({ type: "reset" });
    }
  }, [onSelect]);
  const send = useCallback(
    async (text = input) => {
      const message = text.trim();
      if (!message || activeRequest.current || loading) return;
      const controller = new AbortController();
      activeRequest.current = controller;
      const timeout = setTimeout(() => controller.abort(), 90000);
      let id = currentId.current;
      try {
        setLoading(true);
        if (!id) {
          const created = await api<{ id: string }>("/sessions", {
            method: "POST",
            body: "{}",
            signal: controller.signal,
          });
          id = created.id;
          loadedId.current = id;
          currentId.current = id;
          onSelect(id);
        }
        const selectedId = id;
        const requestId = crypto.randomUUID();
        setInput("");
        drafts.current.delete(id);
        dispatch({ type: "start", requestId, assistantId: crypto.randomUUID(), message });
        await streamChat(
          { sessionId: selectedId, message, requestId },
          (event) => {
            if (
              mounted.current &&
              currentId.current === selectedId &&
              activeRequest.current === controller
            )
              dispatch({ type: "event", event });
          },
          controller.signal,
        );
        if (mounted.current) {
          setRevision((v) => v + 1);
          await refreshDashboard();
        }
      } catch (error) {
        if (mounted.current && currentId.current === id && activeRequest.current === controller) {
          const message = controller.signal.aborted
            ? "请求已中断，请刷新会话查看最终状态。"
            : error instanceof Error
              ? error.message
              : "请求失败";
          dispatch({ type: "fail", message });
          setToast(message);
          setRevision((v) => v + 1);
        }
      } finally {
        clearTimeout(timeout);
        if (activeRequest.current === controller) {
          activeRequest.current = null;
          if (mounted.current) setLoading(false);
        }
      }
    },
    [input, loading, onSelect, refreshDashboard],
  );

  async function loadOlder() {
    if (!sessionId || !olderPage || loadingOlder.current || activeRequest.current) return;
    loadingOlder.current = true;
    try {
      const data = await api<MessagePage>(
        `/sessions/${sessionId}/messages?pageSize=100&page=${olderPage}`,
      );
      if (currentId.current === sessionId) {
        prependScroll.current = messagesRef.current
          ? messagesRef.current.scrollHeight - messagesRef.current.scrollTop
          : null;
        dispatch({
          type: "restore",
          messages: [...data.items, ...state.messages.filter((m) => m.id !== "welcome")],
        });
        setOlderPage((p) => p - 1);
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "加载失败");
    } finally {
      loadingOlder.current = false;
    }
  }
  useEffect(() => {
    if (messagesRef.current)
      messagesRef.current.scrollTop =
        messagesRef.current.scrollHeight - (prependScroll.current ?? 0);
    prependScroll.current = null;
  }, [state.messages]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  return {
    messages: state.messages,
    steps: state.steps,
    input,
    loading,
    toast,
    inputRef,
    messagesRef,
    setInput,
    setToast,
    prepare: (text: string) => {
      setInput(text);
      inputRef.current?.focus();
    },
    clear,
    send,
    revision,
    hasOlder: olderPage > 0,
    loadOlder,
    reload: () => setReload((v) => v + 1),
  };
}
