import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });
process.env.DATABASE_URL ??= "file:./dev.db";

export function readConfig() {
  const demo = (process.env.AGENT_MODE ?? "demo") === "demo";
  const baseURL = process.env.OPENAI_BASE_URL?.trim();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.MODEL_NAME?.trim();
  return {
    port: Number(process.env.PORT ?? 3000),
    corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
    mode: demo
      ? ("demo" as const)
      : baseURL && apiKey && model
        ? ("gateway" as const)
        : ("unconfigured" as const),
    baseURL,
    apiKey,
    model,
    modelTimeout: Number(process.env.MODEL_TIMEOUT_MS ?? 20000),
    toolTimeout: Number(process.env.TOOL_TIMEOUT_MS ?? 5000),
  };
}
export type Config = ReturnType<typeof readConfig>;
