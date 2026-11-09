# SalesPilot API 接口契约

更新日期：2026-11-09。以当前路由实现及 `packages/contracts/src/index.ts` 为依据。

本文提供接口路径、权限、参数约束、请求／响应示例、SSE 协议及业务错误码。示例中的账号、密码、ID、日期和业务记录均为说明用途，不是默认账号或现有业务数据；联调时请替换为实际返回值。

## 目录

- [通用约定与认证](#通用约定与认证)
- [接口总览](#接口总览)
- [登录与账号](#登录与账号)
- [健康检查与业务概览](#健康检查与业务概览)
- [订单与库存](#订单与库存)
- [售后工单](#售后工单)
- [私有会话与消息](#私有会话与消息)
- [对话与 SSE](#对话与-sse)
- [错误格式与业务错误码](#错误格式与业务错误码)
- [联调步骤与示例](#联调步骤与示例)
- [实现依据与维护](#实现依据与维护)

## 通用约定与认证

### 地址、请求与响应

- 开发环境直接访问 API 的默认地址：`http://localhost:3000`；经前端同源代理访问时使用页面所在来源下的 `/api`。浏览器测试专用端口 `3101`、`4173` 不属于正式服务地址。
- 除 SSE 外，请求／响应使用 JSON；发送 JSON 请求体时设置 `Content-Type: application/json`。普通成功响应直接返回对象或数组，**没有统一的 `{ code, data }` 包装**。
- 所有接口路径均以 `/api` 开头。本文 `:id` 为路径参数占位符，请替换为真实 ID 并正确进行 URL 编码。
- 时间戳一般为 UTC ISO 8601 字符串，例如 `2026-11-09T01:00:00.000Z`；前端按北京时间显示。例外：订单详情及对话订单结果的 `estimatedDelivery` 为 `YYYY-MM-DD` 日期，订单列表为完整时间戳，两者均可能为 `null`。
- `null` 表示明确无值；可选属性没有记录时可能直接省略。旧数据缺失人员、商品或时间时返回 `null`、空数组或省略可选属性，不补造历史信息。
- JSON 请求体上限为 16 KiB。登录、账号写入、工单写入、会话改名和对话使用严格对象校验，传入未知属性会被拒绝；查询参数中未知字段通常被忽略。
- 列表为空时返回 `[]`；分页列表为空时返回 `items: []`、`total: 0`。只有会话和消息接口提供服务端分页，订单、库存、工单接口直接返回全量数组，页面搜索、排序和分页主要在前端完成。

### Cookie 与来源校验

除 `GET /api/health`、`POST /api/auth/login` 外，本文接口均要求登录，包括注销接口。登录成功后响应设置 `salespilot_auth` Cookie：`HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`，有效期 8 小时。`COOKIE_SECURE=true` 时增加 `Secure`。后续请求携带该 Cookie，不使用 Bearer Token；Cookie 原始值不出现在 JSON 响应中。

浏览器同源请求自动携带 Cookie；跨来源请求需使用 `credentials: "include"` 并满足 CORS 和 Cookie 策略。写请求带 `Origin` 时必须与请求协议、Host（含端口）同源，或匹配 `CORS_ORIGIN`；`Sec-Fetch-Site: cross-site` 的写请求始终返回 403，即使 Origin 位于允许列表。反向代理须保留浏览器 Host 及端口，来源判断不信任客户端转发头；HTTPS 在代理终止时应将公开 HTTPS 来源加入 `CORS_ORIGIN`。

### 角色与枚举

| 字段            | 取值与含义                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `role`          | `ADMIN` 管理员、`SERVICE` 客服、`SALES` 销售                                                    |
| 订单 `status`   | `PENDING` 待付款、`PROCESSING` 处理中、`SHIPPED` 已发货、`DELIVERED` 已签收、`CANCELLED` 已取消 |
| 工单 `status`   | `CREATED` 待处理、`PROCESSING` 处理中、`RESOLVED` 已解决、`CLOSED` 已关闭、`CANCELLED` 已取消   |
| 工单 `type`     | `RETURN` 退货、`REPAIR` 维修、`EXCHANGE` 换货                                                   |
| 工单 `priority` | `NORMAL` 普通、`HIGH` 高优先级                                                                  |
| `mode`          | `demo` 本地演示、`gateway` 模型网关、`unconfigured` 网关配置不完整                              |

所有已登录角色可查询业务数据、创建售后申请、查询可分配人员，并管理自己的私有会话；管理员也不能查看其他账号的私有会话。创建／查询全部账号及修改账号仅限管理员。工单处理权限另见操作表。

## 接口总览

| 方法   | 路径                         | 权限                       | 成功状态与响应                                    |
| ------ | ---------------------------- | -------------------------- | ------------------------------------------------- |
| GET    | `/api/health`                | 公开                       | 200；降级时 503，均为健康状态对象                 |
| POST   | `/api/auth/login`            | 公开，受来源校验和限流约束 | 200，公开用户对象＋Cookie                         |
| GET    | `/api/auth/me`               | 已登录                     | 200，公开用户对象                                 |
| POST   | `/api/auth/logout`           | 已登录                     | 200，`{ "success": true }`                        |
| GET    | `/api/users`                 | 管理员                     | 200，公开用户数组                                 |
| POST   | `/api/users`                 | 管理员                     | 201，公开用户对象                                 |
| PATCH  | `/api/users/:id`             | 管理员                     | 200，更新后的公开用户对象                         |
| GET    | `/api/users/assignees`       | 已登录                     | 200，可分配的公开用户数组                         |
| GET    | `/api/dashboard`             | 已登录                     | 200，统计、库存及活动对象                         |
| GET    | `/api/orders`                | 已登录                     | 200，订单数组                                     |
| GET    | `/api/orders/:id`            | 已登录                     | 200，订单详情对象                                 |
| GET    | `/api/inventory`             | 已登录                     | 200，库存数组                                     |
| GET    | `/api/tickets`               | 已登录                     | 200，工单数组                                     |
| GET    | `/api/orders/:id/tickets`    | 已登录                     | 200，关联工单数组                                 |
| GET    | `/api/tickets/:id`           | 已登录                     | 200，工单详情对象                                 |
| POST   | `/api/tickets`               | 已登录                     | 201，新建；200，幂等回放；`{ ticket, duplicate }` |
| POST   | `/api/tickets/:id/actions`   | 按角色、负责人和状态判断   | 200，最新工单详情对象                             |
| POST   | `/api/sessions`              | 已登录                     | 201，本人会话摘要                                 |
| GET    | `/api/sessions`              | 本人会话                   | 200，分页摘要对象                                 |
| PATCH  | `/api/sessions/:id`          | 本人会话                   | 200，`id, title, updatedAt`                       |
| DELETE | `/api/sessions/:id`          | 本人会话                   | 200，`{ "success": true }`                        |
| GET    | `/api/sessions/:id/messages` | 本人会话                   | 200，分页消息＋`running, title`                   |
| POST   | `/api/chat`                  | 本人会话                   | 200 或错误状态，详见对话协议                      |
| POST   | `/api/chat/stream`           | 本人会话                   | 建连后 200，`text/event-stream`                   |

## 登录与账号

### 公开用户对象 PublicUser

用户相关接口统一使用 `id, username, name, role, enabled`，不返回密码、密码哈希或登录凭据。账号 ID 为不透明字符串，使用接口返回值。

```json
{
  "id": "e9f3ae3e-cd26-4f58-9a55-eac3b04fa978",
  "username": "admin",
  "name": "示例管理员",
  "role": "ADMIN",
  "enabled": true
}
```

### POST /api/auth/login

登录并建立 Cookie 会话。

| 参数       | 必填 | 约束                                                       |
| ---------- | ---- | ---------------------------------------------------------- |
| `username` | 是   | 去除首尾空白、转小写后为 3–40 位字母、数字、下划线或短横线 |
| `password` | 是   | 登录时校验 1–128 字；创建或重置密码要求 10–128 字          |

每个 IP 在 15 分钟窗口内最多尝试 30 次，失败及参数校验失败也计入；限制计数保存在当前 API 进程内。

请求体：

```json
{
  "username": "admin",
  "password": "Example-only-password-2026"
}
```

成功响应：`200`。

```json
{
  "id": "e9f3ae3e-cd26-4f58-9a55-eac3b04fa978",
  "username": "admin",
  "name": "示例管理员",
  "role": "ADMIN",
  "enabled": true
}
```

返回 `Set-Cookie`，失败常见为 `400 INVALID_ARGUMENT`、`401 UNAUTHORIZED`、`403 FORBIDDEN`、`429 RATE_LIMITED`。响应中的用户数据不能代替 Cookie 认证。

### GET /api/auth/me

无请求体、无查询参数，返回当前登录用户。

成功响应：`200`。

```json
{
  "id": "e9f3ae3e-cd26-4f58-9a55-eac3b04fa978",
  "username": "admin",
  "name": "示例管理员",
  "role": "ADMIN",
  "enabled": true
}
```

### POST /api/auth/logout

无需请求体。撤销当前 Cookie 对应的登录并设置过期 Cookie，不会退出其他登录。登录已失效时仍可能返回 401，应直接清理前端登录状态。

成功响应：`200`。

```json
{
  "success": true
}
```

### GET /api/users

仅管理员；无请求参数。按创建时间升序返回全部账号，含已停用账号。

成功响应：`200`。

```json
[
  {
    "id": "e9f3ae3e-cd26-4f58-9a55-eac3b04fa978",
    "username": "admin",
    "name": "示例管理员",
    "role": "ADMIN",
    "enabled": true
  },
  {
    "id": "ab169de3-2ac2-4273-82d4-07fa16368795",
    "username": "service01",
    "name": "示例客服",
    "role": "SERVICE",
    "enabled": true
  }
]
```

### POST /api/users

仅管理员；创建后账号默认启用。

| 参数       | 必填 | 约束                                   |
| ---------- | ---- | -------------------------------------- |
| `username` | 是   | 与登录账号规则相同，统一小写，必须唯一 |
| `name`     | 是   | 去首尾空白后 1–60 字                   |
| `password` | 是   | 10–128 字                              |
| `role`     | 是   | `ADMIN`、`SERVICE` 或 `SALES`          |

请求体：

```json
{
  "username": "service01",
  "name": "示例客服",
  "password": "Example-only-password-2026",
  "role": "SERVICE"
}
```

成功响应：`201`。

```json
{
  "id": "ab169de3-2ac2-4273-82d4-07fa16368795",
  "username": "service01",
  "name": "示例客服",
  "role": "SERVICE",
  "enabled": true
}
```

重复账号等数据库唯一性冲突返回 `409 DATA_CONFLICT`，权限不足返回 `403 FORBIDDEN`。

### PATCH /api/users/:id

仅管理员；`:id` 为账号 ID。仅支持以下可选字段，不支持改账号名：`name`（1–60 字）、`role`、`enabled`（布尔值）、`password`（10–128 字）。字段规则与创建接口一致，空对象也会通过当前校验。

只改显示名称不会注销登录；只要请求包含 `role`、`enabled` 或有效新密码，都会撤销该账号全部登录，包括提交与当前值相同的角色／启用状态。不能停用或降级最后一个有效管理员。

请求体：

```json
{
  "name": "示例客服（售后组）",
  "enabled": true
}
```

成功响应：`200`。

```json
{
  "id": "ab169de3-2ac2-4273-82d4-07fa16368795",
  "username": "service01",
  "name": "示例客服（售后组）",
  "role": "SERVICE",
  "enabled": true
}
```

错误：`404 USER_NOT_FOUND`、`409 LAST_ADMIN`，以及通用参数／权限错误。停用或降级负责人不会自动转派其未结工单。

### GET /api/users/assignees

所有已登录角色可调用；无请求参数。按名称升序返回已启用的管理员及客服，不包含销售或停用账号；无候选人返回 `[]`。

成功响应：`200`。

```json
[
  {
    "id": "e9f3ae3e-cd26-4f58-9a55-eac3b04fa978",
    "username": "admin",
    "name": "示例管理员",
    "role": "ADMIN",
    "enabled": true
  },
  {
    "id": "ab169de3-2ac2-4273-82d4-07fa16368795",
    "username": "service01",
    "name": "示例客服",
    "role": "SERVICE",
    "enabled": true
  }
]
```

## 健康检查与业务概览

### GET /api/health

公开；无请求参数。该接口检查数据库可用性和模型配置模式，不主动调用模型验证网关连通性。`configured` 仅代表已配置。

成功响应：`200`。

```json
{
  "status": "ok",
  "database": "available",
  "mode": "demo",
  "modelGateway": "demo"
}
```

数据库不可用或模式为 `unconfigured` 时返回 `503`，仍使用以下健康状态结构，不使用通用错误结构：

```json
{
  "status": "degraded",
  "database": "available",
  "mode": "unconfigured",
  "modelGateway": "unconfigured"
}
```

`database` 可为 `available/unavailable`；`modelGateway` 可为 `demo/configured/unconfigured`。

### GET /api/dashboard

已登录；无请求参数。`orders`、`tickets` 为记录总数，`inventoryCount` 为商品与仓库组合的库存记录数。`inventory` 按可用量、SKU、仓库排序；`activity` 按时间倒序，仅返回动作及状态，不包含聊天正文或日志内部详情。目前未分页、未限制条数。

成功响应：`200`。

```json
{
  "orders": 1,
  "tickets": 1,
  "inventoryCount": 1,
  "inventory": [
    {
      "sku": "PHONE-001",
      "name": "智能手机",
      "warehouse": "深圳仓",
      "available": 120
    }
  ],
  "activity": [
    {
      "id": "04895f48-078b-4a4d-9ed4-8ea749d067b5",
      "action": "ticket.create",
      "success": true,
      "createdAt": "2026-11-09T01:00:00.000Z"
    }
  ]
}
```

## 订单与库存

### GET /api/orders

已登录；无受支持的查询参数，无服务端搜索、排序参数或分页。按创建时间倒序、订单号升序返回数组。列表商品不含 `orderItemId` 或 `availableForAfterSales`，提交售后前需请求订单详情。

成功响应：`200`。

```json
[
  {
    "orderId": "SO202611001",
    "customerName": "示例客户",
    "status": "SHIPPED",
    "items": [
      {
        "sku": "PHONE-001",
        "name": "智能手机",
        "quantity": 1
      }
    ],
    "estimatedDelivery": "2026-11-10T00:00:00.000Z",
    "createdAt": "2026-11-09T01:00:00.000Z"
  }
]
```

### GET /api/orders/:id

已登录；`:id` 为真实订单号，例如 `SO202611001`。直接按路径值查找；与对话工具参数不同，此路由不自动转大写。没有对应订单返回 `404 ORDER_NOT_FOUND`。

成功响应：`200`。

```json
{
  "kind": "order",
  "orderId": "SO202611001",
  "status": "SHIPPED",
  "customerName": "示例客户",
  "items": [
    {
      "orderItemId": "a8ca43b8-cad6-4b73-b566-827b36678f34",
      "availableForAfterSales": 1,
      "sku": "PHONE-001",
      "name": "智能手机",
      "quantity": 1
    }
  ],
  "estimatedDelivery": "2026-11-10"
}
```

`availableForAfterSales` 为订单商品数量减去 `CREATED/PROCESSING` 工单已占用数量，最小为 0。`orderItemId` 是申请售后必需的订单行 ID，不能用 SKU 替代。`estimatedDelivery` 为日期字符串或 `null`。

### GET /api/inventory

已登录。请求示例：`GET /api/inventory?sku=PHONE-001`。

| 查询参数 | 必填 | 行为                                                                                        |
| -------- | ---- | ------------------------------------------------------------------------------------------- |
| `sku`    | 否   | 去首尾空白，最长 64 字；非空时按实际 SKU 精确查询，不自动转大写；省略或空字符串返回全部库存 |

返回各仓库库存记录，按 SKU、仓库编码升序排列。此接口不支持 `warehouse` 服务端筛选；页面取得商品各仓数据后自行筛选。找不到库存时返回 `[]`，不返回工具查询中的 `SKU_NOT_FOUND` 等错误。

成功响应：`200`。

```json
[
  {
    "sku": "PHONE-001",
    "productName": "智能手机",
    "warehouse": "SZ",
    "warehouseName": "深圳仓",
    "available": 120,
    "reserved": 8,
    "updatedAt": "2026-11-09T01:00:00.000Z"
  }
]
```

`available` 为可用库存，`reserved` 为预留库存；接口没有库存预警阈值或库存百分比字段。

## 售后工单

### 工单列表对象 TicketListItem

以下对象用于工单列表及订单关联工单列表。所有列表均不分页；按创建时间倒序、工单号升序排列。

```json
{
  "ticketId": "AS12AB34CD56EF",
  "orderId": "SO202611001",
  "customerName": "示例客户",
  "status": "CREATED",
  "type": "REPAIR",
  "description": "手机无法开机",
  "priority": "NORMAL",
  "createdAt": "2026-11-09T01:00:00.000Z",
  "estimatedResponseHours": 24,
  "createdById": "e9f3ae3e-cd26-4f58-9a55-eac3b04fa978",
  "assigneeId": null,
  "assigneeName": null,
  "assigneeAvailable": false,
  "firstResponseAt": null,
  "overdue": false
}
```

| 字段                                  | 类型        | 说明                                                            |
| ------------------------------------- | ----------- | --------------------------------------------------------------- |
| `ticketId, orderId, customerName`     | string      | 工单、订单及客户                                                |
| `status, type, priority, description` | string      | 状态、类型、优先级和问题说明                                    |
| `createdAt`                           | string      | 创建时间                                                        |
| `estimatedResponseHours`              | number      | 普通 24、高优先级 8 小时首次响应                                |
| `createdById`                         | string/null | 创建账号；旧数据可能缺失                                        |
| `assigneeId, assigneeName`            | string/null | 当前负责人；未分配时为 null                                     |
| `assigneeAvailable`                   | boolean     | 负责人当前是否启用且角色为管理员／客服；未分配时 false          |
| `firstResponseAt`                     | string/null | 首次领取或分配进入处理中的时间                                  |
| `overdue`                             | boolean     | 仅待处理、尚未响应且超过响应时限时为 true；不会自动改变工单状态 |

### GET /api/tickets

已登录。请求示例：`GET /api/tickets?scope=assigned&status=PROCESSING&priority=HIGH`。

| 查询参数     | 必填 | 默认与约束                                                                    |
| ------------ | ---- | ----------------------------------------------------------------------------- |
| `scope`      | 否   | 默认 `all`；`mine` 本人创建、`unassigned` 未分配且待处理、`assigned` 本人负责 |
| `status`     | 否   | 最长 30 字；非空时精确筛选。传入未知状态不会枚举报错，通常返回空数组          |
| `priority`   | 否   | `NORMAL/HIGH`                                                                 |
| `assigneeId` | 否   | 最长 100 字；非空时按负责人 ID 筛选                                           |

注意：显式 `status`、`assigneeId` 覆盖 `scope` 中同名筛选条件，而不是与其重复求交。例如 `scope=assigned&assigneeId=其他ID` 会查询指定负责人，`scope=unassigned&status=PROCESSING` 会变成“未分配且处理中”。需要快捷视图语义时避免组合矛盾参数。

成功响应：`200`。

```json
[
  {
    "ticketId": "AS12AB34CD56EF",
    "orderId": "SO202611001",
    "customerName": "示例客户",
    "status": "CREATED",
    "type": "REPAIR",
    "description": "手机无法开机",
    "priority": "NORMAL",
    "createdAt": "2026-11-09T01:00:00.000Z",
    "estimatedResponseHours": 24,
    "createdById": "e9f3ae3e-cd26-4f58-9a55-eac3b04fa978",
    "assigneeId": null,
    "assigneeName": null,
    "assigneeAvailable": false,
    "firstResponseAt": null,
    "overdue": false
  }
]
```

### GET /api/orders/:id/tickets

已登录；`:id` 为订单号。返回该订单全部关联工单；无工单或订单不存在都返回空数组，当前实现不单独检查订单存在性。

成功响应：`200`。

```json
[
  {
    "ticketId": "AS12AB34CD56EF",
    "orderId": "SO202611001",
    "customerName": "示例客户",
    "status": "CREATED",
    "type": "REPAIR",
    "description": "手机无法开机",
    "priority": "NORMAL",
    "createdAt": "2026-11-09T01:00:00.000Z",
    "estimatedResponseHours": 24,
    "createdById": "e9f3ae3e-cd26-4f58-9a55-eac3b04fa978",
    "assigneeId": null,
    "assigneeName": null,
    "assigneeAvailable": false,
    "firstResponseAt": null,
    "overdue": false
  }
]
```

### GET /api/tickets/:id

已登录；`:id` 为工单号，例如 `AS12AB34CD56EF`。不存在返回 `404 TICKET_NOT_FOUND`。在列表字段基础上增加版本、人员、来源、时间、商品明细及处理时间线。

成功响应：`200`。

```json
{
  "ticketId": "AS12AB34CD56EF",
  "orderId": "SO202611001",
  "customerName": "示例客户",
  "status": "CREATED",
  "type": "REPAIR",
  "description": "手机无法开机",
  "priority": "NORMAL",
  "createdAt": "2026-11-09T01:00:00.000Z",
  "estimatedResponseHours": 24,
  "createdById": "e9f3ae3e-cd26-4f58-9a55-eac3b04fa978",
  "assigneeId": null,
  "assigneeName": null,
  "assigneeAvailable": false,
  "firstResponseAt": null,
  "overdue": false,
  "version": 0,
  "creatorName": "示例管理员",
  "fromChat": false,
  "sourceSessionId": null,
  "updatedAt": "2026-11-09T01:00:00.000Z",
  "resolvedAt": null,
  "closedAt": null,
  "items": [
    {
      "orderItemId": "a8ca43b8-cad6-4b73-b566-827b36678f34",
      "sku": "PHONE-001",
      "name": "智能手机",
      "quantity": 1
    }
  ],
  "events": [
    {
      "id": "37982265-68a3-4be7-b4aa-4caa95d1beb0",
      "action": "CREATE",
      "actorName": "示例管理员",
      "fromStatus": "",
      "toStatus": "CREATED",
      "note": "手机无法开机",
      "assigneeName": null,
      "createdAt": "2026-11-09T01:00:00.000Z"
    }
  ]
}
```

| 详情附加字段                      | 说明                                                            |
| --------------------------------- | --------------------------------------------------------------- |
| `version`                         | 非负整数，新工单为 0；每次成功操作（包括备注）递增 1            |
| `creatorName`                     | 申请人名称或 null                                               |
| `fromChat`                        | 是否由对话发起                                                  |
| `sourceSessionId`                 | 仅会话本人可见；其他成员或已删除来源返回 null。列表不返回此字段 |
| `updatedAt, resolvedAt, closedAt` | 更新时间；解决／关闭时间可为 null；取消也写入 `closedAt`        |
| `items`                           | 已申请商品及数量；旧数据可为空数组                              |
| `events`                          | 按时间升序排列；含动作、操作者、状态变化、说明、负责人及时间    |

创建事件 `fromStatus` 为空字符串，表示没有前置状态。已删除来源会话的工单保留 `fromChat=true`，但 `sourceSessionId=null`。

### POST /api/tickets

已登录；正式创建工单，所有角色均可发起。

| 请求字段              | 必填 | 约束                                                 |
| --------------------- | ---- | ---------------------------------------------------- |
| `orderId`             | 是   | 去空白、转大写后匹配 `SO`＋9–20 位数字               |
| `type`                | 是   | `RETURN/REPAIR/EXCHANGE`                             |
| `description`         | 是   | 去首尾空白后 2–1000 字                               |
| `priority`            | 否   | `NORMAL/HIGH`，默认 NORMAL                           |
| `idempotencyKey`      | 是   | 客户端生成 UUID，重试时沿用原值                      |
| `sourceSessionId`     | 否   | 最长 100 字；非空时必须为本人所有的会话              |
| `items`               | 是   | 1–100 个对象；每项只允许 `orderItemId`、`quantity`   |
| `items[].orderItemId` | 是   | 1–100 字，来自订单详情，商品必须属于该订单且不得重复 |
| `items[].quantity`    | 是   | 正整数，不超过当前可申请数量                         |

只有已发货／已签收订单允许申请。待处理和处理中工单占用数量；已解决、已关闭、已取消工单不再占用。数量检查、工单／商品／事件／业务日志写入在同一事务内完成。

请求体：

```json
{
  "orderId": "SO202611001",
  "type": "REPAIR",
  "description": "手机无法开机",
  "priority": "NORMAL",
  "idempotencyKey": "e221e3a6-dda8-4553-b62b-986a05b206c5",
  "items": [
    {
      "orderItemId": "a8ca43b8-cad6-4b73-b566-827b36678f34",
      "quantity": 1
    }
  ]
}
```

成功响应：`201`。

```json
{
  "ticket": {
    "ticketId": "AS12AB34CD56EF",
    "orderId": "SO202611001",
    "customerName": "示例客户",
    "status": "CREATED",
    "type": "REPAIR",
    "description": "手机无法开机",
    "priority": "NORMAL",
    "createdAt": "2026-11-09T01:00:00.000Z",
    "estimatedResponseHours": 24,
    "createdById": "e9f3ae3e-cd26-4f58-9a55-eac3b04fa978",
    "assigneeId": null,
    "assigneeName": null,
    "assigneeAvailable": false,
    "firstResponseAt": null,
    "overdue": false,
    "version": 0,
    "creatorName": "示例管理员",
    "fromChat": false,
    "sourceSessionId": null,
    "updatedAt": "2026-11-09T01:00:00.000Z",
    "resolvedAt": null,
    "closedAt": null,
    "items": [
      {
        "orderItemId": "a8ca43b8-cad6-4b73-b566-827b36678f34",
        "sku": "PHONE-001",
        "name": "智能手机",
        "quantity": 1
      }
    ],
    "events": [
      {
        "id": "37982265-68a3-4be7-b4aa-4caa95d1beb0",
        "action": "CREATE",
        "actorName": "示例管理员",
        "fromStatus": "",
        "toStatus": "CREATED",
        "note": "手机无法开机",
        "assigneeName": null,
        "createdAt": "2026-11-09T01:00:00.000Z"
      }
    ]
  },
  "duplicate": false
}
```

同一账号、同一幂等键且规范化内容一致时，返回 `200`、`duplicate: true`，不再次创建。返回的 `ticket` 是读取时的最新详情，可能已被处理，不保证等于首次创建快照。相同键用于不同内容返回 `409 IDEMPOTENCY_CONFLICT`。商品数组会按订单行 ID 排序后计算内容，其他字段（包括来源会话）变化可能导致冲突。

错误还包括 `404 ORDER_NOT_FOUND/SESSION_NOT_FOUND`、`409 ORDER_STATUS_INVALID/QUANTITY_EXCEEDED/DATA_CONFLICT` 以及通用参数错误。

### POST /api/tickets/:id/actions

对工单执行领取、分配／转派、备注、解决、关闭或取消。

| 请求字段     | 必填         | 约束                                                               |
| ------------ | ------------ | ------------------------------------------------------------------ |
| `action`     | 是           | `CLAIM/ASSIGN/NOTE/RESOLVE/CLOSE/CANCEL`                           |
| `version`    | 是           | 当前详情中的非负整数版本号，不可自行猜测                           |
| `requestId`  | 是           | 客户端 UUID；同一次操作重试沿用原值和完整请求体                    |
| `note`       | 否／条件必填 | 去首尾空白，最多 2000 字，默认空；NOTE／RESOLVE／CANCEL 必须非空   |
| `assigneeId` | ASSIGN 必填  | 1–100 字，有效且启用的客服或管理员 ID，取自 `/api/users/assignees` |

“处理人权限”指管理员，或当前负责该工单的客服。

请求体：

```json
{
  "action": "ASSIGN",
  "version": 0,
  "requestId": "76b459ef-4e0f-48ba-a6ac-49e5c16efb15",
  "assigneeId": "ab169de3-2ac2-4273-82d4-07fa16368795",
  "note": "分配售后客服处理"
}
```

| action    | 权限与前置条件                                                         | 结果                                                  |
| --------- | ---------------------------------------------------------------------- | ----------------------------------------------------- |
| `CLAIM`   | 管理员／客服，工单为 CREATED 且未分配                                  | 负责人设为本人，进入 PROCESSING                       |
| `ASSIGN`  | 仅管理员，状态为 CREATED／PROCESSING，目标人员有效                     | 指定负责人，进入／保持 PROCESSING；已有负责人时即转派 |
| `NOTE`    | 处理人权限，状态为 CREATED／PROCESSING／RESOLVED，必填说明             | 状态不变，追加记录，版本递增                          |
| `RESOLVE` | 处理人权限，状态为 PROCESSING，必填说明                                | 进入 RESOLVED，记录解决时间                           |
| `CLOSE`   | 处理人权限，状态为 RESOLVED                                            | 进入 CLOSED，记录结束时间                             |
| `CANCEL`  | 管理员可取消 CREATED／PROCESSING；创建人仅可取消本人 CREATED，必填原因 | 进入 CANCELLED，记录结束时间                          |

首次领取／分配进入 PROCESSING 时记录 `firstResponseAt`，后续转派不重置。CLOSED／CANCELLED 不允许再操作或重新打开。ASSIGN 当前并不禁止把负责人再次设为同一人，前端会禁用该无效选择；不要依赖服务端替你阻止重复分配。

上述分配请求成功响应：`200`，完整最新工单详情：

```json
{
  "ticketId": "AS12AB34CD56EF",
  "orderId": "SO202611001",
  "customerName": "示例客户",
  "status": "PROCESSING",
  "type": "REPAIR",
  "description": "手机无法开机",
  "priority": "NORMAL",
  "createdAt": "2026-11-09T01:00:00.000Z",
  "estimatedResponseHours": 24,
  "createdById": "e9f3ae3e-cd26-4f58-9a55-eac3b04fa978",
  "assigneeId": "ab169de3-2ac2-4273-82d4-07fa16368795",
  "assigneeName": "示例客服",
  "assigneeAvailable": true,
  "firstResponseAt": "2026-11-09T01:05:00.000Z",
  "overdue": false,
  "version": 1,
  "creatorName": "示例管理员",
  "fromChat": false,
  "sourceSessionId": null,
  "updatedAt": "2026-11-09T01:05:00.000Z",
  "resolvedAt": null,
  "closedAt": null,
  "items": [
    {
      "orderItemId": "a8ca43b8-cad6-4b73-b566-827b36678f34",
      "sku": "PHONE-001",
      "name": "智能手机",
      "quantity": 1
    }
  ],
  "events": [
    {
      "id": "37982265-68a3-4be7-b4aa-4caa95d1beb0",
      "action": "CREATE",
      "actorName": "示例管理员",
      "fromStatus": "",
      "toStatus": "CREATED",
      "note": "手机无法开机",
      "assigneeName": null,
      "createdAt": "2026-11-09T01:00:00.000Z"
    },
    {
      "id": "bd640a54-b32c-4354-ad1e-3ec992fce07e",
      "action": "ASSIGN",
      "actorName": "示例管理员",
      "fromStatus": "CREATED",
      "toStatus": "PROCESSING",
      "note": "分配售后客服处理",
      "assigneeName": "示例客服",
      "createdAt": "2026-11-09T01:05:00.000Z"
    }
  ]
}
```

继续解决该工单的请求示例（路径相同，使用最新版本和新的请求 ID）：

```json
{
  "action": "RESOLVE",
  "version": 1,
  "requestId": "266410aa-37e6-4a4d-89d7-f973d86bca80",
  "note": "已维修完成并联系客户确认"
}
```

成功后返回同一 TicketDetail 结构，`status=RESOLVED`、`version=2`，增加处理事件并设置 `resolvedAt`。

幂等去重按“操作账号＋requestId”进行；相同请求重放不再增加事件和版本，返回最新详情。相同 ID 用于不同工单、不同版本或不同内容返回 `409 IDEMPOTENCY_CONFLICT`。版本过期返回 `409 VERSION_CONFLICT`，状态不允许返回 `409 STATUS_CONFLICT`，权限不足返回 `403 FORBIDDEN`；应刷新后重新判断是否发起新操作。

## 私有会话与消息

所有会话接口只允许访问本人会话。他人会话与不存在会话统一返回 `404 SESSION_NOT_FOUND`，管理员也不例外。会话上下文不直接返回客户端。

### POST /api/sessions

无业务请求参数；可发送空对象 `{}`。创建新会话，使用返回的 `id` 发送对话。

请求体：

```json
{}
```

成功响应：`201`。

```json
{
  "id": "22e02a9d-fc62-444b-83cd-2cc6ee404733",
  "title": "新会话",
  "createdAt": "2026-11-09T01:00:00.000Z",
  "updatedAt": "2026-11-09T01:00:00.000Z",
  "running": false
}
```

### GET /api/sessions

请求示例：`GET /api/sessions?q=订单&page=1&pageSize=30`。

| 查询字段   | 默认     | 约束                                            |
| ---------- | -------- | ----------------------------------------------- |
| `page`     | 1        | 整数 1–100000，页码从 1 开始                    |
| `pageSize` | 30       | 整数 1–100                                      |
| `q`        | 空字符串 | 去首尾空白，最多 200 字；搜索会话标题和消息正文 |

按最近更新时间倒序、ID 倒序；`running` 表示当前 API 进程中的会话忙碌状态。

成功响应：`200`。

```json
{
  "items": [
    {
      "id": "22e02a9d-fc62-444b-83cd-2cc6ee404733",
      "title": "新会话",
      "createdAt": "2026-11-09T01:00:00.000Z",
      "updatedAt": "2026-11-09T01:00:00.000Z",
      "running": false
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 30
}
```

### PATCH /api/sessions/:id

`:id` 为本人会话 ID。`title` 去首尾空白后 1–100 字。响应不是完整摘要，只有以下三项。

请求体：

```json
{
  "title": "手机订单售后跟进"
}
```

成功响应：`200`。

```json
{
  "id": "22e02a9d-fc62-444b-83cd-2cc6ee404733",
  "title": "手机订单售后跟进",
  "updatedAt": "2026-11-09T01:10:00.000Z"
}
```

### DELETE /api/sessions/:id

无请求体。运行中返回 `409 SESSION_BUSY`。删除会话及消息、上下文和运行响应正文，保留必要幂等凭据与实际业务工单；工单来源引用设为 null。不是“删除售后工单”接口。

成功响应：`200`。

```json
{
  "success": true
}
```

### GET /api/sessions/:id/messages

请求示例：`GET /api/sessions/会话ID/messages?page=1&pageSize=30`。分页规则与会话列表相同；`q` 虽会被公共解析器接受，但不用于筛选消息。

按时间升序、消息 ID 升序分页，第一页是最早消息，不是最新消息；查询最新页需要根据 `total/pageSize` 计算。除分页字段外，还返回 `running` 和 `title`。

成功响应：`200`。

```json
{
  "items": [
    {
      "id": "e9f3ae3e-cd26-4f58-9a55-eac3b04fa978:294678f0-211b-4f88-b321-726230ef7bf9:user",
      "role": "user",
      "content": "查询订单 SO202611001",
      "createdAt": "2026-11-09T01:00:00.000Z"
    },
    {
      "id": "e9f3ae3e-cd26-4f58-9a55-eac3b04fa978:294678f0-211b-4f88-b321-726230ef7bf9:assistant",
      "role": "assistant",
      "content": "订单 SO202611001 已发货，包含智能手机 × 1。预计送达日期：2026-11-10。",
      "createdAt": "2026-11-09T01:00:01.000Z",
      "result": {
        "kind": "order",
        "orderId": "SO202611001",
        "status": "SHIPPED",
        "customerName": "示例客户",
        "items": [
          {
            "orderItemId": "a8ca43b8-cad6-4b73-b566-827b36678f34",
            "availableForAfterSales": 1,
            "sku": "PHONE-001",
            "name": "智能手机",
            "quantity": 1
          }
        ],
        "estimatedDelivery": "2026-11-10"
      },
      "steps": [
        {
          "type": "tool",
          "name": "get_order",
          "success": true
        }
      ],
      "runId": "294678f0-211b-4f88-b321-726230ef7bf9",
      "trace": [
        {
          "type": "intent",
          "data": {
            "intent": "get_order",
            "label": "查询订单"
          }
        },
        {
          "type": "arguments",
          "data": {
            "tool": "get_order",
            "arguments": {
              "orderId": "SO202611001"
            }
          }
        },
        {
          "type": "tool.call",
          "data": {
            "tool": "get_order",
            "arguments": {
              "orderId": "SO202611001"
            },
            "attempt": 1
          }
        },
        {
          "type": "tool.result",
          "data": {
            "tool": "get_order",
            "success": true,
            "result": {
              "kind": "order",
              "orderId": "SO202611001",
              "status": "SHIPPED",
              "customerName": "示例客户",
              "items": [
                {
                  "orderItemId": "a8ca43b8-cad6-4b73-b566-827b36678f34",
                  "availableForAfterSales": 1,
                  "sku": "PHONE-001",
                  "name": "智能手机",
                  "quantity": 1
                }
              ],
              "estimatedDelivery": "2026-11-10"
            }
          }
        }
      ]
    }
  ],
  "total": 2,
  "page": 1,
  "pageSize": 30,
  "running": false,
  "title": "查询订单 SO202611001"
}
```

用户消息通常只有 `id, role, content, createdAt`；助手消息可附 `result, steps, runId, trace`，错误时可附 `error` 字符串。注意这里的 `error` 是错误消息字符串，而对话接口 `ChatResponse.error` 是结构化对象。历史记录可能缺少快照或 trace，应允许字段省略。历史结果是查询当时的快照，查看实时详情需再次请求业务接口。

## 对话与 SSE

### 请求体与结果字段

`POST /api/chat` 和 `POST /api/chat/stream` 使用同一请求体，调用前先创建本人会话。

```json
{
  "sessionId": "22e02a9d-fc62-444b-83cd-2cc6ee404733",
  "message": "查询订单 SO202611001",
  "requestId": "294678f0-211b-4f88-b321-726230ef7bf9"
}
```

| 字段        | 必填 | 约束                                                        |
| ----------- | ---- | ----------------------------------------------------------- |
| `sessionId` | 是   | 去空白后 1–100 位字母、数字、下划线或短横线，必须为本人会话 |
| `message`   | 是   | 去首尾空白后 1–2000 字                                      |
| `requestId` | 否   | UUID；省略时服务端生成，建议客户端始终生成并保留            |

`ChatResponse` 字段如下：

| 字段      | 说明                                                                 |
| --------- | -------------------------------------------------------------------- |
| `runId`   | 本次 requestId 或服务端生成的 UUID                                   |
| `mode`    | demo／gateway／unconfigured                                          |
| `answer`  | 最终完整回复，流式客户端应以此校准累计文本                           |
| `intent`  | 工具名称或 general；类型兼容 unsupported，客户端不要假定必定为工具名 |
| `steps`   | 工具执行摘要：`type, name, success`，无调用时为空数组                |
| `sources` | 业务来源：`type=database`、`reference`，无来源时为空数组             |
| `result`  | 可选，业务结果，按 kind 区分                                         |
| `error`   | 可选，`{ code, message, requestId }`                                 |
| `trace`   | 可选，关键执行事件数组，不含 run.start／message.delta／run.done      |

`steps` 是调用摘要，不逐次保留失败后重试的所有尝试；完整失败与重试过程以 `trace` 中的 tool.call／tool.result／retry 为准。

### POST /api/chat

非流式响应；正常业务成功为 `200`。以下为一次演示模式查询的完整响应示例：

```json
{
  "runId": "294678f0-211b-4f88-b321-726230ef7bf9",
  "mode": "demo",
  "answer": "订单 SO202611001 已发货，包含智能手机 × 1。预计送达日期：2026-11-10。",
  "intent": "get_order",
  "steps": [
    {
      "type": "tool",
      "name": "get_order",
      "success": true
    }
  ],
  "sources": [
    {
      "type": "database",
      "reference": "orders:SO202611001"
    }
  ],
  "result": {
    "kind": "order",
    "orderId": "SO202611001",
    "status": "SHIPPED",
    "customerName": "示例客户",
    "items": [
      {
        "orderItemId": "a8ca43b8-cad6-4b73-b566-827b36678f34",
        "availableForAfterSales": 1,
        "sku": "PHONE-001",
        "name": "智能手机",
        "quantity": 1
      }
    ],
    "estimatedDelivery": "2026-11-10"
  },
  "trace": [
    {
      "type": "intent",
      "data": {
        "intent": "get_order",
        "label": "查询订单"
      }
    },
    {
      "type": "arguments",
      "data": {
        "tool": "get_order",
        "arguments": {
          "orderId": "SO202611001"
        }
      }
    },
    {
      "type": "tool.call",
      "data": {
        "tool": "get_order",
        "arguments": {
          "orderId": "SO202611001"
        },
        "attempt": 1
      }
    },
    {
      "type": "tool.result",
      "data": {
        "tool": "get_order",
        "success": true,
        "result": {
          "kind": "order",
          "orderId": "SO202611001",
          "status": "SHIPPED",
          "customerName": "示例客户",
          "items": [
            {
              "orderItemId": "a8ca43b8-cad6-4b73-b566-827b36678f34",
              "availableForAfterSales": 1,
              "sku": "PHONE-001",
              "name": "智能手机",
              "quantity": 1
            }
          ],
          "estimatedDelivery": "2026-11-10"
        }
      }
    }
  ]
}
```

一般提问、缺少业务参数需要追问、准备草稿均可能返回 `200`，不应把“HTTP 成功”当成“已经执行工具／创建工单”。

业务结果 `result.kind`：

| kind          | 结构与含义                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| `order`       | 与订单详情对象相同，见订单详情示例                                                                                 |
| `inventory`   | 库存行字段＋`kind: inventory`，单商品、单仓库                                                                      |
| `tickets`     | `{ kind, orderId?, tickets: TicketListItem[] }`                                                                    |
| `ticketDraft` | 申请草稿，未创建工单，见下方示例                                                                                   |
| `ticket`      | 历史兼容：`ticketId, orderId, status, type, description, estimatedResponseHours, duplicate`，并非完整 TicketDetail |

库存结果示例：

```json
{
  "kind": "inventory",
  "sku": "PHONE-001",
  "productName": "智能手机",
  "warehouse": "SZ",
  "warehouseName": "深圳仓",
  "available": 120,
  "reserved": 8,
  "updatedAt": "2026-11-09T01:00:00.000Z"
}
```

售后草稿结果示例：

```json
{
  "kind": "ticketDraft",
  "orderId": "SO202611001",
  "type": "REPAIR",
  "description": "手机无法开机",
  "priority": "NORMAL",
  "idempotencyKey": "e221e3a6-dda8-4553-b62b-986a05b206c5"
}
```

草稿不包含已确认的商品／数量，也不代表数据库已有工单。客户端需获取订单详情、让用户选择商品和数量，再用草稿的 `idempotencyKey` 调用 `POST /api/tickets`；对话来源可填写本人会话 `sourceSessionId`。

模型仅可调用 `get_order`、`get_inventory`、`get_tickets`、`prepare_after_sales_ticket`。没有工单状态、分配负责人或库存写入工具。

缺少参数时，也可正常完成本轮并等待用户补充，例如以下 HTTP `200` 响应；没有 result，不应显示业务查询成功：

```json
{
  "runId": "5d948f8a-47bc-4f8c-bde2-4f4677327278",
  "mode": "demo",
  "answer": "请补充或核对订单号（如 SO202611001），我会继续处理。",
  "intent": "get_order",
  "steps": [],
  "sources": [],
  "trace": [
    {
      "type": "intent",
      "data": {
        "intent": "get_order",
        "label": "查询订单"
      }
    },
    {
      "type": "arguments",
      "data": {
        "tool": "get_order",
        "arguments": {}
      }
    },
    {
      "type": "clarification",
      "data": {
        "fields": ["订单号（如 SO202611001）"],
        "message": "请补充或核对订单号（如 SO202611001），我会继续处理。"
      }
    }
  ]
}
```

### POST /api/chat/stream

请求体同上，建议 `Accept: text/event-stream`。这是 POST SSE，请用支持携带请求体的 fetch 流或 HTTP 客户端；原生 EventSource 的 GET 方式不适用。

认证、来源、参数、会话所有权、忙碌及幂等冲突均可能在建连前失败，返回常规 JSON 和非 200 状态。成功建连后响应 `200`：

```http
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

每条记录格式为 `event: 类型`、`data: 单行JSON`，以空行分隔；不能假定一次网络读取恰好是一条事件。开始发送 `: connected` 注释，每 15 秒可能发送 `: heartbeat`，注释不是业务事件。

以下为执行中的部分帧，**不是完整响应流，不能在 message.delta 后直接判定完成**：

```text
event: run.start
data: {"runId":"294678f0-211b-4f88-b321-726230ef7bf9","mode":"demo"}

event: intent
data: {"intent":"get_order","label":"查询订单"}

event: arguments
data: {"tool":"get_order","arguments":{"orderId":"SO202611001"}}

event: tool.call
data: {"tool":"get_order","arguments":{"orderId":"SO202611001"},"attempt":1}

event: message.delta
data: {"content":"订单 SO202611001 已发货"}

```

| 事件            | data 契约                                                              | 客户端含义                                         |
| --------------- | ---------------------------------------------------------------------- | -------------------------------------------------- |
| `run.start`     | `{ runId, mode, replay? }`                                             | 执行开始，replay=true 为已持久化结果回放           |
| `intent`        | `{ intent, label }`                                                    | 业务意图，不是模型内部思维过程                     |
| `arguments`     | `{ tool, arguments }`                                                  | 提取参数；事件本身不代表校验成功                   |
| `clarification` | `{ fields: string[], message }`                                        | 缺少／无效参数，需用户补充；该轮不继续调用对应工具 |
| `tool.call`     | `{ tool, arguments, attempt }`                                         | 实际工具调用；attempt 从 1 开始                    |
| `tool.result`   | `{ tool, success: true, result }` 或 `{ tool, success: false, error }` | 调用结果或失败；不能因出现事件就标为成功           |
| `retry`         | `{ message }`                                                          | 对可恢复工具错误最多重试一次                       |
| `message.delta` | `{ content }`                                                          | 回复文本增量，按顺序拼接                           |
| `run.error`     | `{ code, message, requestId }`                                         | 本轮错误；仍等待结束事件判断终态                   |
| `run.done`      | 完整 ChatResponse 或 `{ runId, failed: true }`                         | 执行结束，检查 error／failed，不等于必定成功       |

成功 `run.done` 的 data 为上一节完整 ChatResponse；路由级异常的结束帧示例：

```text
event: run.error
data: {"code":"INTERNAL_ERROR","message":"服务暂时不可用，请稍后重试","requestId":"294678f0-211b-4f88-b321-726230ef7bf9"}

event: run.done
data: {"runId":"294678f0-211b-4f88-b321-726230ef7bf9","failed":true}

```

### 幂等、断连与错误响应差异

- 幂等键按“当前账号＋requestId”隔离，同会话同内容完成后重试返回持久化结果；不会重复增加消息。相同键用于其他问题或会话返回 `409 IDEMPOTENCY_CONFLICT`；同一会话已有运行中请求返回 `409 SESSION_BUSY`。
- SSE 回放依次发送 `run.start(replay=true)`、完整答案的 `message.delta`、`run.done`；不逐条重放旧工具事件，详细 trace 位于最终响应中。
- 正常完成响应先持久化回复、结果快照及上下文，再发送 run.done。断连停止后续生成；不是 token 级续传。读取历史恢复已落库消息，服务重启会将遗留运行标记为中断。
- 中断后同键重试回放中断结果；如需重新执行，用新 requestId。网络结果不确定时先沿用原键查明结果，不应盲目生成新键。
- 非流式首次执行遇到代理／工具业务错误时，HTTP 状态按错误码映射，但响应体可能是 **带 error 的 ChatResponse**，不是单独 ApiError。参数／权限等执行前异常使用普通 ApiError。
- 已完成非流式幂等回放当前直接返回缓存，HTTP 为 **200**，即使缓存内含 error。SSE 建连后 HTTP 也始终为 200，通过 run.error、run.done.error 或 failed 判断失败。客户端必须同时检查正文和事件，不能只看 HTTP 状态。

非流式工具查不到订单的响应示例：首次执行 HTTP `404`，同键缓存回放可能 HTTP `200`：

```json
{
  "runId": "294678f0-211b-4f88-b321-726230ef7bf9",
  "mode": "demo",
  "answer": "未找到对应订单，请核对订单号",
  "intent": "get_order",
  "steps": [
    {
      "type": "tool",
      "name": "get_order",
      "success": false
    }
  ],
  "sources": [],
  "error": {
    "code": "ORDER_NOT_FOUND",
    "message": "未找到对应订单，请核对订单号",
    "requestId": "294678f0-211b-4f88-b321-726230ef7bf9"
  },
  "trace": [
    {
      "type": "intent",
      "data": {
        "intent": "get_order",
        "label": "查询订单"
      }
    },
    {
      "type": "arguments",
      "data": {
        "tool": "get_order",
        "arguments": {
          "orderId": "SO202611001"
        }
      }
    },
    {
      "type": "tool.call",
      "data": {
        "tool": "get_order",
        "arguments": {
          "orderId": "SO202611001"
        },
        "attempt": 1
      }
    },
    {
      "type": "tool.result",
      "data": {
        "tool": "get_order",
        "success": false,
        "error": {
          "code": "ORDER_NOT_FOUND",
          "message": "未找到对应订单，请核对订单号",
          "requestId": "294678f0-211b-4f88-b321-726230ef7bf9"
        }
      }
    },
    {
      "type": "run.error",
      "data": {
        "code": "ORDER_NOT_FOUND",
        "message": "未找到对应订单，请核对订单号",
        "requestId": "294678f0-211b-4f88-b321-726230ef7bf9"
      }
    }
  ]
}
```

## 错误格式与业务错误码

### 普通接口错误

业务及参数异常通常返回下列 ApiError，不提供堆栈。`message` 用于展示，分支逻辑以 `code` 为准；requestId 为服务端请求标识。

```json
{
  "code": "VERSION_CONFLICT",
  "message": "工单已被其他成员更新，请刷新后操作",
  "requestId": "req-example-01"
}
```

对话内的错误 requestId 通常为该轮 runId。健康检查 503 使用健康状态对象；对话执行错误和 SSE 错误结构见上一节。未知路由和框架级拒绝可能使用框架响应；不要将这些响应误认成业务成功。

下表列出当前源码显式产生的业务错误码及转换码；状态指普通接口／非流式首次执行，对话回放及 SSE 建连后以正文为准。

| code                   | HTTP 状态        | 场景                                                                                      | 处理建议                                 |
| ---------------------- | ---------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------- |
| `INVALID_ARGUMENT`     | 400              | 字段缺失／格式不符、未知 JSON 字段、非法 JSON、商品重复或不属于订单、无效负责人、缺少说明 | 修正请求，不能盲目重试                   |
| `UNAUTHORIZED`         | 401              | 未登录、会话过期、密码错误、账号停用                                                      | 重新登录或联系管理员                     |
| `FORBIDDEN`            | 403              | 角色／负责人权限不足或来源不受信任                                                        | 检查账号权限、Origin、Host               |
| `ORDER_NOT_FOUND`      | 404              | 查询或提交涉及不存在订单                                                                  | 核对实际订单号                           |
| `SKU_NOT_FOUND`        | 404              | 对话工具查询不存在的商品                                                                  | 核对 SKU；库存列表不存在则返回 []        |
| `WAREHOUSE_NOT_FOUND`  | 404              | 对话工具查询不存在仓库                                                                    | 核对仓库编码                             |
| `INVENTORY_NOT_FOUND`  | 404              | 对话工具查询商品与仓库没有库存记录                                                        | 更换仓库或核对库存记录                   |
| `TICKET_NOT_FOUND`     | 404              | 工单不存在                                                                                | 刷新列表并核对工单号                     |
| `USER_NOT_FOUND`       | 404              | 管理员修改不存在账号                                                                      | 刷新账号列表                             |
| `SESSION_NOT_FOUND`    | 404              | 会话不存在、非本人会话或无效来源会话                                                      | 使用本人新建会话，不尝试越权             |
| `ORDER_STATUS_INVALID` | 409              | 订单未发货／未签收，不允许售后                                                            | 核对订单状态                             |
| `QUANTITY_EXCEEDED`    | 409              | 超过商品当前可申请数量                                                                    | 刷新订单详情并调整数量                   |
| `VERSION_CONFLICT`     | 409              | 工单被其他操作更新，版本过期                                                              | 刷新详情后人工确认新操作                 |
| `STATUS_CONFLICT`      | 409              | 当前工单状态／分配状态不允许操作                                                          | 刷新并选择合法动作                       |
| `IDEMPOTENCY_CONFLICT` | 409              | 同一提交／操作／对话编号用于不同内容                                                      | 同次重试保留原完整内容；新操作用新编号   |
| `SESSION_BUSY`         | 409              | 会话运行中、请求运行中或运行中删除                                                        | 等待／刷新，避免并发发送                 |
| `LAST_ADMIN`           | 409              | 试图停用／降级最后一个有效管理员                                                          | 先确保存在其他有效管理员                 |
| `DATA_CONFLICT`        | 409              | 数据库唯一性或事务并发冲突，如重复账号                                                    | 核对是否已成功，刷新后再决定重试         |
| `RATE_LIMITED`         | 429              | 登录每 IP 15 分钟达到 30 次尝试                                                           | 等待窗口结束，减少尝试                   |
| `MODEL_GATEWAY_ERROR`  | 502              | 网关不可用、工具格式／名称错误、执行步骤超限等                                            | 检查网关配置或明确需求后重试             |
| `TOOL_TIMEOUT`         | 504              | 业务工具超时，恢复性重试后仍失败                                                          | 查看 trace，稍后再试                     |
| `INVALID_TOOL_RESULT`  | 500              | 工具结果未通过结构校验                                                                    | 联系维护人员，不使用残缺结果             |
| `INTERNAL_ERROR`       | 通常 500         | 未识别的运行异常                                                                          | 保留 requestId 便于排查                  |
| `RUN_INTERRUPTED`      | 缓存回放通常 200 | 断连／重启等造成持久化中断结果                                                            | 展示中断；用户重新发起时使用新 requestId |

### 当前实现的状态码边界

- `MODEL_GATEWAY_ERROR` 在未配置模式由内部节点标记 503，但 `/api/chat` 最终按错误码映射为 **502**。`GET /api/health` 在未配置模式则返回 503；文档不将它们混为一谈。
- `SERVICE_BUSY` 在 `errorStatus()` 中预留映射为 503，目前没有业务路径主动生成该码，不应当作已实现限流能力。
- 请求体超过 16 KiB 时框架返回 413；不支持的 Content-Type 可返回 415。当前错误处理对这类框架异常可能使用 `INTERNAL_ERROR` 正文，HTTP 仍保留框架状态；不要仅凭 code 将其归为 500。
- 数据库错误 P2002／P2034／P2028／P1008 统一转换成 `409 DATA_CONFLICT`；接口不会向客户端暴露 Prisma 错误码或原始堆栈。

## 联调步骤与示例

### 最小联调顺序

1. 查询 `/api/health`，确认数据库和运行模式。
2. 使用管理员预先创建的账号登录，保存 Cookie；`/api/auth/me` 确认登录。
3. 查询订单列表／详情，使用真实订单号和订单行 ID。
4. 新建会话，用返回的 sessionId 请求 `/api/chat` 或 `/api/chat/stream`；缺参时在同会话补充信息。
5. 若得到 ticketDraft，先由用户核对商品和数量，再提交 `/api/tickets`，不能把草稿当作提交成功。
6. 管理员查询 `/api/users/assignees`，按当前工单 version 分配／转派；客服领取或处理自己负责的工单。
7. 保存 requestId／幂等键和原始请求体处理网络重试；需要新业务操作才生成新编号。

### PowerShell：登录、建会话、非流式对话

以下命令访问已运行的本地服务，会创建本人会话并保存对话；示例订单号需替换成实际订单号。

```powershell
$apiBase = 'http://localhost:3000'
$credential = Get-Credential
$loginBody = @{
  username = $credential.UserName
  password = $credential.GetNetworkCredential().Password
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$apiBase/api/auth/login" `
  -ContentType 'application/json; charset=utf-8' -Body $loginBody `
  -SessionVariable salespilotLogin

$chatSession = Invoke-RestMethod -Method Post -Uri "$apiBase/api/sessions" `
  -ContentType 'application/json' -Body '{}' -WebSession $salespilotLogin
$chatRequestId = [guid]::NewGuid().ToString()
$chatBody = @{
  sessionId = $chatSession.id
  message = '查询订单 SO202611001'
  requestId = $chatRequestId
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$apiBase/api/chat" `
  -ContentType 'application/json; charset=utf-8' -Body $chatBody `
  -WebSession $salespilotLogin
```

### 浏览器：同源读取 SSE

在已登录的工作台来源下执行；`sessionId` 必须来自创建会话接口。此示例仅展示读取原始分块，产品代码仍需按 SSE 空行边界解析事件、拼接跨分块记录、识别注释和最终错误。

```javascript
const response = await fetch("/api/chat/stream", {
  method: "POST",
  credentials: "same-origin",
  headers: {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  },
  body: JSON.stringify({
    sessionId: "替换为本人会话ID",
    message: "查询订单 SO202611001",
    requestId: crypto.randomUUID(),
  }),
});
if (!response.ok) {
  throw new Error(await response.text());
}
if (!response.body) throw new Error("响应不包含可读取的流");
const reader = response.body.getReader();
const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log(decoder.decode(value, { stream: true }));
}
```

## 实现依据与维护

- 公共类型、请求校验、SSE 事件：[`packages/contracts/src/index.ts`](../packages/contracts/src/index.ts)。
- 登录、账号、Cookie、权限及来源校验：[`apps/api/src/auth.ts`](../apps/api/src/auth.ts)。
- 路由：[`apps/api/src/routes/`](../apps/api/src/routes/)。
- 工单状态、数量、版本及操作幂等：[`apps/api/src/tools/ticket.ts`](../apps/api/src/tools/ticket.ts)。
- 会话所有权、持久化及对话幂等：[`apps/api/src/session-store.ts`](../apps/api/src/session-store.ts)。
- 错误转换：[`apps/api/src/errors.ts`](../apps/api/src/errors.ts)、[`error-handler.ts`](../apps/api/src/error-handler.ts)。
- SSE 帧、心跳和回放：[`apps/api/src/sse.ts`](../apps/api/src/sse.ts)。
