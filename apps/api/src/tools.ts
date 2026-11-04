import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  toolSchemas,
  type BusinessResult,
  type ToolName,
  type ToolArguments,
} from "@salespilot/contracts";
import type { ZodType } from "zod";
import { BusinessError } from "./errors.js";
import { getInventory } from "./tools/inventory.js";
import { getOrder } from "./tools/order.js";
import { createTicket } from "./tools/ticket.js";

type ToolCall = { [Name in ToolName]: { name: Name; args: ToolArguments[Name] } }[ToolName];

function parseArguments<T>(schema: ZodType<T>, args: unknown): T {
  const parsed = schema.safeParse(args);
  if (!parsed.success)
    throw new BusinessError(
      "INVALID_ARGUMENT",
      parsed.error.issues.map((issue) => issue.message).join("；"),
    );
  return parsed.data;
}

function parseToolCall(name: ToolName, args: unknown): ToolCall {
  switch (name) {
    case "get_order":
      return { name, args: parseArguments(toolSchemas.get_order, args) };
    case "get_inventory":
      return { name, args: parseArguments(toolSchemas.get_inventory, args) };
    case "create_after_sales_ticket":
      return { name, args: parseArguments(toolSchemas.create_after_sales_ticket, args) };
  }
}

export class BusinessTools {
  constructor(private readonly db: PrismaClient) {}

  async execute(
    name: ToolName,
    args: Record<string, unknown>,
    sessionId: string,
    requestId: string,
  ): Promise<BusinessResult> {
    const call = parseToolCall(name, args);
    try {
      const result = await this.run(call, sessionId);
      const reference =
        result.kind === "ticket"
          ? result.ticketId
          : result.kind === "order"
            ? result.orderId
            : result.sku;
      await this.writeLog(name, requestId, true, JSON.stringify({ reference }));
      return result;
    } catch (error) {
      await this.writeLog(
        name,
        requestId,
        false,
        error instanceof BusinessError ? error.code : "INTERNAL_ERROR",
      ).catch(() => undefined);
      throw error;
    }
  }

  private run(call: ToolCall, sessionId: string): Promise<BusinessResult> {
    switch (call.name) {
      case "get_order":
        return getOrder(this.db, call.args);
      case "get_inventory":
        return getInventory(this.db, call.args);
      case "create_after_sales_ticket":
        return createTicket(this.db, call.args, sessionId);
    }
  }

  private async writeLog(name: ToolName, requestId: string, success: boolean, detail: string) {
    await this.db.operationLog.create({
      data: { id: randomUUID(), action: name, requestId, success, detail },
    });
  }
}
