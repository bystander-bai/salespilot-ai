import { test, expect, type Page } from "@playwright/test";
import { testPassword } from "../fixtures";

test("localhost 别名通过同源代理登录、刷新及注销", async ({ page }) => {
  await page.goto("http://localhost:4173/workspace");
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill(testPassword);
  await page.getByRole("button", { name: "登录工作台", exact: true }).click();
  await expect(page.getByText("历史会话 · 仅自己可见")).toBeVisible();
  await page.reload();
  await expect(page.getByText("历史会话 · 仅自己可见")).toBeVisible();
  await page.getByLabel("账号菜单").click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "登录工作台", exact: true })).toBeVisible();
  const response = await page.request.get("http://localhost:4173/api/auth/me");
  expect(response.status()).toBe(401);
});

async function login(page: Page, username: string) {
  await page.goto("/workspace");
  await page.getByLabel("账号", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(testPassword);
  await page.getByRole("button", { name: "登录工作台", exact: true }).click();
  await expect(page.getByText("历史会话 · 仅自己可见")).toBeVisible();
}
test("查询联动、保存会话、售后确认和客服处理", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, "sales");
  await page.getByLabel("业务需求").fill("查询订单 SO202611003");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: "查看订单详情" })).toBeVisible();
  await expect(page).toHaveURL(/session=/);
  const chatUrl = page.url();
  await page.reload();
  await expect(page.getByRole("button", { name: "查看订单详情" })).toBeVisible();
  await page.getByRole("button", { name: "查看订单详情" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "订单详情" })).toBeVisible();
  await dialog.getByRole("button", { name: "查询商品库存" }).first().click();
  await expect(dialog.getByRole("heading", { name: "跨仓库存" })).toBeVisible();
  await expect(dialog.locator("strong").filter({ hasText: "深圳一号仓" })).toBeVisible();
  await page.goBack();
  await expect(dialog.getByRole("heading", { name: "订单详情" })).toBeVisible();
  await dialog.getByRole("button", { name: "申请售后", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "确认售后申请" })).toBeVisible();
  await dialog.locator('input[type="number"]').first().fill("1");
  await dialog.getByLabel("问题描述").fill("耳机无法正常使用，请维修");
  await dialog.getByRole("button", { name: "核对申请", exact: true }).click();
  await expect(dialog.getByText("请核对申请内容，点击确认提交后才会创建工单。")).toBeVisible();
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "工单详情" })).toBeVisible();
  await expect(dialog.getByText("待处理", { exact: true }).first()).toBeVisible();
  const ticketId = new URL(page.url()).searchParams.get("id")!;
  const ticketUrl = page.url();
  const serviceContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    baseURL: "http://127.0.0.1:4173",
  });
  const service = await serviceContext.newPage();
  await login(service, "service");
  await service.goto(ticketUrl);
  const serviceDialog = service.getByRole("dialog");
  await serviceDialog.getByRole("button", { name: "领取工单", exact: true }).click();
  await expect(serviceDialog.getByRole("button", { name: "标记已解决" })).toBeVisible();
  await serviceDialog.getByLabel("处理说明 / 取消原因").fill("已维修并联系客户确认");
  await serviceDialog.getByRole("button", { name: "标记已解决" }).click();
  await serviceDialog.getByRole("button", { name: "关闭工单", exact: true }).click();
  await expect(serviceDialog.getByText("已关闭", { exact: true }).first()).toBeVisible();
  await serviceContext.close();
  await page.reload();
  await expect(page.getByRole("dialog").getByText("已关闭", { exact: true }).first()).toBeVisible();
  await page.screenshot({
    path: `.cache/workflow-${test.info().project.name}.png`,
    fullPage: false,
  });
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
  await page.goto(chatUrl);
  await page.getByLabel("业务需求").fill(`查询工单 ${ticketId} 的进度`);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: new RegExp(`${ticketId}.*已关闭`) })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  expect(errors).toEqual([]);
});
test("对话只生成草稿、历史搜索重命名、私有会话及页面导航", async ({ page, browser }) => {
  await login(page, "sales2");
  await page.getByLabel("业务需求").fill("订单 SO202611005 的手机无法开机，帮我申请维修");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("售后申请草稿 · 尚未提交")).toBeVisible();
  const privateUrl = page.url();
  await page.getByLabel("搜索历史会话").fill("无法开机");
  await page.getByLabel(/会话操作 订单 SO202611005/).click();
  await expect(page.getByRole("button", { name: /重命名 订单 SO202611005/ })).toBeVisible();
  const title = `我的维修跟进-${test.info().project.name}`;
  page.once("dialog", (dialog) => dialog.accept(title));
  await page.getByRole("button", { name: /重命名 订单 SO202611005/ }).click();
  await page.getByLabel("搜索历史会话").fill(title);
  await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认售后申请" }).click();
  await expect(page.getByRole("dialog").getByLabel("问题描述")).toHaveValue("无法开机");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "订单查询", exact: true }).click();
  await expect(page).toHaveURL(/view=orders/);
  await page.getByPlaceholder("搜索订单号、客户、商品或 SKU").fill("SO202611005");
  await page.getByRole("button", { name: "查看详情", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "订单详情" })).toBeVisible();
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:4173" });
  const otherPage = await other.newPage();
  await login(otherPage, "admin");
  await otherPage.goto(privateUrl);
  await expect(otherPage.getByRole("button", { name: "确认售后申请" })).toHaveCount(0);
  const response = await otherPage.request.get(
    `/api/sessions/${new URL(privateUrl).searchParams.get("session")}/messages`,
  );
  expect(response.status()).toBe(404);
  await other.close();
});

test("桌面登录反馈、密码显隐与辅助面板链路", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/workspace");
  await expect(page.getByRole("button", { name: "登录工作台", exact: true })).toBeEnabled();
  await page.screenshot({ path: ".cache/ui-login-desktop.png" });
  await page.getByRole("button", { name: "登录工作台", exact: true }).click();
  await expect(page.getByText("请输入管理员分配的账号", { exact: true })).toBeVisible();
  await page.getByLabel("密码", { exact: true }).fill("incorrect-password");
  await page.getByRole("button", { name: "显示密码", exact: true }).click();
  await expect(page.getByLabel("密码", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "隐藏密码", exact: true }).click();
  await page.getByText("无法登录？", { exact: true }).click();
  await expect(
    page.getByText("没有账号或忘记密码，请联系团队管理员获取账号或重置密码。"),
  ).toBeVisible();
  await page.getByLabel("账号", { exact: true }).fill("sales");
  await page.getByRole("button", { name: "登录工作台", exact: true }).click();
  await expect(page.locator(".login-feedback")).toBeVisible();
  await page.getByLabel("密码", { exact: true }).fill(testPassword);
  await page.getByRole("button", { name: "登录工作台", exact: true }).click();
  await expect(page.locator(".chat-welcome")).toBeVisible();
  await page.screenshot({ path: ".cache/ui-welcome-desktop.png" });
  await expect(page.getByLabel("辅助面板", { exact: true })).toHaveCount(0);
  await page.locator(".welcome-actions button").first().click();
  await expect(page.getByLabel("业务需求")).not.toHaveValue("");
  await expect(page.locator(".result-card")).toHaveCount(0);
  await page.getByLabel("业务需求").fill("查询订单 SO202611001");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: "查看订单详情", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看本次链路", exact: false }).last().click();
  await expect(page.locator(".stage-title strong")).toHaveText(["思考", "调用", "结果"]);
  await expect(page.locator(".chain-call code")).toContainText("get_order");
  await expect(page.locator(".chain-result")).toContainText("SO202611001");
  await page.getByRole("tab", { name: "业务概览", exact: true }).click();
  await expect(page.getByText("订单总数", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "处理进度", exact: true }).click();
  await page.getByLabel("业务需求").fill("深圳仓 PHONE-001 还有多少库存");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: "对比其他仓库", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回最新链路", exact: false }).click();
  await expect(page.locator(".chain-call code")).toContainText("get_inventory");
  await page.getByRole("button", { name: "查看本次链路", exact: false }).first().click();
  await expect(page.locator(".chain-call code")).toContainText("get_order");
  await page.screenshot({ path: ".cache/ui-chain-desktop.png" });
  for (const [width, height] of [
    [1920, 1080],
    [1440, 900],
    [1366, 768],
    [1280, 800],
    [1024, 768],
  ]) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    const box = await page.getByRole("button", { name: "发送", exact: true }).boundingBox();
    expect(box && box.y + box.height <= height).toBeTruthy();
  }
});

test("管理员分配、转派、业务列表筛选与刷新失败保留数据", async ({ page }) => {
  await login(page, "admin");
  await page.getByRole("button", { name: "售后工单", exact: true }).click();
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await page.getByRole("button", { name: /待领取/ }).click();
  const details = page.getByRole("button", { name: "查看详情", exact: true });
  await details.first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "确认分配", exact: true })).toBeDisabled();
  const options = await dialog.getByLabel("工单负责人").locator("option").allTextContents();
  const service = options.find((v) => v.includes("客服"))!;
  await dialog.getByLabel("工单负责人").selectOption({ label: service });
  await dialog.getByRole("button", { name: "确认分配", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "确认转派", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "确认转派", exact: true })).toBeDisabled();
  await expect(dialog.getByText(`负责人：${service}`, { exact: true }).first()).toBeVisible();
  const selected = await dialog
    .getByLabel("工单负责人")
    .locator("option")
    .evaluateAll((es) =>
      es
        .filter(
          (e) => e instanceof HTMLOptionElement && e.value && e.textContent?.includes("管理员"),
        )
        .map((e) => (e as HTMLOptionElement).value),
    );
  await dialog.getByLabel("工单负责人").selectOption(selected[0]);
  await dialog.getByRole("button", { name: "确认转派", exact: true }).click();
  await expect(dialog.getByText(/负责人：.*管理员/).first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "追加备注", exact: true })).toBeEnabled();
  await dialog.locator(".assignment-section").scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".cache/ui-admin-assignment.png" });
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "订单查询", exact: true }).click();
  await page.getByLabel("列表排序").selectOption("oldest");
  await page.getByPlaceholder("搜索订单号、客户、商品或 SKU").fill("SO202611001");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.route("**/api/orders", (route) => route.abort());
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.getByText(/更新失败，当前为上次成功加载的数据/)).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);
});
