import { useCallback, useEffect, useRef, useState, type MouseEventHandler } from "react";
import { LandingPage } from "./components/LandingPage";
import { Toast } from "./components/Toast";
import { Workspace } from "./components/Workspace";
import { BusinessWorkspace } from "./components/BusinessWorkspace";
import { InsightsPanel } from "./components/InsightsPanel";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { useChatSession } from "./hooks/useChatSession";
import { useDashboard } from "./hooks/useDashboard";
import type { ActivityFilter, WorkspaceView } from "./types";
import { type PublicUser } from "@salespilot/contracts";
import { api } from "./api";
import { Login } from "./components/Login";
import { HistoryPanel } from "./components/HistoryPanel";
import { UserManagement } from "./components/UserManagement";
import { DetailDrawer, type ApplyDraft } from "./components/DetailDrawer";
import { BusinessUI, type DetailTarget } from "./business-ui";

export default function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const isWorkspace = pathname === "/workspace" || pathname === "/workspace/";

  useEffect(() => {
    function handlePopState() {
      setPathname(window.location.pathname);
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    document.title = isWorkspace ? "智能工作台 · SalesPilot" : "SalesPilot · 销售订单智能助手";
  }, [isWorkspace]);

  const navigate: MouseEventHandler<HTMLAnchorElement> = (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    const nextPath = event.currentTarget.pathname;
    window.history.pushState(null, "", nextPath);
    setPathname(nextPath);
    window.scrollTo(0, 0);
  };

  return isWorkspace ? <AuthGate onHome={navigate} /> : <LandingPage onEnter={navigate} />;
}

function AuthGate({ onHome }: { onHome: MouseEventHandler<HTMLAnchorElement> }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [checking, setChecking] = useState(true);
  const authenticated = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const expire = () => {
      if (alive && authenticated.current) {
        authenticated.current = false;
        setUser(null);
        setError("登录已失效，请重新登录");
      }
    };
    window.addEventListener("auth-expired", expire);
    void api<PublicUser>("/auth/me")
      .then((u) => {
        if (alive) {
          authenticated.current = true;
          setUser(u);
        }
      })
      .catch((e) => {
        if (alive && !/登录/.test(e.message)) setError(e.message);
      })
      .finally(() => {
        if (alive) setChecking(false);
      });
    return () => {
      alive = false;
      window.removeEventListener("auth-expired", expire);
    };
  }, []);
  if (checking || !user)
    return (
      <Login
        checking={checking}
        notice={error}
        onLogin={(u) => {
          authenticated.current = true;
          setError("");
          setUser(u);
        }}
      />
    );
  return (
    <DashboardApp
      key={user.id}
      user={user}
      onHome={onHome}
      onLogout={() => {
        authenticated.current = false;
        setUser(null);
      }}
    />
  );
}
function readRoute(userId: string) {
  const p = new URLSearchParams(window.location.search);
  const raw = p.get("view");
  const view: WorkspaceView =
    raw === "orders" || raw === "inventory" || raw === "tickets" ? raw : "workspace";
  const kind = p.get("detail");
  const id = p.get("id");
  const target: DetailTarget | null =
    id && (kind === "order" || kind === "inventory" || kind === "ticket" || kind === "apply")
      ? { kind, id }
      : null;
  return {
    view,
    sessionId: p.has("session")
      ? p.get("session") || null
      : localStorage.getItem(`salespilot-session:${userId}`),
    target,
  };
}
function DashboardApp({
  onHome,
  user,
  onLogout,
}: {
  onHome: MouseEventHandler<HTMLAnchorElement>;
  user: PublicUser;
  onLogout: () => void;
}) {
  const dashboard = useDashboard();
  const [route, setRoute] = useState(() => readRoute(user.id));
  const guard = useRef<(() => boolean) | null>(null);
  const currentUrl = useRef(window.location.href);
  const drafts = useRef(new Map<string, ApplyDraft>());
  const draft = useRef<DetailTarget["draft"]>(undefined);
  const [managing, setManaging] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<"progress" | "overview">("progress");
  const [chainId, setChainId] = useState<string | null>(null);
  useEffect(() => {
    setChainId(null);
    setHistoryOpen(false);
  }, [route.sessionId]);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [listRevision, setListRevision] = useState(0);
  const navigate = useCallback((patch: Record<string, string | null>) => {
    if (guard.current && !guard.current()) return false;
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    window.history.pushState(null, "", url);
    window.dispatchEvent(new Event("workspace-url"));
    return true;
  }, []);
  useEffect(() => {
    const update = (event: Event) => {
      if (event.type === "popstate" && guard.current && !guard.current()) {
        window.history.pushState(null, "", currentUrl.current);
        return;
      }
      currentUrl.current = window.location.href;
      setRoute(readRoute(user.id));
    };
    window.addEventListener("popstate", update);
    window.addEventListener("workspace-url", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("workspace-url", update);
    };
  }, [user.id]);
  const selectSession = useCallback(
    (id: string | null) => {
      const selected = navigate({ session: id ?? "", view: "workspace", detail: null, id: null });
      if (selected) localStorage.setItem(`salespilot-session:${user.id}`, id ?? "");
      return selected;
    },
    [navigate, user.id],
  );
  const refresh = useCallback(async () => {
    setListRevision((v) => v + 1);
    await dashboard.refresh();
  }, [dashboard.refresh]);
  const chat = useChatSession(refresh, route.sessionId, selectSession);
  async function manualRefresh() {
    setListRevision((v) => v + 1);
    const result = await dashboard.refresh();
    chat.setToast(
      result?.success
        ? "已刷新业务数据"
        : result && !result.success
          ? result.error
          : "刷新请求已被新的请求替代",
    );
  }
  const open = useCallback(
    (target: DetailTarget) => {
      if (navigate({ detail: target.kind, id: target.id })) draft.current = target.draft;
    },
    [navigate],
  );
  async function logout() {
    if (guard.current && !guard.current()) return;
    try {
      await api("/auth/logout", { method: "POST", body: "{}" });
      drafts.current.clear();
      onLogout();
    } catch (e) {
      chat.setToast(e instanceof Error ? e.message : "退出失败");
    }
  }
  const target = route.target
    ? {
        ...route.target,
        draft:
          route.target.kind === "apply" && draft.current?.orderId === route.target.id
            ? draft.current
            : undefined,
      }
    : null;
  return (
    <BusinessUI.Provider
      value={{
        user,
        open,
        refresh,
        sourceSessionId: route.sessionId ?? undefined,
        goSession: selectSession,
      }}
    >
      <div className="app-shell">
        <TopBar
          user={user}
          onManage={() => setManaging(true)}
          onLogout={() => void logout()}
          view={route.view}
          onNavigate={(view) => navigate({ view, detail: null, id: null })}
          health={dashboard.health}
          onRefresh={manualRefresh}
          refreshing={dashboard.refreshing}
          onHome={(event) => {
            if (guard.current && !guard.current()) event.preventDefault();
            else onHome(event);
          }}
        />
        <main
          className={`main-layout ${route.view !== "workspace" ? "business-layout" : ""} ${panelOpen ? "with-panel" : ""} ${historyOpen ? "history-open" : ""}`}
        >
          {route.view === "workspace" && (
            <Sidebar health={dashboard.health}>
              <HistoryPanel
                selected={route.sessionId}
                revision={chat.revision}
                onSelect={selectSession}
                onNew={chat.clear}
                notify={chat.setToast}
              />
            </Sidebar>
          )}
          <div style={{ display: route.view === "workspace" ? "contents" : "none" }}>
            <Workspace
              chat={chat}
              onPanel={() => {
                setPanelOpen((v) => !v);
                setHistoryOpen(false);
              }}
              onHistory={() => {
                setHistoryOpen((v) => !v);
                setPanelOpen(false);
              }}
              onChain={(id) => {
                setChainId(id);
                setPanelTab("progress");
                setPanelOpen(true);
                setHistoryOpen(false);
              }}
            />
          </div>
          {route.view !== "workspace" && (
            <BusinessWorkspace key={route.view} module={route.view} revision={listRevision} />
          )}
          {route.view === "workspace" && panelOpen && (
            <InsightsPanel
              messages={chat.messages}
              selectedId={chainId}
              onLatest={() => setChainId(null)}
              tab={panelTab}
              onTab={setPanelTab}
              onClose={() => setPanelOpen(false)}
              stats={dashboard.stats}
              steps={chat.steps}
              loading={chat.loading}
              filter={filter}
              onFilterChange={setFilter}
              onRefresh={() => void dashboard.refresh()}
              refreshing={dashboard.refreshing}
              refreshError={dashboard.refreshError}
              refreshedAt={dashboard.refreshedAt}
            />
          )}
        </main>
        <Toast message={chat.toast} onClose={() => chat.setToast("")} />
        {target && (
          <DetailDrawer
            target={target}
            revision={listRevision}
            onClose={() => navigate({ detail: null, id: null })}
            guard={guard}
            drafts={drafts.current}
          />
        )}
        {managing && <UserManagement onClose={() => setManaging(false)} />}
      </div>
    </BusinessUI.Provider>
  );
}
