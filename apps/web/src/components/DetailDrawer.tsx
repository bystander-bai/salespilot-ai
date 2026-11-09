import { createPortal } from "react-dom";
import {
  createContext,
  useContext,
  useId,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  orderStatusLabels,
  ticketStatusLabels,
  ticketTypeLabels,
  type CreateTicketInput,
  type InventoryListItem,
  type OrderResult,
  type PublicUser,
  type TicketActionInput,
  type TicketDetail,
  type TicketListItem,
} from "@salespilot/contracts";
import { api } from "../api";
import { useBusinessUI, type DetailTarget } from "../business-ui";

const ActionsHost = createContext<HTMLDivElement | null>(null);
function DrawerActions({ children }: { children: ReactNode }) {
  const host = useContext(ActionsHost);
  return host ? createPortal(children, host) : null;
}
export const displayTime = (value?: string | null) =>
  value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "历史数据未记录";
export type ApplyDraft = {
  type: CreateTicketInput["type"];
  description: string;
  priority: CreateTicketInput["priority"];
  items: Record<string, number>;
  idempotencyKey: string;
  sourceSessionId?: string;
};
type Props = {
  target: DetailTarget;
  revision: number;
  onClose: () => void;
  guard: { current: (() => boolean) | null };
  drafts: Map<string, ApplyDraft>;
};
export function DetailDrawer({ target, revision, onClose, guard, drafts }: Props) {
  const dialog = useRef<HTMLElement>(null);
  const [actionsHost, setActionsHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    function keys(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Tab") {
        const elements = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
          ) ?? [],
        );
        const first = elements[0],
          last = elements.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === dialog.current)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", keys);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keys);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="drawer-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="detail-drawer"
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={target.kind === "apply" ? "售后申请" : "业务详情"}
      >
        <header>
          <h2>
            {target.kind === "order"
              ? "订单详情"
              : target.kind === "inventory"
                ? "跨仓库存"
                : target.kind === "apply"
                  ? "确认售后申请"
                  : "工单详情"}
          </h2>
          <button onClick={onClose}>关闭</button>
        </header>
        <ActionsHost.Provider value={actionsHost}>
          <div
            className="detail-content"
            key={`${target.kind}:${target.id}:${target.draft?.idempotencyKey ?? ""}`}
          >
            {target.kind === "order" ? (
              <OrderDetails id={target.id} revision={revision} />
            ) : target.kind === "inventory" ? (
              <InventoryDetails sku={target.id} revision={revision} />
            ) : target.kind === "ticket" ? (
              <TicketDetails id={target.id} revision={revision} />
            ) : (
              <TicketApply target={target} guard={guard} drafts={drafts} />
            )}
          </div>
        </ActionsHost.Provider>
        <div className="drawer-actions-host" ref={setActionsHost} />
      </section>
    </div>
  );
}

function OrderDetails({ id, revision }: { id: string; revision: number }) {
  const { open } = useBusinessUI();
  const [data, setData] = useState<OrderResult>();
  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    void Promise.all([
      api<OrderResult>(`/orders/${encodeURIComponent(id)}`, { signal: c.signal }),
      api<TicketListItem[]>(`/orders/${encodeURIComponent(id)}/tickets`, { signal: c.signal }),
    ])
      .then(([o, t]) => {
        setData(o);
        setTickets(t);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [id, revision]);
  if (error)
    return (
      <p role="alert" className="form-error">
        {error}
      </p>
    );
  if (!data) return <p role="status">正在加载…</p>;
  return (
    <>
      <h3>{data.orderId}</h3>
      <p>
        {data.customerName} · {orderStatusLabels[data.status] ?? data.status}
      </p>
      <p>预计送达：{data.estimatedDelivery ?? "暂无"}</p>
      <h3>订单商品</h3>
      {data.items.map((i) => (
        <article className="detail-item" key={i.orderItemId ?? i.sku}>
          <strong>
            {i.name} × {i.quantity}
          </strong>
          <p className="muted">
            {i.sku} · 可申请售后 {i.availableForAfterSales ?? i.quantity} 件
          </p>
          <button onClick={() => open({ kind: "inventory", id: i.sku })}>查询商品库存</button>
        </article>
      ))}
      <DrawerActions>
        <button
          className="primary-button"
          disabled={!["SHIPPED", "DELIVERED"].includes(data.status)}
          onClick={() => open({ kind: "apply", id: data.orderId })}
        >
          申请售后
        </button>
        {!["SHIPPED", "DELIVERED"].includes(data.status) && (
          <span className="muted">只有已发货或已签收订单可申请售后。</span>
        )}
      </DrawerActions>
      {!["SHIPPED", "DELIVERED"].includes(data.status) && (
        <p className="muted">只有已发货或已签收订单可以申请售后。</p>
      )}
      <h3>关联售后工单</h3>
      {tickets.length ? (
        tickets.map((t) => (
          <button
            className="related-link"
            key={t.ticketId}
            onClick={() => open({ kind: "ticket", id: t.ticketId })}
          >
            {t.ticketId} · {ticketTypeLabels[t.type]} · {ticketStatusLabels[t.status]}
          </button>
        ))
      ) : (
        <p className="muted">暂无售后工单</p>
      )}
    </>
  );
}
function InventoryDetails({ sku, revision }: { sku: string; revision: number }) {
  const [rows, setRows] = useState<InventoryListItem[]>([]);
  const [warehouse, setWarehouse] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const c = new AbortController();
    void api<InventoryListItem[]>(`/inventory?sku=${encodeURIComponent(sku)}`, { signal: c.signal })
      .then(setRows)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [sku, revision]);
  return (
    <>
      <h3>{rows[0]?.productName ?? sku}</h3>
      <p className="muted">{sku} · 最新库存</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <label>
        仓库
        <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
          <option value="">全部仓库</option>
          {rows.map((r) => (
            <option key={r.warehouse} value={r.warehouse}>
              {r.warehouseName}
            </option>
          ))}
        </select>
      </label>
      {loading ? (
        <p>正在加载…</p>
      ) : !rows.length ? (
        <p>没有库存记录</p>
      ) : (
        rows
          .filter((r) => !warehouse || r.warehouse === warehouse)
          .map((r) => (
            <article className="detail-item" key={r.warehouse}>
              <strong>{r.warehouseName}</strong>
              <p>
                可用库存：{r.available} · 预留库存：{r.reserved}
              </p>
              <p className="muted">更新于 {displayTime(r.updatedAt)}</p>
            </article>
          ))
      )}
    </>
  );
}
function TicketApply({ target, guard, drafts }: Pick<Props, "target" | "guard" | "drafts">) {
  const formId = useId();
  const { open, refresh, sourceSessionId } = useBusinessUI();
  const key = target.draft?.idempotencyKey ?? target.id;
  const [form, setForm] = useState<ApplyDraft>(
    () =>
      drafts.get(key) ?? {
        type: target.draft?.type ?? "REPAIR",
        description: target.draft?.description ?? "",
        priority: target.draft?.priority ?? "NORMAL",
        items: {},
        idempotencyKey: target.draft?.idempotencyKey ?? crypto.randomUUID(),
        sourceSessionId: target.draft ? sourceSessionId : undefined,
      },
  );
  const [order, setOrder] = useState<OrderResult>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const dirty = form.description.length > 0 || Object.values(form.items).some((n) => n > 0);
  useEffect(() => {
    drafts.set(key, form);
  }, [form, key, drafts]);
  useEffect(() => {
    guard.current = () =>
      !busy && (!dirty || window.confirm("存在未提交的申请，确定离开并保留草稿？取消可继续填写。"));
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      guard.current = null;
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [dirty, busy, guard]);
  useEffect(() => {
    const c = new AbortController();
    void api<OrderResult>(`/orders/${encodeURIComponent(target.id)}`, { signal: c.signal })
      .then(setOrder)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [target.id]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const items = Object.entries(form.items)
      .filter(([, n]) => n > 0)
      .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
    if (!items.length) {
      setError("请至少选择一件商品并填写数量");
      return;
    }
    if (!review) {
      setReview(true);
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ ticket: TicketDetail; duplicate: boolean }>("/tickets", {
        method: "POST",
        body: JSON.stringify({
          orderId: target.id,
          type: form.type,
          description: form.description,
          priority: form.priority,
          idempotencyKey: form.idempotencyKey,
          sourceSessionId: form.sourceSessionId,
          items,
        }),
      });
      drafts.delete(key);
      guard.current = null;
      await refresh();
      open({ kind: "ticket", id: result.ticket.ticketId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }
  if (!order) return <p role={error ? "alert" : "status"}>{error || "正在加载订单…"}</p>;
  const allowed = ["SHIPPED", "DELIVERED"].includes(order.status);
  return (
    <form id={formId} className="stack-form" onSubmit={submit}>
      <h3>
        {order.orderId} · {order.customerName}
      </h3>
      <p className="muted">
        {review ? "请核对申请内容，点击确认提交后才会创建工单。" : "选择商品和数量后核对申请。"}
      </p>
      {!allowed && <p className="form-error">当前订单状态不支持申请售后</p>}
      <fieldset disabled={review || busy || !allowed}>
        <legend>申请商品与数量</legend>
        {order.items.map((i) => (
          <label className="quantity-row" key={i.orderItemId}>
            {i.name}（可申请 {i.availableForAfterSales ?? i.quantity}）
            <input
              aria-label={`${i.name}申请数量`}
              type="number"
              min={0}
              step={1}
              max={i.availableForAfterSales ?? i.quantity}
              value={form.items[i.orderItemId!] ?? 0}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  items: { ...f.items, [i.orderItemId!]: Number(e.target.value) },
                }))
              }
            />
          </label>
        ))}
      </fieldset>
      {review && (
        <div className="detail-item">
          {order.items
            .filter((i) => (form.items[i.orderItemId!] ?? 0) > 0)
            .map((i) => (
              <p key={i.orderItemId}>
                {i.name} × {form.items[i.orderItemId!]}
              </p>
            ))}
        </div>
      )}
      <label>
        售后类型
        <select
          value={form.type}
          disabled={review || busy}
          onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ApplyDraft["type"] }))}
        >
          {Object.entries(ticketTypeLabels).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label>
        问题描述
        <textarea
          value={form.description}
          readOnly={review}
          disabled={busy}
          required
          minLength={2}
          maxLength={1000}
          rows={4}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </label>
      <label>
        优先级
        <select
          disabled={review || busy}
          value={form.priority}
          onChange={(e) =>
            setForm((f) => ({ ...f, priority: e.target.value as ApplyDraft["priority"] }))
          }
        >
          <option value="NORMAL">普通 · 24 小时内响应</option>
          <option value="HIGH">高优先级 · 8 小时内响应</option>
        </select>
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <DrawerActions>
        <div className="action-row apply-actions">
          {review && (
            <button type="button" disabled={busy} onClick={() => setReview(false)}>
              返回修改
            </button>
          )}
          <button form={formId} className="primary-button" disabled={busy || !allowed}>
            {busy ? "正在提交…" : review ? "确认提交" : "核对申请"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm("放弃这份售后申请草稿？")) return;
              drafts.delete(key);
              guard.current = null;
              open({ kind: "order", id: target.id });
            }}
          >
            放弃草稿
          </button>
        </div>
      </DrawerActions>
    </form>
  );
}
function TicketDetails({ id, revision }: { id: string; revision: number }) {
  const { user, open, refresh, goSession } = useBusinessUI();
  const [ticket, setTicket] = useState<TicketDetail>();
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [usersError, setUsersError] = useState("");
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersRevision, setUsersRevision] = useState(0);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [counter, setCounter] = useState(0);
  const actionBusy = useRef(false);
  const pendingAction = useRef<{ key: string; requestId: string } | null>(null);
  useEffect(() => {
    const c = new AbortController();
    void api<TicketDetail>(`/tickets/${encodeURIComponent(id)}`, { signal: c.signal })
      .then((t) => {
        setTicket(t);
        if (counter === 0) setError("");
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [id, revision, counter]);
  useEffect(() => {
    if (user.role !== "ADMIN") return;
    const c = new AbortController();
    setUsersLoading(true);
    setUsersError("");
    void api<PublicUser[]>("/users/assignees", { signal: c.signal })
      .then(setUsers)
      .catch((e) => {
        if (!c.signal.aborted) setUsersError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setUsersLoading(false);
      });
    return () => c.abort();
  }, [user.role, usersRevision]);
  async function act(action: TicketActionInput["action"]) {
    if (!ticket || actionBusy.current) return;
    if (action === "ASSIGN" && (!assigneeId || assigneeId === ticket.assigneeId)) return;
    if (["CANCEL", "RESOLVE", "NOTE"].includes(action) && !note.trim()) {
      setError("请先填写处理说明或原因");
      return;
    }
    if (action === "CANCEL" && !window.confirm("确认取消此工单？")) return;
    const key = JSON.stringify({ action, note, assigneeId, version: ticket.version });
    if (pendingAction.current?.key !== key)
      pendingAction.current = { key, requestId: crypto.randomUUID() };
    actionBusy.current = true;
    setBusy(true);
    setError("");
    try {
      const t = await api<TicketDetail>(`/tickets/${ticket.ticketId}/actions`, {
        method: "POST",
        body: JSON.stringify({
          action,
          version: ticket.version,
          requestId: pendingAction.current.requestId,
          note,
          ...(action === "ASSIGN" ? { assigneeId } : {}),
        }),
      });
      setTicket(t);
      setNote("");
      setAssigneeId("");
      pendingAction.current = null;
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
      setCounter((v) => v + 1);
    } finally {
      actionBusy.current = false;
      setBusy(false);
    }
  }
  if (!ticket) return <p role={error ? "alert" : "status"}>{error || "正在加载工单…"}</p>;
  const handler =
    user.role === "ADMIN" || (user.role === "SERVICE" && ticket.assigneeId === user.id);
  const terminal = ["CLOSED", "CANCELLED"].includes(ticket.status);
  const actions = {
    CREATE: "创建申请",
    CLAIM: "领取工单",
    ASSIGN: "分配 / 转派",
    NOTE: "追加备注",
    RESOLVE: "标记已解决",
    CLOSE: "关闭工单",
    CANCEL: "取消工单",
  };
  return (
    <>
      <h3>
        {ticket.ticketId}{" "}
        <span className="business-badge amber">{ticketStatusLabels[ticket.status]}</span>
      </h3>
      <button className="related-link" onClick={() => open({ kind: "order", id: ticket.orderId })}>
        {ticket.orderId} · {ticket.customerName}
      </button>
      <p>
        {ticketTypeLabels[ticket.type]} · {ticket.priority === "HIGH" ? "高优先级" : "普通"}
      </p>
      <p>{ticket.description}</p>
      <div className="detail-item">
        <p>申请人：{ticket.creatorName ?? "历史数据未记录"}</p>
        <p>负责人：{ticket.assigneeName ?? "未分配"}</p>
        {ticket.assigneeId &&
          !ticket.assigneeAvailable &&
          !["CLOSED", "CANCELLED"].includes(ticket.status) && (
            <p className="form-error">负责人已停用或不再具备处理权限，请管理员转派。</p>
          )}
        <p>创建：{displayTime(ticket.createdAt)}</p>
        <p>
          首次响应：
          {ticket.firstResponseAt
            ? displayTime(ticket.firstResponseAt)
            : `${ticket.estimatedResponseHours} 小时内响应`}
          {ticket.overdue && <strong className="form-error"> · 已超时</strong>}
        </p>
        <p>解决：{ticket.resolvedAt ? displayTime(ticket.resolvedAt) : "尚未解决"}</p>
        {ticket.closedAt && <p>结束：{displayTime(ticket.closedAt)}</p>}
      </div>
      <h3>售后商品</h3>
      {ticket.items.length ? (
        ticket.items.map((i) => (
          <p key={i.orderItemId}>
            {i.name}（{i.sku}）× {i.quantity}
          </p>
        ))
      ) : (
        <p className="muted">历史数据未记录商品及数量</p>
      )}
      {ticket.fromChat &&
        (ticket.sourceSessionId ? (
          <button onClick={() => goSession(ticket.sourceSessionId!)}>返回来源会话</button>
        ) : (
          <p className="muted">由智能对话发起</p>
        ))}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button disabled={busy} onClick={() => setCounter((v) => v + 1)}>
        刷新工单
      </button>
      <h3>处理时间线</h3>
      <ol className="ticket-timeline">
        {ticket.events.map((e) => (
          <li key={e.id}>
            <strong>
              {actions[e.action as keyof typeof actions] ?? e.action} · {e.actorName}
            </strong>
            <time>{displayTime(e.createdAt)}</time>
            <p>
              {ticketStatusLabels[e.fromStatus] ?? "新申请"} → {ticketStatusLabels[e.toStatus]}
            </p>
            {e.assigneeName && <p>负责人：{e.assigneeName}</p>}
            {e.note && <p>{e.note}</p>}
          </li>
        ))}
      </ol>
      {!ticket.events.length && <p className="muted">历史工单暂无处理记录</p>}
      {!terminal && (
        <div className="stack-form ticket-actions">
          <h3>处理工单</h3>
          {(handler || (ticket.status === "CREATED" && ticket.createdById === user.id)) && (
            <label>
              处理说明 / 取消原因
              <textarea
                rows={3}
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          )}
          <DrawerActions>
            <div className="action-row ticket-operation-buttons">
              {ticket.status === "CREATED" && !ticket.assigneeId && user.role !== "SALES" && (
                <button
                  className={user.role === "SERVICE" ? "primary-button" : "secondary-button"}
                  disabled={busy}
                  onClick={() => void act("CLAIM")}
                >
                  领取工单
                </button>
              )}
              {handler && (
                <button disabled={busy} onClick={() => void act("NOTE")}>
                  追加备注
                </button>
              )}
              {handler && ticket.status === "PROCESSING" && (
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => void act("RESOLVE")}
                >
                  标记已解决
                </button>
              )}
              {handler && ticket.status === "RESOLVED" && (
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => void act("CLOSE")}
                >
                  关闭工单
                </button>
              )}
              {["CREATED", "PROCESSING"].includes(ticket.status) &&
                (user.role === "ADMIN" ||
                  (ticket.status === "CREATED" && ticket.createdById === user.id)) && (
                  <button disabled={busy} onClick={() => void act("CANCEL")}>
                    取消工单
                  </button>
                )}
            </div>
          </DrawerActions>
          {user.role === "ADMIN" && ["CREATED", "PROCESSING"].includes(ticket.status) && (
            <section className="assignment-section">
              <h3>{ticket.assigneeId ? "转派处理人" : "分配处理人"}</h3>
              <p className="muted">当前负责人：{ticket.assigneeName ?? "未分配"}</p>
              {usersLoading && <p role="status">正在加载可用处理人…</p>}
              {usersError && (
                <p className="form-error" role="alert">
                  {usersError}
                  <button onClick={() => setUsersRevision((v) => v + 1)}>重新加载处理人</button>
                </p>
              )}
              {!usersLoading && !usersError && !users.length && (
                <p className="muted">暂无可用处理人，请先在账号管理中启用管理员或客服账号。</p>
              )}
              <div className="action-row">
                <select
                  aria-label="工单负责人"
                  disabled={busy || usersLoading || !!usersError}
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                >
                  <option value="">选择负责人</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
                <DrawerActions>
                  <button
                    className="primary-button"
                    disabled={
                      busy ||
                      usersLoading ||
                      !!usersError ||
                      !assigneeId ||
                      assigneeId === ticket.assigneeId
                    }
                    onClick={() => void act("ASSIGN")}
                  >
                    {busy ? "正在提交…" : ticket.assigneeId ? "确认转派" : "确认分配"}
                  </button>
                </DrawerActions>
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
