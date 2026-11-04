import { z } from "zod";

export const toolNames = ["get_order", "get_inventory", "create_after_sales_ticket"] as const;
export type ToolName = (typeof toolNames)[number];
export type Mode = "demo" | "gateway" | "unconfigured";
export const chatSchema = z
  .object({
    sessionId: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9_-]+$/),
    message: z.string().trim().min(1, "请输入问题").max(2000, "问题最多 2000 字"),
    requestId: z.string().uuid().optional(),
  })
  .strict();
export type ChatRequest = z.infer<typeof chatSchema>;
export const orderSchema = z
  .object({
    orderId: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^SO\d{9,20}$/, "请提供 SO 开头的完整订单号"),
  })
  .strict();
export const inventorySchema = z
  .object({
    sku: z.string().trim().toUpperCase().min(1).max(64),
    warehouse: z.string().trim().toUpperCase().min(1).max(64),
  })
  .strict();
export const ticketSchema = orderSchema.extend({
  type: z.enum(["RETURN", "REPAIR", "EXCHANGE"]),
  description: z.string().trim().min(2, "请说明售后问题").max(1000),
  priority: z.enum(["NORMAL", "HIGH"]).default("NORMAL"),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});
export const toolSchemas = {
  get_order: orderSchema,
  get_inventory: inventorySchema,
  create_after_sales_ticket: ticketSchema,
};
export type OrderArguments = z.infer<typeof orderSchema>;
export type InventoryArguments = z.infer<typeof inventorySchema>;
export type TicketArguments = z.infer<typeof ticketSchema>;
export type ToolArguments = {
  get_order: OrderArguments;
  get_inventory: InventoryArguments;
  create_after_sales_ticket: TicketArguments;
};
export const orderStatusLabels: Record<string, string> = {
  PENDING: "待付款",
  PROCESSING: "处理中",
  SHIPPED: "已发货",
  DELIVERED: "已签收",
  CANCELLED: "已取消",
};
export type OrderResult = {
  kind: "order";
  orderId: string;
  status: string;
  customerName: string;
  items: { sku: string; name: string; quantity: number }[];
  estimatedDelivery: string | null;
};
export type InventoryResult = {
  kind: "inventory";
  sku: string;
  productName: string;
  warehouse: string;
  warehouseName: string;
  available: number;
  reserved: number;
  updatedAt: string;
};
export type TicketResult = {
  kind: "ticket";
  ticketId: string;
  orderId: string;
  status: string;
  type: string;
  description: string;
  estimatedResponseHours: number;
  duplicate: boolean;
};
export type BusinessResult = OrderResult | InventoryResult | TicketResult;
export const businessResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("order"),
    orderId: z.string().min(1),
    status: z.string().min(1),
    customerName: z.string(),
    items: z.array(
      z.object({ sku: z.string(), name: z.string(), quantity: z.number().int().positive() }),
    ),
    estimatedDelivery: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("inventory"),
    sku: z.string(),
    productName: z.string(),
    warehouse: z.string(),
    warehouseName: z.string(),
    available: z.number().int().nonnegative(),
    reserved: z.number().int().nonnegative(),
    updatedAt: z.string(),
  }),
  z.object({
    kind: z.literal("ticket"),
    ticketId: z.string().min(1),
    orderId: z.string().min(1),
    status: z.string(),
    type: z.string(),
    description: z.string(),
    estimatedResponseHours: z.number().positive(),
    duplicate: z.boolean(),
  }),
]);
export type ApiError = { code: string; message: string; requestId: string };
export type Source = { type: "database"; reference: string };
export type Step = { type: "tool"; name: ToolName; success: boolean };
export type ChatResponse = {
  runId: string;
  answer: string;
  intent: ToolName | "general" | "unsupported";
  mode: Mode;
  steps: Step[];
  sources: Source[];
  result?: BusinessResult;
  error?: ApiError;
};
export type AgentEventData = {
  "run.start": { runId: string; mode: Mode; replay?: boolean };
  intent: { intent: ToolName | "general"; label: string };
  arguments: { tool: ToolName; arguments: Record<string, unknown> };
  clarification: { fields: string[]; message: string };
  "tool.call": { tool: ToolName; arguments: Record<string, unknown>; attempt: number };
  "tool.result":
    | { tool: ToolName; success: true; result: BusinessResult }
    | { tool: ToolName; success: false; error: ApiError };
  retry: { message: string };
  "message.delta": { content: string };
  "run.error": ApiError;
  "run.done": ChatResponse | { runId: string; failed: true };
};
export type AgentEvent = {
  [Type in keyof AgentEventData]: { type: Type; data: AgentEventData[Type] };
}[keyof AgentEventData];
export type EventSink = (event: AgentEvent) => void;
export type Health = {
  status: "ok" | "degraded";
  database: "available" | "unavailable";
  modelGateway: "demo" | "configured" | "unconfigured";
  mode: Mode;
};
export type DashboardResponse = {
  orders: number;
  tickets: number;
  inventoryCount: number;
  inventory: { sku: string; name: string; warehouse: string; available: number }[];
  activity: { id: string; action: string; success: boolean; createdAt: string }[];
};

export type OrderListItem = Omit<OrderResult, "kind"> & { createdAt: string };
export type InventoryListItem = Omit<InventoryResult, "kind">;
export type TicketListItem = Omit<TicketResult, "kind" | "duplicate"> & {
  customerName: string;
  priority: string;
  createdAt: string;
};
export type BusinessLists = {
  orders: OrderListItem[];
  inventory: InventoryListItem[];
  tickets: TicketListItem[];
};
export type BusinessModule = keyof BusinessLists;
