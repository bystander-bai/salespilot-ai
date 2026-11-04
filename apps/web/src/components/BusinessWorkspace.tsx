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
import { orderStatusLabels, type BusinessModule } from "@salespilot/contracts";
import { fetchBusinessList } from "../api";

type Cell = { primary: string; secondary?: string; tone?: "green" | "amber" | "muted" };
type Row = { id: string; filter: string; cells: Cell[] };
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
        filter: orderStatusLabels[order.status] ?? order.status,
        cells: [
          { primary: order.orderId, secondary: date(order.createdAt, true) },
          { primary: order.customerName },
          {
            primary: order.items.map((item) => `${item.name} × ${item.quantity}`).join("\n"),
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
            secondary: `${ticket.estimatedResponseHours} 小时内响应`,
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
  const definition = modules[module];
  const Icon = definition.icon;
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    definition
      .load(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setRows(result);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setRows([]);
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
        (!filter || row.filter === filter) &&
        row.cells.some((cell) =>
          `${cell.primary} ${cell.secondary ?? ""}`.toLocaleLowerCase().includes(keyword),
        ),
    );
  }, [rows, query, filter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <section className="workspace business-workspace" aria-label={definition.title}>
      <div className="workspace-heading">
        <div>
          <div className="eyebrow">{definition.eyebrow}</div>
          <h1>{definition.title}</h1>
          <p>{definition.subtitle}</p>
        </div>
        <div className="business-heading-icon">
          <Icon size={24} />
        </div>
      </div>
      <div className="business-card">
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
          <button
            className="business-refresh"
            disabled={loading}
            onClick={() => setRefreshCount((count) => count + 1)}
          >
            <RefreshCw size={14} className={loading ? "business-spinning" : ""} />
            刷新
          </button>
        </div>
        {loading ? (
          <div className="business-state" role="status">
            <RefreshCw className="business-spinning" size={25} />
            <strong>正在加载{definition.title}数据…</strong>
          </div>
        ) : error ? (
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
            {(query || filter) && (
              <button
                className="business-refresh"
                onClick={() => {
                  setQuery("");
                  setFilter("");
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
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.id}>
                    {row.cells.map((cell, index) => (
                      <td key={index}>
                        <span
                          className={
                            cell.tone ? `business-badge ${cell.tone}` : "business-cell-primary"
                          }
                        >
                          {cell.primary}
                        </span>
                        {cell.secondary && (
                          <span className="business-cell-secondary">{cell.secondary}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !error && (
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
