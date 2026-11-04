import {
  ArrowRight,
  Boxes,
  Check,
  MessageSquareText,
  PackageCheck,
  Sparkles,
  Truck,
} from "lucide-react";
import type { MouseEventHandler } from "react";
import { BrandLogo } from "./BrandLogo";

type Props = { onEnter: MouseEventHandler<HTMLAnchorElement> };

const capabilities = [
  { icon: Truck, name: "订单查询", description: "订单明细、配送进度，随问随查。", number: "01" },
  { icon: Boxes, name: "库存查询", description: "商品与仓库库存，清晰掌握。", number: "02" },
  {
    icon: PackageCheck,
    name: "售后服务",
    description: "创建售后工单，跟进处理进度。",
    number: "03",
  },
];

export function LandingPage({ onEnter }: Props) {
  return (
    <div className="landing-page">
      <header className="landing-header">
        <div className="brand">
          <div className="brand-mark">
            <BrandLogo />
          </div>
          <div>
            <div className="brand-title">
              SalesPilot <span>AI</span>
            </div>
            <div className="brand-subtitle">销售订单智能助手</div>
          </div>
        </div>
        <a className="landing-header-entry" href="/workspace" onClick={onEnter}>
          进入工作台 <ArrowRight size={16} aria-hidden="true" />
        </a>
      </header>

      <main className="landing-main">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-copy">
            <div className="landing-eyebrow">
              <span /> YOUR BUSINESS COPILOT
            </div>
            <h1 id="landing-title">
              业务千头万绪，
              <br />
              <span>一句话，理清楚。</span>
            </h1>
            <p className="landing-description">
              从订单查询到库存管理，再到售后服务。
              <br className="landing-desktop-break" />让 SalesPilot
              帮你处理日常，把时间留给更重要的事。
            </p>
            <a className="landing-cta" href="/workspace" onClick={onEnter}>
              进入工作台 <ArrowRight size={20} aria-hidden="true" />
            </a>
            <p className="landing-entry-note">
              <Sparkles size={14} aria-hidden="true" /> 从一句需求，开始高效的一天
            </p>
          </div>

          <div className="landing-illustration" aria-hidden="true">
            <div className="landing-orbit landing-orbit-outer" />
            <div className="landing-orbit landing-orbit-inner" />
            <div className="landing-visual-caption">
              <span /> A LITTLE HELP. A LOT MORE CLARITY.
            </div>
            <div className="landing-preview">
              <div className="landing-preview-top">
                <div className="landing-preview-brand">
                  <BrandLogo />
                  <strong>SalesPilot</strong>
                  <span>AI</span>
                </div>
                <span className="landing-preview-label">工作方式示意</span>
              </div>
              <div className="landing-preview-message">
                <MessageSquareText size={18} />
                <span>帮我查一下这笔订单的配送进度</span>
              </div>
              <div className="landing-preview-connector">
                <span />
                <span />
                <span />
              </div>
              <div className="landing-preview-result">
                <div className="landing-preview-icon">
                  <Truck size={25} />
                </div>
                <div>
                  <strong>订单信息，清晰呈现</strong>
                  <p>商品明细 · 配送状态 · 预计送达</p>
                </div>
                <div className="landing-preview-check">
                  <Check size={16} />
                </div>
              </div>
              <div className="landing-preview-bottom">
                <Sparkles size={14} />
                <span>少一点繁琐，多一份从容。</span>
              </div>
            </div>
            <div className="landing-floating-note">
              <Boxes size={20} />
              <span>库存心中有数</span>
              <Check size={14} />
            </div>
            <div className="landing-visual-index">DESIGNED FOR YOUR EVERYDAY WORK</div>
          </div>
        </section>

        <section className="landing-capabilities" aria-label="主要功能">
          {capabilities.map(({ icon: Icon, name, description, number }) => (
            <article className="landing-capability" key={number}>
              <div className="landing-capability-icon">
                <Icon size={23} aria-hidden="true" />
              </div>
              <div>
                <h2>{name}</h2>
                <p>{description}</p>
              </div>
              <span className="landing-capability-number" aria-hidden="true">
                {number}
              </span>
            </article>
          ))}
        </section>
      </main>

      <footer className="landing-footer">
        <span>SalesPilot AI</span>
        <span>简化流程，专注业务。</span>
      </footer>
    </div>
  );
}
