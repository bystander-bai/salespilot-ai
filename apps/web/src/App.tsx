import { useEffect, useState, type MouseEventHandler } from "react";
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

  return isWorkspace ? <DashboardApp onHome={navigate} /> : <LandingPage onEnter={navigate} />;
}

function DashboardApp({ onHome }: { onHome: MouseEventHandler<HTMLAnchorElement> }) {
  const dashboard = useDashboard();
  const chat = useChatSession(dashboard.refresh);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [view, setView] = useState<WorkspaceView>("workspace");
  const [listRevision, setListRevision] = useState(0);

  async function refresh() {
    chat.setToast("");
    const result = dashboard.refresh();
    setListRevision((revision) => revision + 1);
    const outcome = await result;
    if (outcome) {
      chat.setToast(outcome.success ? "状态与统计数据已刷新" : `刷新失败：${outcome.error}`);
    }
  }

  return (
    <div className="app-shell">
      <TopBar
        health={dashboard.health}
        onRefresh={refresh}
        refreshing={dashboard.refreshing}
        onHome={onHome}
      />
      <main className={`main-layout ${view !== "workspace" ? "business-layout" : ""}`}>
        <Sidebar health={dashboard.health} view={view} onNavigate={setView} />
        {view === "workspace" ? (
          <Workspace chat={chat} onSendSample={(sample) => void chat.send(sample)} />
        ) : (
          <BusinessWorkspace key={view} module={view} revision={listRevision} />
        )}
        {view === "workspace" && (
          <InsightsPanel
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
    </div>
  );
}
