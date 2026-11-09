import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Boxes,
  ChevronLeft,
  ChevronRight,
  PackageCheck,
  RefreshCw,
  Search,
  Truck,
} from "lucide-react";
import { orderStatusLabels, type BusinessModule, type TicketListItem } from "@salespilot/contracts";
import { useBusinessUI } from "../business-ui";
import { fetchBusinessList } from "../api";

type Cell = { primary: string; secondary?: string; tone?: "green" | "amber" | "muted" | "red" };
type Row = {
  createdAt?: string;
  available?: number;
  id: string;
  filter: string;
  cells: Cell[];
  ticket?: TicketListItem;
};
type ModuleDefinition = {
  title: string;
  subtitle: string;
  eyebrow: string;
  placeholder: string;
  filterLabel: string;
  columns: string[];
  icon: typeof Truck;
  load: (signal: AbortSignal) => Promise<Row[]>;
};

const PAGE_SIZE = 10;
const ticketStatuses: Record<string, string> = {
  CREATED: "待处理",
  PROCESSING: "处理中",
  RESOLVED: "已解决",
  CLOSED: "已关闭",
  CANCELLED: "已取消",
};
const ticketTypes: Record<string, string> = { RETURN: "退货", REPAIR: "维修", EXCHANGE: "换货" };

function date(value: string | null, includeTime = false) {
  if (!value) return "暂无送达日期";
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(includeTime ? ({ hour: "2-digit", minute: "2-digit" } as const) : {}),
  });
}

const modules: Record<BusinessModule, ModuleDefinition> = {
  orders: {
    title: "订单查询",
    subtitle: "查看具体订单、商品明细与配送状态。",
    eyebrow: "ORDER CENTER",
    placeholder: "搜索订单号、客户、商品或 SKU",
    filterLabel: "订单状态",
    icon: Truck,
    columns: ["订单号 / 创建时间", "客户", "商品明细", "订单状态", "预计送达"],
    async load(signal) {
      return (await fetchBusinessList("orders", signal)).map((order) => ({
        id: order.orderId,
        createdAt: order.createdAt,
        filter: orderStatusLabels[order.status] ?? order.status,
        cells: [
          { primary: order.orderId, secondary: date(order.createdAt, true) },
          { primary: order.customerName },
          {
            primary:
              order.items
                .slice(0, 2)
                .map((item) => `${item.name} × ${item.quantity}`)
                .join("\n") + (order.items.length > 2 ? `\n另有 ${order.items.length - 2} 项` : ""),
            secondary: order.items.map((item) => item.sku).join(" / "),
          },
          {
            primary: orderStatusLabels[order.status] ?? order.status,
            tone:
              order.status === "CANCELLED"
                ? "muted"
                : order.status === "PENDING" || order.status === "PROCESSING"
                  ? "amber"
                  : "green",
          },
          { primary: date(order.estimatedDelivery) },
        ],
      }));
    },
  },
  inventory: {
    title: "库存查询",
    subtitle: "按商品与仓库查看可用库存、预留库存及更新时间。",
    eyebrow: "INVENTORY CENTER",
    placeholder: "搜索商品、SKU、仓库名称或编码",
    filterLabel: "仓库",
    icon: Boxes,
    columns: ["商品 / SKU", "仓库", "可用库存", "预留库存", "库存状态", "更新时间"],
    async load(signal) {
      return (await fetchBusinessList("inventory", signal)).map((item) => ({
        id: `${item.sku}:${item.warehouse}`,
        available: item.available,
        filter: item.warehouseName,
        cells: [
          { primary: item.productName, secondary: item.sku },
          { primary: item.warehouseName, secondary: item.warehouse },
          { primary: String(item.available) },
          { primary: String(item.reserved) },
          {
            primary: item.available === 0 ? "暂无可用库存" : "有可用库存",
            tone: item.available === 0 ? "amber" : "green",
          },
          { primary: date(item.updatedAt, true) },
        ],
      }));
    },
  },
  tickets: {
    title: "售后工单",
    subtitle: "查看已有售后工单、关联订单、问题描述与处理进度。",
    eyebrow: "AFTER-SALES CENTER",
    placeholder: "搜索工单号、订单号、客户或售后问题",
    filterLabel: "处理状态",
    icon: PackageCheck,
    columns: [
      "工单号 / 创建时间",
      "关联订单 / 客户",
      "售后类型",
      "问题描述",
      "处理状态",
      "优先级 / 预计响应",
    ],
    async load(signal) {
      return (await fetchBusinessList("tickets", signal)).map((ticket) => ({
        id: ticket.ticketId,
        createdAt: ticket.createdAt,
        ticket,
        filter: ticketStatuses[ticket.status] ?? ticket.status,
        cells: [
          { primary: ticket.ticketId, secondary: date(ticket.createdAt, true) },
          { primary: ticket.orderId, secondary: ticket.customerName },
          { primary: ticketTypes[ticket.type] ?? ticket.type },
          { primary: ticket.description },
          {
            primary: ticketStatuses[ticket.status] ?? ticket.status,
            tone: ticket.status === "CREATED" || ticket.status === "PROCESSING" ? "amber" : "green",
          },
          {
            primary: ticket.priority === "HIGH" ? "高优先级" : "普通",
            tone: ticket.overdue ? "red" : ticket.priority === "HIGH" ? "amber" : "muted",
            secondary: `${ticket.assigneeName ?? "未分配"} · ${ticket.overdue ? "响应已超时" : ticket.firstResponseAt ? "已响应" : `${ticket.estimatedResponseHours} 小时内响应`}`,
          },
        ],
      }));
    },
  },
};

export function BusinessWorkspace({
  module,
  revision,
}: {
  module: BusinessModule;
  revision: number;
}) {
  const { open, user } = useBusinessUI();
  const definition = modules[module];
  const Icon = definition.icon;
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [refreshCount, setRefreshCount] = useState(0);
  const [scope, setScope] = useState("all");
  const [priority, setPriority] = useState("");
  const [assignee, setAssignee] = useState("");
  const [quickView, setQuickView] = useState("all");
  const [sort, setSort] = useState("default");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const hasData = rows.length > 0;
  const dirty = !!(
    query ||
    filter ||
    priority ||
    assignee ||
    scope !== "all" ||
    quickView !== "all"
  );
  function clearFilters() {
    setQuery("");
    setFilter("");
    setPriority("");
    setAssignee("");
    setScope("all");
    setQuickView("all");
    setPage(1);
  }
  function matchesView(row: Row, view: string) {
    return (
      view === "all" ||
      (!!row.ticket &&
        (view === "mine"
          ? row.ticket.createdById === user.id
          : view === "assigned"
            ? row.ticket.assigneeId === user.id
            : view === "unassigned"
              ? !row.ticket.assigneeId && row.ticket.status === "CREATED"
              : view === "high" && row.ticket.priority === "HIGH"))
    );
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    definition
      .load(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setRows(result);
          setUpdatedAt(Date.now());
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "数据加载失败，请重试");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [definition, revision, refreshCount]);

  const options = useMemo(() => [...new Set(rows.map((row) => row.filter))], [rows]);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return rows.filter(
      (row) =>
        matchesView(row, quickView) &&
        (!row.ticket ||
          ((!priority || row.ticket.priority === priority) &&
            (!assignee || row.ticket.assigneeId === assignee) &&
            (scope === "all" ||
              (scope === "mine" && row.ticket.createdById === user.id) ||
              (scope === "unassigned" &&
                !row.ticket.assigneeId &&
                row.ticket.status === "CREATED") ||
              (scope === "assigned" && row.ticket.assigneeId === user.id)))) &&
        (!filter || row.filter === filter) &&
        row.cells.some((cell) =>
          `${cell.primary} ${cell.secondary ?? ""}`.toLocaleLowerCase().includes(keyword),
        ),
    );
  }, [rows, query, filter, priority, assignee, scope, user.id, quickView]);
  const sorted = useMemo(
    () =>
      sort === "default"
        ? filtered
        : [...filtered].sort((a, b) =>
            sort === "available"
              ? (a.available ?? 0) - (b.available ?? 0)
              : sort === "priority"
                ? Number(b.ticket?.priority === "HIGH") - Number(a.ticket?.priority === "HIGH")
                : sort === "oldest"
                  ? Date.parse(a.createdAt ?? "") - Date.parse(b.createdAt ?? "")
                  : Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? ""),
          ),
    [filtered, sort],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <section className="workspace business-workspace" aria-label={definition.title}>
      <div className="workspace-heading">
        <div>
          <h1>{definition.title}</h1>
          <p>{definition.subtitle}</p>
        </div>
        <span className="business-updated">
          {loading
            ? "正在刷新…"
            : updatedAt
              ? `更新于 ${new Date(updatedAt).toLocaleTimeString("zh-CN", { hour12: false })}`
              : "尚未加载"}
        </span>
      </div>
      <div className="business-card">
        <div className="business-views" aria-label="快捷视图">
          {(module === "tickets"
            ? [
                ["all", "全部"],
                ["unassigned", "待领取"],
                ["assigned", "分配给我"],
                ["mine", "我创建的"],
                ["high", "高优先级"],
              ]
            : [["all", module === "orders" ? "全部订单" : "全部库存"]]
          ).map(([key, label]) => (
            <button
              key={key}
              aria-pressed={quickView === key}
              onClick={() => {
                setQuickView(key);
                setPage(1);
              }}
            >
              {label}
              <small>{rows.filter((row) => matchesView(row, key)).length}</small>
            </button>
          ))}
        </div>
        <div className="business-toolbar">
          <label className="business-search">
            <Search size={16} aria-hidden="true" />
            <input
              aria-label={definition.placeholder}
              placeholder={definition.placeholder}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <select
            aria-label={definition.filterLabel}
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="">全部{definition.filterLabel}</option>
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          {module === "tickets" && (
            <>
              <select
                aria-label="工单范围"
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">全部工单</option>
                <option value="mine">我提交的</option>
                <option value="unassigned">待领取</option>
                <option value="assigned">我负责的</option>
              </select>
              <select
                aria-label="工单优先级"
                value={priority}
                onChange={(e) => {
                  setPriority(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">全部优先级</option>
                <option value="NORMAL">普通</option>
                <option value="HIGH">高优先级</option>
              </select>
              <select
                aria-label="筛选负责人"
                value={assignee}
                onChange={(e) => {
                  setAssignee(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">全部负责人</option>
                {[
                  ...new Map(
                    rows
                      .filter((r) => r.ticket?.assigneeId)
                      .map((r) => [r.ticket!.assigneeId!, r.ticket!.assigneeName ?? "历史负责人"]),
                  ).entries(),
                ].map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </>
          )}
          <select
            aria-label="列表排序"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(1);
            }}
          >
            <option value="default">默认排序</option>
            {module === "inventory" ? (
              <option value="available">可用量从低到高</option>
            ) : (
              <>
                <option value="newest">创建时间从新到旧</option>
                <option value="oldest">创建时间从旧到新</option>
                {module === "tickets" && <option value="priority">高优先级在前</option>}
              </>
            )}
          </select>
          {dirty && (
            <button className="business-refresh" onClick={clearFilters}>
              清除筛选
            </button>
          )}
          <button
            className="business-refresh"
            disabled={loading}
            onClick={() => setRefreshCount((count) => count + 1)}
          >
            <RefreshCw size={14} className={loading ? "business-spinning" : ""} />
            刷新
          </button>
        </div>
        {dirty && (
          <div className="filter-summary">
            已应用：
            {[
              query && `搜索「${query}」`,
              filter,
              priority && (priority === "HIGH" ? "高优先级" : "普通优先级"),
              assignee && "指定负责人",
              scope !== "all" && "工单范围",
              quickView !== "all" && "快捷视图",
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}
        {error && hasData && (
          <div className="refresh-error" role="alert">
            更新失败，当前为上次成功加载的数据。{error}
            <button onClick={() => setRefreshCount((v) => v + 1)}>重试</button>
          </div>
        )}
        {loading && !hasData ? (
          <div
            className="business-skeleton"
            role="status"
            aria-label={`正在加载${definition.title}数据`}
          >
            {[0, 1, 2, 3].map((i) => (
              <div key={i} />
            ))}
          </div>
        ) : error && !hasData ? (
          <div className="business-state" role="alert">
            <AlertCircle size={27} />
            <strong>数据加载失败</strong>
            <p>{error}</p>
            <button
              className="business-refresh"
              onClick={() => setRefreshCount((count) => count + 1)}
            >
              重新加载
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="business-state" role="status">
            <Icon size={30} />
            <strong>{rows.length ? "没有符合条件的记录" : "暂无记录"}</strong>
            <p>
              {rows.length
                ? "请尝试其他关键词或筛选条件。"
                : "当前没有可展示的数据，可稍后刷新查看。"}
            </p>
            {(query || filter || priority || assignee || scope !== "all") && (
              <button
                className="business-refresh"
                onClick={() => {
                  setQuery("");
                  setFilter("");
                  setPriority("");
                  setAssignee("");
                  setScope("all");
                  setPage(1);
                }}
              >
                清除筛选
              </button>
            )}
          </div>
        ) : (
          <div className="business-table-scroll">
            <table className="business-table">
              <caption className="business-sr-only">{definition.title}列表</caption>
              <thead>
                <tr>
                  {definition.columns.map((column) => (
                    <th key={column} scope="col">
                      {column}
                    </th>
                  ))}
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.id}>
                    {row.cells.map((cell, index) => (
                      <td
                        key={index}
                        className={`${module === "inventory" && (index === 2 || index === 3) ? "numeric-cell" : ""} ${module === "tickets" && index === 3 ? "description-cell" : ""}`}
                      >
                        {index === 0 && module !== "inventory" ? (
                          <button
                            className="business-id"
                            onClick={() =>
                              open({ kind: module === "orders" ? "order" : "ticket", id: row.id })
                            }
                          >
                            {cell.primary}
                          </button>
                        ) : (
                          <span
                            className={
                              cell.tone ? `business-badge ${cell.tone}` : "business-cell-primary"
                            }
                          >
                            {cell.primary}
                          </span>
                        )}
                        {cell.secondary && (
                          <span className="business-cell-secondary">{cell.secondary}</span>
                        )}
                      </td>
                    ))}
                    <td>
                      <button
                        onClick={() =>
                          open({
                            kind:
                              module === "orders"
                                ? "order"
                                : module === "tickets"
                                  ? "ticket"
                                  : "inventory",
                            id: module === "inventory" ? row.id.split(":")[0] : row.id,
                          })
                        }
                      >
                        {module === "inventory" ? "对比其他仓库" : "查看详情"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {hasData && (
          <div className="business-pagination">
            <span>
              共 {filtered.length} 条记录
              {filtered.length !== rows.length ? `（全部 ${rows.length} 条）` : ""} · 每页{" "}
              {PAGE_SIZE} 条
            </span>
            <div>
              <button
                aria-label="上一页"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              <span>
                {currentPage} / {pageCount}
              </span>
              <button
                aria-label="下一页"
                disabled={currentPage === pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
