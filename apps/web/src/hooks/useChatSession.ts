import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { streamChat } from "../api";
import { chatReducer, initialChatState } from "../chatState";

export type ChatSession = ReturnType<typeof useChatSession>;

const CHAT_TIMEOUT_MS = 90_000;
const TOAST_DURATION_MS = 3500;
const createSessionId = () => `salespilot-${crypto.randomUUID()}`;

export function useChatSession(refreshDashboard: () => Promise<unknown>) {
  const [state, dispatch] = useReducer(chatReducer, undefined, initialChatState);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");
  const sessionId = useRef(createSessionId());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      activeRequest.current?.abort();
      clearTimeout(focusTimer.current);
    };
  }, []);

  const prepare = useCallback((text: string) => {
    if (activeRequest.current) return;
    setInput(text);
    inputRef.current?.focus();
  }, []);

  const clear = useCallback(() => {
    if (activeRequest.current) return;
    sessionId.current = createSessionId();
    dispatch({ type: "reset" });
    setInput("");
  }, []);

  const send = useCallback(
    async (text = input) => {
      const message = text.trim();
      if (!message || activeRequest.current) return;

      const controller = new AbortController();
      activeRequest.current = controller;
      const timeout = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
      const requestId = crypto.randomUUID();
      clearTimeout(focusTimer.current);
      setInput("");
      setLoading(true);
      dispatch({ type: "start", requestId, assistantId: crypto.randomUUID(), message });

      try {
        await streamChat(
          { sessionId: sessionId.current, message, requestId },
          (event) => {
            if (mounted.current) dispatch({ type: "event", event });
          },
          controller.signal,
        );
        if (mounted.current) await refreshDashboard();
      } catch (error) {
        if (!mounted.current) return;
        const messageText = controller.signal.aborted
          ? "请求超时，请稍后重试。售后申请会进行重复校验。"
          : error instanceof Error
            ? error.message
            : "请求失败，请稍后重试";
        dispatch({ type: "fail", message: messageText });
        setToast(messageText);
      } finally {
        clearTimeout(timeout);
        activeRequest.current = null;
        if (mounted.current) {
          setLoading(false);
          focusTimer.current = setTimeout(() => inputRef.current?.focus(), 0);
        }
      }
    },
    [input, refreshDashboard],
  );

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [state.messages]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), TOAST_DURATION_MS);
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
    prepare,
    clear,
    send,
  };
}
