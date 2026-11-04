import { Boxes, Headphones, PackageCheck, Truck } from "lucide-react";
import type { Health } from "@salespilot/contracts";
import type { WorkspaceView } from "../types";

type Props = {
  health: Health | null;
  view: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
};

export function Sidebar({ health, view, onNavigate }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-label">业务模块</div>
      <button
        className={`nav-item ${view === "workspace" ? "active" : ""}`}
        aria-current={view === "workspace" ? "page" : undefined}
        onClick={() => onNavigate("workspace")}
      >
        <Headphones size={17} />
        <span>智能工作台</span>
        <span className="nav-count">LIVE</span>
      </button>
      <button
        className={`nav-item ${view === "orders" ? "active" : ""}`}
        aria-current={view === "orders" ? "page" : undefined}
        onClick={() => onNavigate("orders")}
      >
        <Truck size={17} />
        <span>订单查询</span>
      </button>
      <button
        className={`nav-item ${view === "inventory" ? "active" : ""}`}
        aria-current={view === "inventory" ? "page" : undefined}
        onClick={() => onNavigate("inventory")}
      >
        <Boxes size={17} />
        <span>库存查询</span>
      </button>
      <button
        className={`nav-item ${view === "tickets" ? "active" : ""}`}
        aria-current={view === "tickets" ? "page" : undefined}
        onClick={() => onNavigate("tickets")}
      >
        <PackageCheck size={17} />
        <span>售后工单</span>
      </button>

      <div className="sidebar-divider" />
      <div className="sidebar-label">系统状态</div>
      <div className="system-card">
        <SystemRow
          label="API 服务"
          value={health?.database === "available" ? "在线" : "检查中"}
          online={health?.database === "available"}
        />
        <SystemRow label="数据源" value={health?.database === "available" ? "SQLite" : "-"} />
        <SystemRow label="响应方式" value="SSE 流式" />
      </div>
    </aside>
  );
}

function SystemRow({
  label,
  value,
  online = false,
}: {
  label: string;
  value: string;
  online?: boolean;
}) {
  return (
    <div className="system-row">
      <span>{label}</span>
      <strong className={online ? "online" : ""}>{value}</strong>
    </div>
  );
}
