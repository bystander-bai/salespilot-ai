import { RefreshCw } from "lucide-react";
import type { MouseEventHandler } from "react";
import type { Health } from "@salespilot/contracts";
import { modeMeta } from "../constants";
import { BrandLogo } from "./BrandLogo";

type Props = {
  health: Health | null;
  onRefresh: () => void;
  refreshing: boolean;
  onHome: MouseEventHandler<HTMLAnchorElement>;
};

export function TopBar({ health, onRefresh, refreshing, onHome }: Props) {
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
      <div className="top-actions">
        <div className="status-pill" title={mode?.hint ?? "连接检查中"}>
          <span
            className="status-dot"
            style={{ background: mode?.color ?? "var(--color-scrollbar)" }}
          />
          {mode?.label ?? "连接检查中"}
        </div>
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
        <div className="avatar">SP</div>
      </div>
    </header>
  );
}
