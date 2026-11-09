import { z } from "zod";

export const toolNames = [
  "get_order",
  "get_inventory",
  "prepare_after_sales_ticket",
  "get_tickets",
] as const;
export type ToolName = (typeof toolNames)[number];
export const toolLabels: Record<ToolName, string> = {
  get_order: "查询订单",
  get_inventory: "查询库存",
  prepare_after_sales_ticket: "准备售后申请",
  get_tickets: "查询售后进度",
};
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
  prepare_after_sales_ticket: ticketSchema,
  get_tickets: z
    .object({
      orderId: orderSchema.shape.orderId.optional(),
      ticketId: z.string().trim().min(1).max(64).optional(),
    })
    .strict()
    .refine((v) => v.orderId || v.ticketId, "请提供订单号或工单号"),
};
export type OrderArguments = z.infer<typeof orderSchema>;
export type InventoryArguments = z.infer<typeof inventorySchema>;
export type TicketArguments = z.infer<typeof ticketSchema>;
export type ToolArguments = {
  get_order: OrderArguments;
  get_inventory: InventoryArguments;
  prepare_after_sales_ticket: TicketArguments;
  get_tickets: { orderId?: string; ticketId?: string };
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
  items: {
    orderItemId?: string;
    sku: string;
    name: string;
    quantity: number;
    availableForAfterSales?: number;
  }[];
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
export type TicketDraft = {
  kind: "ticketDraft";
  orderId: string;
  type: "RETURN" | "REPAIR" | "EXCHANGE";
  description: string;
  priority: "NORMAL" | "HIGH";
  idempotencyKey: string;
};
export type TicketSearchResult = { kind: "tickets"; orderId?: string; tickets: TicketListItem[] };
export type BusinessResult =
  OrderResult | InventoryResult | TicketResult | TicketDraft | TicketSearchResult;
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
  z.object({
    kind: z.literal("ticketDraft"),
    ...ticketSchema.shape,
    idempotencyKey: z.string().min(8),
  }),
  z.object({
    kind: z.literal("tickets"),
    orderId: z.string().optional(),
    tickets: z.array(
      z
        .object({
          ticketId: z.string(),
          orderId: z.string(),
          customerName: z.string(),
          status: z.string(),
          type: z.string(),
          description: z.string(),
          priority: z.string(),
          createdAt: z.string(),
          estimatedResponseHours: z.number(),
        })
        .passthrough(),
    ),
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
  trace?: TraceEvent[];
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
export type TraceEvent = Exclude<AgentEvent, { type: "run.start" | "run.done" | "message.delta" }>;
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
  createdById?: string | null;
  assigneeId?: string | null;
  assigneeName?: string | null;
  assigneeAvailable?: boolean;
  firstResponseAt?: string | null;
  overdue?: boolean;
};
export type BusinessLists = {
  orders: OrderListItem[];
  inventory: InventoryListItem[];
  tickets: TicketListItem[];
};
export type BusinessModule = keyof BusinessLists;

export const roles = ["ADMIN", "SERVICE", "SALES"] as const;
export type Role = (typeof roles)[number];
export const roleLabels: Record<Role, string> = { ADMIN: "管理员", SERVICE: "客服", SALES: "销售" };
export type PublicUser = {
  id: string;
  username: string;
  name: string;
  role: Role;
  enabled: boolean;
};
export const ticketStatusLabels: Record<string, string> = {
  CREATED: "待处理",
  PROCESSING: "处理中",
  RESOLVED: "已解决",
  CLOSED: "已关闭",
  CANCELLED: "已取消",
};
export const ticketTypeLabels: Record<string, string> = {
  RETURN: "退货",
  REPAIR: "维修",
  EXCHANGE: "换货",
};
export const createTicketSchema = ticketSchema
  .extend({
    idempotencyKey: z.string().uuid(),
    sourceSessionId: z.string().max(100).optional(),
    items: z
      .array(
        z
          .object({
            orderItemId: z.string().min(1).max(100),
            quantity: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export const ticketActionSchema = z
  .object({
    action: z.enum(["CLAIM", "ASSIGN", "NOTE", "RESOLVE", "CLOSE", "CANCEL"]),
    version: z.number().int().nonnegative(),
    requestId: z.string().uuid(),
    note: z.string().trim().max(2000).default(""),
    assigneeId: z.string().min(1).max(100).optional(),
  })
  .strict();
export type TicketActionInput = z.infer<typeof ticketActionSchema>;
export type TicketDetail = TicketListItem & {
  version: number;
  creatorName: string | null;
  fromChat: boolean;
  sourceSessionId: string | null;
  updatedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  items: { orderItemId: string; sku: string; name: string; quantity: number }[];
  events: {
    id: string;
    action: string;
    actorName: string;
    fromStatus: string;
    toStatus: string;
    note: string;
    assigneeName: string | null;
    createdAt: string;
  }[];
};
export type SessionSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  running: boolean;
};
export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  result?: BusinessResult;
  steps?: Step[];
  error?: string;
  runId?: string;
  trace?: TraceEvent[];
};
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
