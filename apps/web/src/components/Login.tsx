import { useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Boxes,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  PackageCheck,
  Truck,
  UserRound,
} from "lucide-react";
import type { PublicUser } from "@salespilot/contracts";
import { api } from "../api";
import { BrandLogo } from "./BrandLogo";

export function Login({
  onLogin,
  notice = "",
  checking = false,
}: {
  onLogin: (user: PublicUser) => void;
  notice?: string;
  checking?: boolean;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState({ username: "", password: "" });
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const issues = {
      username: !username.trim()
        ? "请输入管理员分配的账号"
        : !/^[a-zA-Z0-9_-]{3,40}$/.test(username.trim())
          ? "账号需为 3～40 位字母、数字、下划线或短横线"
          : "",
      password: !password ? "请输入密码" : password.length > 128 ? "密码最多 128 位" : "",
    };
    setInvalid(issues);
    if (issues.username || issues.password) {
      (issues.username ? usernameRef : passwordRef).current?.focus();
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      onLogin(
        await api<PublicUser>("/auth/login", {
          method: "POST",
          body: JSON.stringify({ username: username.trim(), password }),
        }),
      );
    } catch (e) {
      setError(
        e instanceof TypeError
          ? "无法连接服务，请检查网络后重试。"
          : e instanceof Error
            ? e.message
            : "登录失败，请稍后重试。",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <header className="login-top">
        <a className="brand brand-link" href="/">
          <div className="brand-mark">
            <BrandLogo />
          </div>
          <div>
            <div className="brand-title">
              SalesPilot <span>AI</span>
            </div>
            <div className="brand-subtitle">销售订单智能助手</div>
          </div>
        </a>
        <a href="/" className="login-home">
          返回首页 <ArrowRight size={16} />
        </a>
      </header>
      <main className="login-layout">
        <section className="login-intro">
          <div className="login-eyebrow">你的业务协作伙伴</div>
          <h1>
            业务千头万绪，
            <br />
            <span>一句话，理清楚。</span>
          </h1>
          <p>
            订单、库存与售后，
            <br />
            在一个工作台中有序处理。
          </p>
          <div className="login-capabilities">
            {[
              { Icon: Truck, title: "订单查询", text: "从商品明细到配送进度，随时掌握。" },
              { Icon: Boxes, title: "库存查询", text: "按商品与仓库查库存，业务心中有数。" },
              { Icon: PackageCheck, title: "售后协同", text: "从申请到处理，每一步都有迹可循。" },
            ].map(({ Icon, title, text }, i) => (
              <div className="login-capability" key={title}>
                <span>
                  <Icon size={21} />
                </span>
                <div>
                  <strong>{title}</strong>
                  <small>{text}</small>
                </div>
                <b>0{i + 1}</b>
              </div>
            ))}
          </div>
          <small className="login-tagline">少一点繁琐，多一份从容。</small>
        </section>
        <section>
          <div className="login-card">
            <h2>登录 SalesPilot</h2>
            <p className="muted">进入团队销售与售后工作台</p>
            {checking ? (
              <div className="login-restoring" role="status">
                <LoaderCircle className="spin" />
                正在恢复登录状态…
              </div>
            ) : (
              <form onSubmit={submit} noValidate aria-busy={busy}>
                <label htmlFor="login-username">账号</label>
                <div className={`login-input ${invalid.username ? "invalid" : ""}`}>
                  <UserRound size={17} />
                  <input
                    id="login-username"
                    ref={usernameRef}
                    autoComplete="username"
                    placeholder="请输入管理员分配的账号"
                    value={username}
                    disabled={busy}
                    aria-invalid={!!invalid.username}
                    aria-describedby="username-error"
                    onChange={(e) => {
                      setUsername(e.target.value);
                      setInvalid((v) => ({ ...v, username: "" }));
                      setError("");
                    }}
                  />
                </div>
                <p className="field-error" id="username-error">
                  {invalid.username}
                </p>
                <label htmlFor="login-password">密码</label>
                <div className={`login-input ${invalid.password ? "invalid" : ""}`}>
                  <LockKeyhole size={17} />
                  <input
                    id="login-password"
                    ref={passwordRef}
                    type={visible ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="请输入密码"
                    value={password}
                    disabled={busy}
                    aria-invalid={!!invalid.password}
                    aria-describedby="password-error"
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setInvalid((v) => ({ ...v, password: "" }));
                      setError("");
                    }}
                  />
                  <button
                    type="button"
                    className="plain-icon"
                    onClick={() => setVisible((v) => !v)}
                    aria-label={visible ? "隐藏密码" : "显示密码"}
                    aria-pressed={visible}
                  >
                    {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <p className="field-error" id="password-error">
                  {invalid.password}
                </p>
                {(error || notice) && (
                  <p className="login-feedback" role="alert">
                    {error || notice}
                  </p>
                )}
                <button className="primary-button login-submit" disabled={busy}>
                  {busy ? (
                    <>
                      <LoaderCircle size={16} className="spin" />
                      正在登录…
                    </>
                  ) : (
                    <>
                      登录工作台 <ArrowRight size={16} />
                    </>
                  )}
                </button>
                <div className="login-help">
                  <span>账号由团队管理员分配</span>
                  <details>
                    <summary>无法登录？</summary>
                    <p>没有账号或忘记密码，请联系团队管理员获取账号或重置密码。</p>
                  </details>
                </div>
              </form>
            )}
          </div>
          <p className="login-security">
            <LockKeyhole size={13} />
            团队账号登录 · 按角色访问业务功能
          </p>
        </section>
      </main>
      <footer className="login-footer">SalesPilot AI · 简化流程，专注业务。</footer>
    </div>
  );
}
