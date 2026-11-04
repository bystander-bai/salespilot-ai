# SalesPilot · 销售订单智能助手

**业务千头万绪，一句话，理清楚。**

SalesPilot 将订单查询、库存查询和售后工单整合到一个对话工作台中。用户用自然语言描述需求，助手识别业务意图、校验参数并调用数据库工具，实时展示执行步骤与结构化结果。

项目采用 React、Fastify、LangGraph 和 SQLite 构建，提供奶油米黄主题封面、智能工作台及三个业务列表页面。默认使用无需模型密钥的本地演示模式，也支持接入 OpenAI 兼容的模型网关。

## 功能概览

| 模块     | 功能                                                             |
| -------- | ---------------------------------------------------------------- |
| 封面入口 | 品牌介绍、主要能力展示，点击“进入工作台”进入业务页面             |
| 智能对话 | 通过自然语言查询订单、查询库存、创建售后工单；缺少参数时继续追问 |
| 订单查询 | 展示客户、商品明细、订单状态及预计送达日期，支持搜索、筛选与分页 |
| 库存查询 | 按商品和仓库查看可用库存、预留库存及更新时间                     |
| 售后工单 | 创建退货、换货或维修工单，查看已有工单和处理状态                 |
| 执行概览 | 展示意图识别、参数校验、工具调用、结果与失败信息                 |
| 数据刷新 | 状态与统计每 15 秒自动更新，支持手动刷新及成功、失败反馈         |

前端适配桌面和手机屏幕；工作台左上角品牌可返回封面，支持浏览器前进与后退。


## 技术栈与项目结构

| 层级       | 技术                                                  |
| ---------- | ----------------------------------------------------- |
| 前端       | React 19、TypeScript、Vite、Lucide 图标、CSS 变量主题 |
| 后端       | Fastify、TypeScript、Zod 参数校验                     |
| Agent      | LangGraph 流程编排、LangChain 模型与工具集成          |
| 数据       | SQLite、Prisma ORM、数据库迁移与种子数据              |
| 通信       | REST API、SSE 流式事件                                |
| 工程与部署 | npm Workspaces、Prettier、Docker Compose、Nginx       |

```text
.
├── apps/
│   ├── web/                  # 封面、工作台、业务列表与页面样式
│   └── api/
│       ├── src/              # API、Agent、业务工具和会话管理
│       ├── prisma/           # 数据模型、迁移和种子数据
│       └── scripts/          # 数据库初始化与迁移脚本
├── packages/contracts/       # 前后端共享类型、Schema 与事件定义
├── docs/                     # 架构、API 文档及页面截图
├── design/                   # Logo 设计与预览素材
├── .env.example              # 环境变量模板
├── Dockerfile                # API 与前端多阶段构建
└── docker-compose.yml        # 应用服务与数据库数据卷
```

业务处理流程：

```text
用户需求 → 意图识别 → 参数校验 / 追问 → 业务工具 → 结果校验 → 生成回复
                └──────────── SSE 实时推送执行过程 ────────────┘
```

业务工具通过 Prisma 访问数据库；模型负责业务规划与回复，不直接执行模型生成的 SQL。售后创建包含订单状态校验和幂等处理。

## 本地启动

### 环境要求

- Node.js **22.12.0 或更高版本**。
- npm **10 或更高版本**。
- 安装依赖、首次生成 Prisma Client 时需要网络；演示模式运行时无需模型服务。

克隆仓库后，以下命令均在项目根目录执行。

### 1. 安装依赖

```bash
npm ci
```

### 2. 创建本地配置

Windows PowerShell：

```powershell
Copy-Item .env.example apps/api/.env
```

macOS / Linux：

```bash
cp .env.example apps/api/.env
```

首次启动直接使用模板中的 `AGENT_MODE=demo` 即可，模型地址、密钥和模型名称可以留空。已有配置文件时直接编辑，无需重新复制。

### 3. 初始化数据库

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

这三步依次生成 Prisma Client、应用数据库迁移并写入演示数据。默认 SQLite 文件位于 `apps/api/prisma/dev.db`。

种子数据包含 5 个客户、10 种商品、3 个仓库、10 笔订单、30 条库存记录和 1 个售后工单。重复执行 `db:seed` 会补充缺失的种子记录，保留已有业务记录和操作日志。

### 4. 启动前后端

```bash
npm run dev
```

该命令先构建共享契约包，再同时启动 API 和前端开发服务。

| 页面 / 服务  | 默认地址                                                             |
| ------------ | -------------------------------------------------------------------- |
| 封面首页     | [http://localhost:5173/](http://localhost:5173/)                     |
| 智能工作台   | [http://localhost:5173/workspace](http://localhost:5173/workspace)   |
| API 健康检查 | [http://localhost:3000/api/health](http://localhost:3000/api/health) |

前端开发服务将 `/api` 请求代理到 `http://localhost:3000`。按 `Ctrl+C` 可停止开发服务。

## 使用示例

进入工作台后，可以输入：

```text
帮我查一下订单 SO202611001 到哪里了？
深圳仓 PHONE-001 还有多少库存？
订单 SO202611001 的手机无法开机，帮我创建维修工单。
```

示例使用种子数据中的订单号和 SKU。也可以从左侧进入业务列表，直接查看、搜索和筛选记录。

售后申请仅支持已发货或已签收的订单；同一会话中相同参数的重复申请会返回已有工单。演示模式使用本地规则识别需求；模型网关模式可根据对话进行规划和追问。

## 模型模式与环境变量

### 演示模式

在 `apps/api/.env` 中设置：

```dotenv
AGENT_MODE=demo
```

本地规则完成意图识别与参数提取，业务查询和售后创建仍然读写 SQLite 数据库，适合本地体验和功能演示。

### 模型网关模式

在 `apps/api/.env` 中填写自己的配置：

```dotenv
AGENT_MODE=gateway
OPENAI_BASE_URL=https://your-gateway.example/v1
OPENAI_API_KEY=your-api-key
MODEL_NAME=your-model-name
```

将示例值替换为网关提供的地址、密钥和模型标识，所用模型需要支持工具调用（Tool Calling）。修改后重启 API 服务。

`AGENT_MODE=gateway` 时，三个网关配置缺一不可；配置不完整会显示“未配置”，对话请求将返回配置错误。健康检查中的 `modelGateway=configured` 只说明配置完整，实际连通性以对话请求结果为准。

### 配置项

| 变量               | 默认值                  | 说明                                    |
| ------------------ | ----------------------- | --------------------------------------- |
| `PORT`             | `3000`                  | API 监听端口                            |
| `DATABASE_URL`     | `file:./dev.db`         | SQLite 连接地址                         |
| `AGENT_MODE`       | `demo`                  | 使用 `demo` 或 `gateway`                |
| `OPENAI_BASE_URL`  | 空                      | OpenAI 兼容网关基础地址，通常包含 `/v1` |
| `OPENAI_API_KEY`   | 空                      | 网关密钥，演示模式无需填写              |
| `MODEL_NAME`       | 空                      | 网关中的模型标识，演示模式无需填写      |
| `CORS_ORIGIN`      | `http://localhost:5173` | 允许的前端来源，多个值以逗号分隔        |
| `MODEL_TIMEOUT_MS` | `20000`                 | 单次模型请求超时，单位毫秒              |
| `TOOL_TIMEOUT_MS`  | `5000`                  | 单次业务工具调用超时，单位毫秒          |

本地配置从 `apps/api/.env` 读取；已设置的进程环境变量优先。仓库提供不含真实密钥的 `.env.example`，本地 `.env` 和 SQLite 数据文件已通过 `.gitignore` 排除。

## 常用命令与构建

| 命令                      | 用途                       |
| ------------------------- | -------------------------- |
| `npm run dev`             | 构建共享包并同时启动前后端 |
| `npm run dev:api`         | 单独启动 API 开发服务      |
| `npm run dev:web`         | 单独启动前端开发服务       |
| `npm run build`           | 依次构建共享包、API 和前端 |
| `npm run build:contracts` | 构建共享契约包             |
| `npm run build:api`       | 构建 API                   |
| `npm run build:web`       | 类型检查并构建前端         |
| `npm run db:generate`     | 生成 Prisma Client         |
| `npm run db:migrate`      | 应用已提交的数据库迁移     |
| `npm run db:seed`         | 初始化演示数据             |
| `npm run format:check`    | 检查代码和文档格式         |
| `npm run format`          | 格式化代码和文档           |

单独启动或构建子项目之前，先运行 `npm run build:contracts`。完整构建：

```bash
npm run build
```

构建结果分别输出到 `packages/contracts/dist`、`apps/api/dist` 和 `apps/web/dist`。构建后的 API 可以运行：

```bash
npm --workspace apps/api start
```

前端生产部署需要提供静态文件服务，将 `/api` 代理到 API，并将 `/workspace` 等页面路径回退到 `index.html`。项目的 Nginx 配置已包含这些规则。

## Docker Compose 部署

需要 Docker Engine 和 Compose 插件，或已启动的 Docker Desktop。

### 使用演示模式

```bash
docker compose up --build -d
```

### 使用模型网关

先按前文创建并填写 `apps/api/.env`，再显式将该文件传给 Compose：

```bash
docker compose --env-file apps/api/.env up --build -d
```

Compose 不会自动读取 `apps/api/.env`；以上参数用于将网关配置传入容器。容器内的端口、数据库路径和前端来源以 `docker-compose.yml` 为准；需要调整超时配置时，在 API 服务的 `environment` 中补充对应变量。

| 服务         | 地址                                                                 |
| ------------ | -------------------------------------------------------------------- |
| 封面首页     | [http://localhost:8080/](http://localhost:8080/)                     |
| 智能工作台   | [http://localhost:8080/workspace](http://localhost:8080/workspace)   |
| API 健康检查 | [http://localhost:3000/api/health](http://localhost:3000/api/health) |

API 容器启动时自动执行迁移和种子数据初始化，前端由 Nginx 提供服务。数据库持久化在 `salespilot-data` 命名卷中，普通停止和重建容器会保留数据。

查看状态、日志和停止服务：

```bash
docker compose ps
docker compose logs -f api
docker compose down
```

本地开发和 Docker 默认都使用 API 端口 `3000`，启动前选择一种运行方式，避免端口冲突。

## API 概览

| 方法   | 路径               | 用途                           |
| ------ | ------------------ | ------------------------------ |
| `GET`  | `/api/health`      | 服务、数据库与模型模式状态     |
| `GET`  | `/api/dashboard`   | 订单、售后、库存统计及操作记录 |
| `GET`  | `/api/orders`      | 订单列表                       |
| `GET`  | `/api/inventory`   | 库存列表                       |
| `GET`  | `/api/tickets`     | 售后工单列表                   |
| `POST` | `/api/chat`        | 非流式业务对话                 |
| `POST` | `/api/chat/stream` | SSE 流式业务对话               |

PowerShell 请求示例：

```powershell
Invoke-RestMethod http://localhost:3000/api/health

Invoke-RestMethod -Method Post `
  -Uri http://localhost:3000/api/chat `
  -ContentType 'application/json; charset=utf-8' `
  -Body '{"sessionId":"demo-001","message":"帮我查一下订单 SO202611001 到哪里了"}'
```

macOS / Linux 请求示例：

```bash
curl -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"demo-001","message":"帮我查一下订单 SO202611001 到哪里了"}'
```

`sessionId` 用于关联多轮对话；流式接口使用相同请求体，返回 `text/event-stream`，客户端以 `run.done` 作为执行结束标记。完整事件与错误码说明见 [API 文档](docs/api.md)。

## 常见问题

**没有 API Key，可以运行吗？**  
可以。保持 `AGENT_MODE=demo`，完成数据库初始化后即可使用订单、库存和售后功能。

**列表为空，或提示数据库表不存在？**  
检查 `DATABASE_URL` 是否指向预期数据库，并依次运行 `npm run db:generate`、`npm run db:migrate`、`npm run db:seed`。

**页面提示无法连接后台服务？**  
确认 API 正在运行，并访问 `/api/health` 检查状态。修改 API 端口后，需要同步调整 `apps/web/vite.config.ts` 中的代理目标；更改前端来源时，检查 `CORS_ORIGIN`。

**网关显示已配置，但对话失败？**  
检查基础地址、密钥、模型名称及模型的工具调用能力，再查看 API 终端或容器日志。仅填写配置不会验证网关实际可用性。

**刷新页面后，聊天记录还在吗？**  
当前前端聊天记录保存在页面内存中，刷新页面或离开工作台后会重置。服务端会话也保存在内存中，服务重启后不保留；订单、库存、工单与操作记录存储在 SQLite 中。


当前版本面向本地体验、功能演示与二次开发，业务数据由本地 SQLite 管理。
