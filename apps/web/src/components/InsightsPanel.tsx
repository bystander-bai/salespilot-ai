import {
  Activity,
  Boxes,
  Check,
  ChevronDown,
  Database,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  Truck,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import type { ActivityFilter, DashboardStats, ExecutionStep } from "../types";

type Props = {
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
};
const ACTIVITY_KEYWORDS: Record<Exclude<ActivityFilter, "all">, string> = {
  order: "order",
  inventory: "inventory",
  ticket: "after",
};

export function InsightsPanel({
  stats,
  steps,
  loading,
  filter,
  onFilterChange,
  onRefresh,
  refreshing,
  refreshError,
  refreshedAt,
}: Props) {
  const filteredActivity =
    filter === "all"
      ? stats.activity
      : stats.activity.filter((item) => item.action.includes(ACTIVITY_KEYWORDS[filter]));

  return (
    <aside className="insights">
      <div className="panel-title">
        <div>
          <div className="eyebrow">LIVE MONITOR</div>
          <h2>执行概览</h2>
        </div>
        <span className="live-indicator">
          <i /> LIVE
        </span>
      </div>
      <div className="metric-grid">
        <Metric icon={<Truck size={17} />} label="订单总数" value={stats.orders} />
        <Metric icon={<PackageCheck size={17} />} label="售后工单" value={stats.tickets} />
        <Metric icon={<Database size={17} />} label="库存记录" value={stats.inventoryCount} />
      </div>
      <ExecutionPanel steps={steps} loading={loading} />
      <InventoryPanel
        stats={stats}
        onRefresh={onRefresh}
        refreshing={refreshing}
        refreshError={refreshError}
        refreshedAt={refreshedAt}
      />
      <ActivityPanel activity={filteredActivity} filter={filter} onFilterChange={onFilterChange} />
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

function ExecutionPanel({ steps, loading }: { steps: ExecutionStep[]; loading: boolean }) {
  return (
    <div className="execution-panel">
      <div className="section-title">
        <span>本次执行链路</span>
        {loading && <LoaderCircle size={15} className="spin" />}
      </div>
      {steps.length ? (
        <div
          className="step-list"
          role="region"
          aria-label="本次执行步骤"
          aria-busy={loading}
          tabIndex={0}
        >
          {steps.map((step, index) => (
            <StepRow key={`${step.id}-${index}`} step={step} last={index === steps.length - 1} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Activity size={22} />
          <span>
            发送一条消息后
            <br />
            这里会显示执行过程
          </span>
        </div>
      )}
      {steps.length > 4 && (
        <div className="step-list-hint">共 {steps.length} 步 · 上下滚动查看更多</div>
      )}
    </div>
  );
}

function StepRow({ step, last }: { step: ExecutionStep; last: boolean }) {
  return (
    <div className="step">
      <div className={`step-icon ${step.state}`}>
        {step.state === "error" ? (
          <X size={13} />
        ) : step.state === "running" ? (
          <LoaderCircle size={13} className="spin" />
        ) : (
          <Check size={13} />
        )}
      </div>
      <div className="step-body">
        <strong>{step.label}</strong>
        {step.detail && <span>{step.detail}</span>}
      </div>
      {!last && <div className="step-line" />}
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
        <span>库存关注</span>
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
