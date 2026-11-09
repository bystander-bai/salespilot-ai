import { useEffect, useState, type FormEvent } from "react";
import { roleLabels, type PublicUser, type Role } from "@salespilot/contracts";
import { api } from "../api";

export function UserManagement({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("SALES");
  const load = () => api<PublicUser[]>("/users").then(setUsers);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await task();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  function create(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api("/users", {
        method: "POST",
        body: JSON.stringify({ username, name, password, role }),
      });
      setUsername("");
      setName("");
      setPassword("");
    });
  }
  function change(user: PublicUser, patch: object) {
    void run(() => api(`/users/${user.id}`, { method: "PATCH", body: JSON.stringify(patch) }));
  }
  return (
    <div className="drawer-backdrop">
      <section className="detail-drawer" role="dialog" aria-modal="true" aria-label="账号管理">
        <header>
          <h2>账号管理</h2>
          <button onClick={onClose}>关闭</button>
        </header>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <form className="stack-form" onSubmit={create}>
          <h3>创建团队成员</h3>
          <label>
            账号
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              maxLength={40}
              pattern="[a-zA-Z0-9_-]+"
              autoComplete="off"
            />
          </label>
          <label>
            显示名称
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
          </label>
          <label>
            初始密码
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={10}
              maxLength={128}
              required
              autoComplete="new-password"
            />
          </label>
          <label>
            角色
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {Object.entries(roleLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-button" disabled={busy}>
            创建账号
          </button>
        </form>
        <h3>团队成员</h3>
        {users.map((u) => (
          <article className="detail-item" key={u.id}>
            <strong>
              {u.name} · {u.username}
            </strong>
            <p>{u.enabled ? "已启用" : "已停用，未结工单需转派"}</p>
            <div className="action-row">
              <select
                aria-label={`${u.name}的角色`}
                value={u.role}
                disabled={busy}
                onChange={(e) => {
                  if (window.confirm("修改角色将使该账号重新登录，是否继续？"))
                    change(u, { role: e.target.value });
                }}
              >
                {Object.entries(roleLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <button
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`${u.enabled ? "停用" : "启用"}此账号？`))
                    change(u, { enabled: !u.enabled });
                }}
              >
                {u.enabled ? "停用" : "启用"}
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  const p = window.prompt("设置新密码（至少 10 位）");
                  if (p) change(u, { password: p });
                }}
              >
                重置密码
              </button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
