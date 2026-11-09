import { createContext, useContext } from "react";
import type { PublicUser, TicketDraft } from "@salespilot/contracts";

export type DetailTarget = {
  kind: "order" | "inventory" | "ticket" | "apply";
  id: string;
  draft?: TicketDraft;
};
export const BusinessUI = createContext<{
  user: PublicUser;
  open: (target: DetailTarget) => void;
  refresh: () => Promise<void>;
  sourceSessionId?: string;
  goSession: (id: string) => void;
} | null>(null);
export function useBusinessUI() {
  const context = useContext(BusinessUI);
  if (!context) throw new Error("业务页面缺少上下文");
  return context;
}
