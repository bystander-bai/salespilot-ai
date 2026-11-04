import type { Mode } from "@salespilot/contracts";

export const samples = [
  "帮我查一下订单 SO202611001 到哪里了？",
  "深圳仓 PHONE-001 还有多少库存？",
  "订单 SO202611001 的手机无法开机，帮我创建售后工单。",
  "查不到订单时应该怎么办？",
];

export const modeMeta: Record<Mode, { label: string; color: string; hint: string }> = {
  demo: {
    label: "演示模式",
    color: "#2b8064",
    hint: "本地确定性路由，数据可直接演示",
  },
  gateway: {
    label: "模型网关",
    color: "#5574c8",
    hint: "已配置模型网关，实际可用性以请求结果为准",
  },
  unconfigured: {
    label: "未配置",
    color: "#c35a4b",
    hint: "请配置模型网关或设置 AGENT_MODE=demo",
  },
};

export const welcomeMessage =
  "你好，我是 SalesPilot。\n我可以帮你查询订单、查询库存，或创建售后工单。";
