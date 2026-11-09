import { useEffect, useRef } from "react";
import { ExecutionChain } from "./ExecutionChain";
import { Boxes, ChevronDown, Database, PackageCheck, RefreshCw, Truck, X } from "lucide-react";
import type { ReactNode } from "react";
import type { ActivityFilter, DashboardStats, ExecutionStep, Message } from "../types";

type Props = {
  messages: Message[];
  selectedId: string | null;
  onLatest: () => void;
  tab: "progress" | "overview";
  onTab: (tab: "progress" | "overview") => void;
  onClose: () => void;
  stats: DashboardStats;
  steps: ExecutionStep[];
  loading: boolean;
  filter: ActivityFilter;
  onFilterChange: (filter: ActivityFilter) => void;
  onRefresh: () => void;
  refreshing: boolean;
  refreshError: string;
  refreshedAt: number | null;
};

const ACTIVITY_LABELS: Record<string, string> = {
  get_order: "查询订单",
  get_inventory: "查询库存",
  create_after_sales_ticket: "创建售后工单",
  prepare_after_sales_ticket: "准备售后申请",
  get_tickets: "查询售后进度",
  "ticket.create": "创建售后工单",
  "ticket.claim": "领取工单",
  "ticket.assign": "分配 / 转派工单",
  "ticket.note": "追加处理备注",
  "ticket.resolve": "解决售后工单",
  "ticket.close": "关闭售后工单",
  "ticket.cancel": "取消售后工单",
  "user.update": "更新团队账号",
  "user.create": "创建团队账号",
};
const ACTIVITY_KEYWORDS: Record<Exclude<ActivityFilter, "all">, string> = {
  order: "order",
  inventory: "inventory",
  ticket: "ticket",
};

export function InsightsPanel({
  messages,
  selectedId,
  onLatest,
  tab,
  onTab,
  onClose,
  stats,
  loading,
  filter,
  onFilterChange,
  onRefresh,
  refreshing,
  refreshError,
  refreshedAt,
}: Props) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  const latest = messages.filter((m) => m.role === "assistant" && m.id !== "welcome").at(-1);
  const selected = selectedId ? messages.find((m) => m.id === selectedId) : latest;
  const index = selected ? messages.indexOf(selected) : -1;
  const question = messages
    .slice(0, index)
    .filter((m) => m.role === "user")
    .at(-1)?.content;
  const filteredActivity =
    filter === "all"
      ? stats.activity
      : stats.activity.filter(
          (item) =>
            item.action.includes(ACTIVITY_KEYWORDS[filter]) ||
            (filter === "ticket" && item.action.includes("after_sales")),
        );

  return (
    <aside
      className="insights"
      ref={panel}
      tabIndex={-1}
      aria-label="辅助面板"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="panel-title">
        <h2>辅助面板</h2>
        <button className="icon-button" onClick={onClose} aria-label="关闭辅助面板">
          <X size={18} />
        </button>
      </div>
      <div className="panel-tabs" role="tablist" aria-label="辅助信息">
        <button role="tab" aria-selected={tab === "progress"} onClick={() => onTab("progress")}>
          处理进度
        </button>
        <button role="tab" aria-selected={tab === "overview"} onClick={() => onTab("overview")}>
          业务概览
        </button>
      </div>
      {tab === "progress" ? (
        <div role="tabpanel">
          {selectedId && selected !== latest && (
            <button className="text-button" onClick={onLatest}>
              返回最新链路 →
            </button>
          )}
          <ExecutionChain
            message={selected}
            question={question}
            loading={loading && selected === latest}
          />
        </div>
      ) : (
        <div role="tabpanel">
          <div className="metric-grid">
            <Metric icon={<Truck size={17} />} label="订单总数" value={stats.orders} />
            <Metric icon={<PackageCheck size={17} />} label="售后工单" value={stats.tickets} />
            <Metric icon={<Database size={17} />} label="库存记录" value={stats.inventoryCount} />
          </div>

          <InventoryPanel
            stats={stats}
            onRefresh={onRefresh}
            refreshing={refreshing}
            refreshError={refreshError}
            refreshedAt={refreshedAt}
          />
          <ActivityPanel
            activity={filteredActivity}
            filter={filter}
            onFilterChange={onFilterChange}
          />
        </div>
      )}
    </aside>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="metric">
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value.toLocaleString("zh-CN")}</strong>
    </div>
  );
}

function InventoryPanel({
  stats,
  onRefresh,
  refreshing,
  refreshError,
  refreshedAt,
}: Pick<Props, "stats" | "onRefresh" | "refreshing" | "refreshError" | "refreshedAt">) {
  return (
    <div className="inventory-panel">
      <div className="section-title">
        <span>库存列表</span>
        <button
          className="plain-icon inventory-refresh"
          aria-label="刷新库存"
          title={refreshing ? "正在刷新库存" : "刷新库存"}
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshCw size={14} className={refreshing ? "spin" : undefined} />
        </button>
      </div>
      <div
        className="inventory-list"
        role="region"
        aria-label="库存关注列表"
        aria-busy={refreshing}
        tabIndex={0}
      >
        {stats.inventory.map((item) => (
          <div className="inventory-row" key={`${item.sku}-${item.warehouse}`}>
            <div className="product-icon">
              <Boxes size={15} />
            </div>
            <div className="product-info">
              <strong>{item.name}</strong>
              <span>
                {item.sku} · {item.warehouse}
              </span>
            </div>
            <b>{item.available}</b>
          </div>
        ))}
        {!stats.inventory.length && (
          <div className="no-activity">
            {refreshing ? "正在加载库存…" : refreshError ? "库存暂不可用" : "暂无库存记录"}
          </div>
        )}
      </div>
      <div className="inventory-list-hint">
        共 {stats.inventory.length} 条{stats.inventory.length > 4 ? " · 上下滚动查看更多" : ""}
      </div>
      <div className={`inventory-refresh-status${refreshError ? " error" : ""}`} role="status">
        {refreshing
          ? "正在刷新库存…"
          : refreshError ||
            (refreshedAt
              ? `已更新 ${new Date(refreshedAt)
                  .toLocaleString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hourCycle: "h23",
                  })
                  .replaceAll("/", "-")}`
              : "")}
      </div>
    </div>
  );
}

function ActivityPanel({
  activity,
  filter,
  onFilterChange,
}: {
  activity: DashboardStats["activity"];
  filter: ActivityFilter;
  onFilterChange: (filter: ActivityFilter) => void;
}) {
  return (
    <div className="activity-panel">
      <div className="section-title">
        <span>最近操作</span>
        <div className="filter-select">
          <select
            aria-label="筛选最近操作"
            value={filter}
            onChange={(event) => onFilterChange(event.target.value as ActivityFilter)}
          >
            <option value="all">全部</option>
            <option value="order">订单</option>
            <option value="inventory">库存</option>
            <option value="ticket">售后</option>
          </select>
          <ChevronDown size={13} />
        </div>
      </div>
      <div
        className="activity-list"
        key={filter}
        role="region"
        aria-label="最近操作列表"
        tabIndex={0}
      >
        {activity.map((item) => (
          <div className="activity-row" key={item.id}>
            <div className={`activity-dot ${item.success ? "success" : "fail"}`} />
            <div>
              <strong>{ACTIVITY_LABELS[item.action] ?? "其他操作"}</strong>
              <time dateTime={item.createdAt}>
                {new Date(item.createdAt)
                  .toLocaleString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    hourCycle: "h23",
                  })
                  .replaceAll("/", "-")}
              </time>
            </div>
          </div>
        ))}
        {!activity.length && (
          <div className="no-activity">
            {filter === "all" ? "暂无操作记录" : "暂无相关操作记录"}
          </div>
        )}
      </div>
      <div className="activity-list-hint">
        共 {activity.length} 条{activity.length > 4 ? " · 上下滚动查看更多" : ""}
      </div>
    </div>
  );
}
