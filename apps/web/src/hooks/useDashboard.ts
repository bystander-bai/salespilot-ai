import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardResponse, Health } from "@salespilot/contracts";
import { fetchDashboard } from "../api";
import { emptyDashboardStats } from "../types";

const DASHBOARD_REFRESH_MS = 15_000;
const DASHBOARD_TIMEOUT_MS = 10_000;

type RefreshResult = { success: true } | { success: false; error: string };

export function useDashboard() {
  const [health, setHealth] = useState<Health | null>(null);
  const [stats, setStats] = useState<DashboardResponse>(emptyDashboardStats);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  const refresh = useCallback(async (): Promise<RefreshResult | undefined> => {
    // 手动刷新与轮询共用请求，取消旧请求以防较慢的结果覆盖最新状态。
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setRefreshing(true);
    setRefreshError("");
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, DASHBOARD_TIMEOUT_MS);
    try {
      const result = await fetchDashboard(controller.signal);
      if (controller.signal.aborted) return;
      if (!result.stats) throw new Error("数据刷新失败，请点击刷新重试");
      setHealth(result.health);
      setStats(result.stats);
      setRefreshedAt(Date.now());
      return { success: true };
    } catch (error) {
      if (!controller.signal.aborted || timedOut) {
        setHealth(null);
        const message = timedOut
          ? "数据刷新超时，请点击刷新重试"
          : error instanceof TypeError
            ? "无法连接后台服务，请检查应用服务后重试"
            : error instanceof Error && !(error instanceof SyntaxError)
              ? error.message
              : "后台返回数据格式异常，请稍后重试";
        setRefreshError(message);
        return { success: false, error: message };
      }
    } finally {
      clearTimeout(timeout);
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setRefreshing(false);
      }
      controller.abort();
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!activeRequest.current) void refresh();
    }, DASHBOARD_REFRESH_MS);
    return () => {
      clearInterval(timer);
      activeRequest.current?.abort();
    };
  }, [refresh]);

  return { health, stats, refresh, refreshing, refreshError, refreshedAt };
}
