import type {
  ChatResponse,
  DashboardResponse,
  BusinessResult,
  BusinessModule,
} from "@salespilot/contracts";

export type WorkspaceView = "workspace" | BusinessModule;

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  result?: BusinessResult;
  steps?: ChatResponse["steps"];
  error?: string;
  runId?: string;
};

export type ExecutionStep = {
  id: string;
  label: string;
  detail?: string;
  state: "running" | "done" | "error";
};

export type DashboardStats = DashboardResponse;

export type ActivityFilter = "all" | "order" | "inventory" | "ticket";

export const emptyDashboardStats: DashboardStats = {
  orders: 0,
  tickets: 0,
  inventoryCount: 0,
  inventory: [],
  activity: [],
};
