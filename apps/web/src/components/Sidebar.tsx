import type { Health } from "@salespilot/contracts";
import type { ReactNode } from "react";
export function Sidebar({ children }: { health: Health | null; children?: ReactNode }) {
  return (
    <aside className="sidebar">
      {children}
      <div className="sidebar-bottom">
        <p>每一件业务，都有条理。</p>
        <span>历史会话仅自己可见</span>
      </div>
    </aside>
  );
}
