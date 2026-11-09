import { Boxes, Headphones, PackageCheck, RefreshCw, Truck } from "lucide-react";
import type { MouseEventHandler } from "react";
import { roleLabels, type PublicUser, type Health } from "@salespilot/contracts";
import { modeMeta } from "../constants";
import { BrandLogo } from "./BrandLogo";
import type { WorkspaceView } from "../types";

const navigation = [
  { view: "workspace", label: "智能工作台", icon: Headphones },
  { view: "orders", label: "订单查询", icon: Truck },
  { view: "inventory", label: "库存查询", icon: Boxes },
  { view: "tickets", label: "售后工单", icon: PackageCheck },
] as const;

type Props = {
  user: PublicUser;
  onManage: () => void;
  onLogout: () => void;
  health: Health | null;
  onRefresh: () => void;
  refreshing: boolean;
  onHome: MouseEventHandler<HTMLAnchorElement>;
  view: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
};

export function TopBar({
  user,
  onManage,
  onLogout,
  health,
  onRefresh,
  refreshing,
  onHome,
  view,
  onNavigate,
}: Props) {
  const mode = health ? modeMeta[health.mode] : null;

  return (
    <header className="topbar">
      <a className="brand brand-link" href="/" onClick={onHome} aria-label="返回封面">
        <div className="brand-mark">
          <BrandLogo />
        </div>
        <div>
          <div className="brand-title">
            SalesPilot <span>AI</span>
          </div>
          <div className="brand-subtitle">销售订单智能助手</div>
        </div>
      </a>
      <nav className="top-nav" aria-label="业务模块">
        {navigation.map(({ view: target, label, icon: Icon }) => (
          <button
            key={target}
            className={`nav-item ${view === target ? "active" : ""}`}
            aria-current={view === target ? "page" : undefined}
            onClick={() => onNavigate(target)}
          >
            <Icon size={17} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="top-actions">
        <details className="service-menu">
          <summary className="status-pill">
            <span
              className="status-dot"
              style={{
                background:
                  health?.status === "ok" ? "var(--color-success)" : "var(--color-warning)",
              }}
            />
            {health?.status === "ok" ? "服务正常" : health ? "服务需关注" : "连接检查中"}
          </summary>
          <div className="dropdown">
            <strong>服务详情</strong>
            <p>业务数据库：{health?.database === "available" ? "可用" : "暂不可用"}</p>
            <p>运行方式：{mode?.label ?? "检查中"}</p>
            <p className="muted">{mode?.hint}</p>
          </div>
        </details>
        <button
          className="icon-button"
          onClick={onRefresh}
          title={refreshing ? "正在刷新状态与数据…" : "刷新状态与数据"}
          aria-label="刷新状态与数据"
          aria-busy={refreshing}
          disabled={refreshing}
        >
          <RefreshCw size={17} className={refreshing ? "spin" : undefined} />
        </button>
        <details className="account-menu">
          <summary className="avatar" aria-label="账号菜单">
            {user.name.slice(0, 1)}
          </summary>
          <div className="dropdown">
            <strong>{user.name}</strong>
            <p className="muted">{roleLabels[user.role]}</p>
            {user.role === "ADMIN" && <button onClick={onManage}>账号管理</button>}
            <button onClick={onLogout}>退出登录</button>
          </div>
        </details>
      </div>
    </header>
  );
}
