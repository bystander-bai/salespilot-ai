import { Check, LoaderCircle, Minus, X, AlertCircle } from "lucide-react";
import type { ReactNode } from "react";
import {
  buildExecutionChain,
  readableArguments,
  toolLabel,
  type ChainStatus,
} from "../execution-chain";
import type { Message } from "../types";
const labels: Record<ChainStatus, string> = {
  done: "已完成",
  running: "执行中",
  waiting: "等待补充／确认",
  error: "失败",
  idle: "未执行",
  skipped: "无需调用",
};
function Stage({
  title,
  status,
  children,
}: {
  title: string;
  status: ChainStatus;
  children: ReactNode;
}) {
  const Icon =
    status === "done"
      ? Check
      : status === "running"
        ? LoaderCircle
        : status === "waiting"
          ? AlertCircle
          : status === "error"
            ? X
            : Minus;
  return (
    <section className={`chain-stage ${status}`}>
      <span className="stage-dot">
        <Icon size={13} className={status === "running" ? "spin" : undefined} />
      </span>
      <div className="stage-title">
        <strong>{title}</strong>
        <span>{labels[status]}</span>
      </div>
      {children}
    </section>
  );
}
function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="chain-field">
      <span>{name}</span>
      <div>{children}</div>
    </div>
  );
}
export function ExecutionChain({
  message,
  question,
  loading,
}: {
  message?: Message;
  question?: string;
  loading: boolean;
}) {
  if (!message || message.id === "welcome")
    return <div className="chain-empty">发送一条消息后，这里会显示执行过程。</div>;
  const chain = buildExecutionChain(message, loading);
  if (!chain.recorded && !loading)
    return (
      <div className="chain-empty">
        该次执行未记录链路。<p>{message.error || "可以查看对应的对话回复。"}</p>
      </div>
    );
  return (
    <div className="execution-chain" aria-label="本次执行链路" aria-busy={loading}>
      {question && (
        <div className="chain-context">
          <small>对应需求</small>
          <p>{question}</p>
        </div>
      )}
      <div className={`chain-summary ${chain.status}`}>
        {chain.status === "running"
          ? "正在处理你的需求"
          : chain.status === "waiting"
            ? message.result?.kind === "ticketDraft"
              ? "草稿已准备，等待确认"
              : "等待补充信息"
            : chain.status === "error"
              ? "本次处理未完成"
              : "本次处理已完成"}
      </div>
      <Stage title="思考" status={chain.thought}>
        <Field name="理解需求">
          {chain.intent ? `根据需求进行${chain.intent}。` : "该次执行未单独记录需求识别"}
        </Field>
        <Field name="识别业务">{chain.intent || "未记录"}</Field>
        <Field name="查询条件">{readableArguments(chain.args)}</Field>
        <Field name="参数校验">{chain.validation}</Field>
      </Stage>
      <Stage title="调用" status={chain.callStatus}>
        {chain.calls.map((call, i) => (
          <div key={i}>
            {call.dependency && <p className="chain-dependency">↓ {call.dependency}</p>}
            <div className={`chain-call ${call.status}`}>
              <div>
                <strong>
                  {chain.calls.length > 1 ? `${i + 1}. ` : ""}
                  {toolLabel(call.tool)}
                </strong>
                <span>{labels[call.status]}</span>
              </div>
              <code>{call.tool}</code>
              <Field name="关键参数">{readableArguments(call.args)}</Field>
              {call.attempt > 1 && <p>第 {call.attempt} 次尝试（重试）</p>}
              <p>{call.summary}</p>
            </div>
          </div>
        ))}
        {!chain.calls.length && (
          <p>
            {chain.callStatus === "skipped"
              ? "本次回复无需调用业务工具。"
              : chain.clarification
                ? "等待补充信息，尚未调用工具。"
                : "尚未调用业务工具。"}
          </p>
        )}
      </Stage>
      <Stage title="结果" status={chain.resultStatus}>
        <Field name="结果校验">
          {loading || chain.clarification
            ? "等待产生结果"
            : message.result
              ? "已获得可展示的业务结果；独立校验过程未单独记录"
              : "未单独记录"}
        </Field>
        <div className={`chain-result ${chain.status}`}>{chain.summary}</div>
        <Field name="展示状态">
          {loading
            ? "等待执行完成"
            : chain.clarification
              ? "已在对话中追问，后续步骤未执行"
              : message.error
                ? "已展示错误提示，可重新发送需求"
                : message.result?.kind === "ticketDraft"
                  ? "已展示草稿卡片；用户确认前不会创建工单"
                  : message.result
                    ? "已在对话中展示结果卡片"
                    : "已展示对话回复"}
        </Field>
      </Stage>
      <p className="chain-caption">
        “思考”展示需求理解摘要，不展示模型内部推理。链路来自本次实际执行记录。
      </p>
    </div>
  );
}
