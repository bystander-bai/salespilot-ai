import { Boxes, Clock3, PackageCheck, Truck } from "lucide-react";
import type { ReactNode } from "react";
import { orderStatusLabels as statusLabels, type BusinessResult } from "@salespilot/contracts";

export function ResultCard({ result }: { result: BusinessResult }) {
  if (result.kind === "order") return <OrderResult result={result} />;
  if (result.kind === "inventory") return <InventoryResult result={result} />;
  return <TicketResult result={result} />;
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
  const total = Math.max(result.available + result.reserved, 1);
  const width = `${Math.min(100, Math.max(8, (result.available / total) * 100))}%`;

  return (
    <div className="result-card">
      <ResultHeader
        icon={<Boxes size={15} />}
        tone="inventory"
        title={result.productName}
        subtitle={`${result.sku} · ${result.warehouseName}`}
        status={result.available === 0 ? "暂无可用库存" : "有可用库存"}
        statusClass="stock"
      />
      <div className="stock-bar">
        <div style={{ width }} />
      </div>
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
        status={result.status}
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
