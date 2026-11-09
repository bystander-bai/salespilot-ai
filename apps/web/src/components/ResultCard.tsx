import { Boxes, Clock3, PackageCheck, Truck } from "lucide-react";
import type { ReactNode } from "react";
import { orderStatusLabels as statusLabels, type BusinessResult } from "@salespilot/contracts";
import { ticketStatusLabels } from "@salespilot/contracts";
import { useBusinessUI } from "../business-ui";

export function ResultCard({ result }: { result: BusinessResult }) {
  const { open } = useBusinessUI();
  if (result.kind === "ticketDraft")
    return (
      <div className="result-card">
        <strong>售后申请草稿 · 尚未提交</strong>
        <p>
          {result.orderId} · {result.description}
        </p>
        <button
          className="primary-button"
          onClick={() => open({ kind: "apply", id: result.orderId, draft: result })}
        >
          确认售后申请
        </button>
      </div>
    );
  if (result.kind === "tickets")
    return (
      <div className="result-card">
        <strong>售后查询结果 · 历史快照</strong>
        {result.tickets.length ? (
          result.tickets.map((t) => (
            <button
              className="related-link"
              key={t.ticketId}
              onClick={() => open({ kind: "ticket", id: t.ticketId })}
            >
              {t.ticketId} · {ticketStatusLabels[t.status] ?? t.status} · 查看处理进度
            </button>
          ))
        ) : (
          <p>暂无匹配工单</p>
        )}
      </div>
    );
  return (
    <div>
      {result.kind === "order" ? (
        <OrderResult result={result} />
      ) : result.kind === "inventory" ? (
        <InventoryResult result={result} />
      ) : (
        <TicketResult result={result} />
      )}
      <div className="result-actions">
        <span className="muted">查询时快照</span>
        <button
          onClick={() =>
            open({
              kind:
                result.kind === "order"
                  ? "order"
                  : result.kind === "inventory"
                    ? "inventory"
                    : "ticket",
              id:
                result.kind === "order"
                  ? result.orderId
                  : result.kind === "inventory"
                    ? result.sku
                    : result.ticketId,
            })
          }
        >
          {result.kind === "order"
            ? "查看订单详情"
            : result.kind === "inventory"
              ? "对比其他仓库"
              : "查看处理进度"}
        </button>
        {result.kind === "order" && (
          <button
            title={
              !["SHIPPED", "DELIVERED"].includes(result.status)
                ? "只有已发货或已签收订单可申请售后"
                : undefined
            }
            disabled={!["SHIPPED", "DELIVERED"].includes(result.status)}
            onClick={() => open({ kind: "apply", id: result.orderId })}
          >
            申请售后
          </button>
        )}
        {result.kind === "order" && !["SHIPPED", "DELIVERED"].includes(result.status) && (
          <span className="muted">只有已发货或已签收订单可申请售后。</span>
        )}
      </div>
    </div>
  );
}

function OrderResult({ result }: { result: Extract<BusinessResult, { kind: "order" }> }) {
  return (
    <div className="result-card">
      <ResultHeader
        icon={<Truck size={15} />}
        tone="order"
        title={`订单 ${result.orderId}`}
        subtitle={result.customerName}
        status={statusLabels[result.status] ?? result.status}
      />
      <div className="result-details">
        {result.items.map((item) => (
          <span key={item.sku}>
            {item.name} × {item.quantity}
          </span>
        ))}
        <span>
          <Clock3 size={13} />
          {result.estimatedDelivery ? `${result.estimatedDelivery} 送达` : "暂无送达日期"}
        </span>
      </div>
    </div>
  );
}

function InventoryResult({ result }: { result: Extract<BusinessResult, { kind: "inventory" }> }) {
  return (
    <div className="result-card">
      <ResultHeader
        icon={<Boxes size={15} />}
        tone="inventory"
        title={result.productName}
        subtitle={`${result.sku} · ${result.warehouseName}`}
        status={result.available === 0 ? "暂无可用库存" : "有可用库存"}
        statusClass={result.available === 0 ? "stock-empty" : "stock"}
      />

      <div className="result-details">
        <span>
          可用库存 <b>{result.available}</b>
        </span>
        <span>
          预留库存 <b>{result.reserved}</b>
        </span>
      </div>
    </div>
  );
}

function TicketResult({ result }: { result: Extract<BusinessResult, { kind: "ticket" }> }) {
  return (
    <div className="result-card">
      <ResultHeader
        icon={<PackageCheck size={15} />}
        tone="ticket"
        title={result.duplicate ? "售后工单已存在" : "售后工单已创建"}
        subtitle={`${result.ticketId} · 订单 ${result.orderId}`}
        status={ticketStatusLabels[result.status] ?? result.status}
        statusClass="ticket-status"
      />
      <div className="result-details">
        <span>{result.description}</span>
        <span>
          <Clock3 size={13} />
          预计 {result.estimatedResponseHours} 小时响应
        </span>
      </div>
    </div>
  );
}

function ResultHeader({
  icon,
  tone,
  title,
  subtitle,
  status,
  statusClass = "",
}: {
  icon: ReactNode;
  tone: "order" | "inventory" | "ticket";
  title: string;
  subtitle: string;
  status: string;
  statusClass?: string;
}) {
  return (
    <div className="result-head">
      <div className={`result-icon ${tone}`}>{icon}</div>
      <div>
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      <span className={`result-status ${statusClass}`}>{status}</span>
    </div>
  );
}
