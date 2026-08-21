# Tiger Technical Context

> Tiger 的长期工程、Supabase、安全和部署上下文。最后核对：2026-08-19。

先阅读 [`PRODUCT_CONTEXT.md`](./PRODUCT_CONTEXT.md) 理解产品行为。本文用于在聊天 compact、任务交接或长期维护后快速恢复技术上下文。

## 1. 事实来源顺序

发生冲突时按以下优先级判断：

1. 只读检查到的线上数据库 metadata：当前生产事实。
2. [`supabase/schema.sql`](./supabase/schema.sql) 的基础结构，加上 [`supabase/migrations`](./supabase/migrations) 中按版本排序的全部演进：可重建的数据库意图。
3. [`src`](./src) 当前代码：已发布前端行为。
4. [`PRODUCT_CONTEXT.md`](./PRODUCT_CONTEXT.md)：已接受的产品决定。
5. 本文：架构、运维和安全边界。
6. README、截图和旧聊天：只用于参考。

[`supabase/schema.sql`](./supabase/schema.sql) 是基础初始化快照；后续馆务中心、审计、管理员管理、定价、置换、关联和历史锁定存在于 migrations。新项目重建时二者缺一不可；已有线上项目不能重新覆盖执行 schema snapshot。

## 2. 项目与线上环境

- GitHub：`tujiaqi2002/badminton`，公开仓库，默认分支 `main`。
- 生产前端：`https://tujiaqi2002.github.io/badminton/`。
- Supabase project ref：`ldbtrouofmqmnkyxiewk`。
- Supabase URL：`https://ldbtrouofmqmnkyxiewk.supabase.co`。
- 数据库：PostgreSQL 17，项目状态在 2026-08-19 为 `ACTIVE_HEALTHY`。
- 自定义域名 `tiger.io` 尚未配置；用户拥有并完成 DNS 前不能添加 `CNAME`。

禁止提交数据库密码、access token、service-role、Stripe secret、Webhook secret、真实馆长邮箱和客户数据。

## 3. 技术栈

### 前端

- React 18 + Vite 6。
- JavaScript / JSX。
- `@supabase/supabase-js` 2.x。
- `lucide-react`。
- CSS 响应式布局与 PWA 资源。
- GitHub Pages 静态托管。

应用通过 [`src/App.jsx`](./src/App.jsx) 内部 view state 切换 `book`、`mine`、`admin`、`capacity`、`operations`，当前没有 URL Router。

### 后端

- Supabase Auth。
- PostgreSQL：RLS、约束、trigger、`SECURITY DEFINER` RPC。
- Realtime 排期同步。
- 可选 Supabase Edge Functions（Stripe）。

GitHub Pages 没有可信服务器运行时。特权写入、权限裁决、并发冲突、最终计价和秘密凭据必须留在 PostgreSQL RPC 或 Edge Function。

## 4. 主要代码结构

| 领域 | 文件 |
| --- | --- |
| 应用/Auth/查询/变更 | `src/App.jsx` |
| 客户排期 | `BookingBoard.jsx`, `BookingDrawer.jsx`, `DateStrip.jsx` |
| 我的订单 | `MyBookings.jsx` |
| 馆长排期 | `AdminBookings.jsx`, `AdminSchedule.jsx`, `AdminRescheduleModal.jsx` |
| 场地监控 | `AdminCapacity.jsx`, `WeeklyCapacityMonitor.jsx` |
| 日志摘要 | `AdminAuditDrawer.jsx` |
| 馆务中心 | `VenueOperations.jsx` |
| 顶栏/设置 | `Header.jsx`, `DisplaySettings.jsx` |
| 时间、价格、场地常量 | `src/lib/booking.js` |
| 置换计算 | `src/lib/bookingSwap.js` |
| 订单颜色生成 | `src/lib/bookingColors.js` |
| 中英文本 | `src/lib/i18n.js` |
| 七套主题 | `src/lib/theme.js` |
| 字体/配色偏好 | `src/lib/display.js` |
| Supabase client | `src/lib/supabase.js` |

`VenueOperations` 使用 lazy import，避免主 bundle 过大。

## 5. 构建变量

| 变量 | GitHub 存放位置 | 用途 |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Actions Secret | Supabase 公共项目 URL |
| `VITE_SUPABASE_ANON_KEY` | Actions Secret | 浏览器可用 anon/publishable key |
| `VITE_GOOGLE_AUTH_ENABLED` | Actions Variable | Google 登录开关 |
| `VITE_STRIPE_ENABLED` | Actions Variable | 在线支付 UI 开关 |

Supabase client 启用 session persistence、自动刷新和 OAuth redirect 检测。session 只证明身份；前端还会读取 `staff_members`，数据库 RPC/RLS 会独立验证馆长权限。

Magic Link 与 Google OAuth 都回到当前站点的 `origin + pathname`，不携带页面查询参数或 hash。Google OAuth 先经过 Supabase 的 `/auth/v1/callback`，Google Cloud 中不能把应用页面误填成 OAuth callback。`VITE_GOOGLE_AUTH_ENABLED` 只控制入口是否显示，不参与权限判断。

任何 `VITE_` 变量都会进入浏览器包，绝不能放 `service_role`、数据库密码或 Stripe secret。

## 6. Auth 与馆长权限

### 当前链路

1. 应用在 Auth 完成前锁住主界面。
2. Magic Link 与 Google OAuth 都经过 Supabase Before User Created hook，并调用 `public.hook_allow_manager_accounts`。
3. Hook 在 `private.manager_accounts` 检查 invited/active 邮箱。
4. 新用户创建后，`private.activate_invited_manager` 关联 Auth user，并写入 `public.staff_members(role='admin')`。
5. 客户端只能读取自己的 `staff_members` 角色。
6. 所有馆长 RPC 内部再调用 `private.require_manager()`。

因此篡改 localStorage、JWT 以外的 UI state 或前端 `isAdmin` 都不能获得数据库管理权限。

### 管理员管理 RPC

- `admin_list_manager_accounts()`：返回安全管理员目录。
- `admin_invite_manager(text)`：邀请/重新启用邮箱。
- `admin_set_manager_status(uuid, boolean)`：启停权限。

`private.manager_accounts` 强制 RLS，未开放客户端直接权限。当前限制：不能停用自己、不能停用最后一位 active 馆长、非 disabled 记录最多 25 条。邀请只登记权限，不发送邮件。

禁止恢复前端硬编码邮箱白名单。

## 7. 线上数据模型

2026-08-19 已通过 Supabase 只读连接确认下列表存在且 RLS 已开启。

### Public schema

| 表 | 责任 |
| --- | --- |
| `courts` | 五片稳定场地 ID 与展示信息 |
| `profiles` | 用户公开资料 |
| `staff_members` | 用户与馆长角色桥接 |
| `bookings` | 私有订单、联系人、状态、支付、价格、分组/关联/重复 |
| `court_slots` | 不含客户身份的占用投影 |
| `venue_settings` | 单例球馆配置 |
| `venue_opening_hours` | 每周营业时间 |
| `venue_pricing_rules` | 场地/时间/星期/会员/日期计价 |
| `venue_events` | 活动、维护、闭馆和推广 |
| `venue_event_courts` | 活动与场地关系 |
| `venue_members` | 会员档案 |
| `venue_member_tiers` | 会员等级定义 |

### Private schema

| 表 | 责任 |
| --- | --- |
| `booking_admin_actions` | 早期订单动作/撤回兼容层 |
| `app_audit_events` | 追加式应用操作日志 |
| `manager_accounts` | 馆长邀请与授权事实来源 |

`bookings` 的重要后续字段包括：

- `booking_group_id`：一次创建的多场地订单组。
- `recurrence_series_id`, `recurrence_week`：重复周订。
- `booking_link_id`：馆长后续建立的关联。
- `customer_phone`, `customer_notes`。
- `system_calculated_amount`。
- `price_source`, `price_override_amount`, `price_overridden_by`, `price_overridden_at`。

修改表前必须阅读完整迁移链确认基础字段、enum 和约束。

## 8. 线上迁移状态

2026-08-19 线上与本地均核对到 36 个版本，范围：

- 首个：`20260812161833_private_manager_schedule`
- 最新：`20260817231907_index_manager_audit_relations`

本次未发现之前的 “Remote migration versions not found in local migrations directory” 漂移。

### 迁移规则

- 每次 schema/RPC/RLS 变化增加新的时间戳 migration。
- 已在线应用的 migration 不得回改。
- DDL 使用 Supabase migration 工具，不用普通 SQL query 工具。
- 推送新 migration 前先比较 local/remote versions。

如果再次出现 remote version 缺失：先停止发布，找回对应 SQL 或拉取远端状态，核对内容后才允许 migration repair；不能仅为了消除提示而伪造 applied 状态。

## 9. 订单一致性与原子操作

### 防超卖

同一场地的有效订单范围由 PostgreSQL GiST exclusion constraint 防止重叠。前端检查只为更快反馈，不能替代并发约束。

### RPC 范围

迁移链已经包含：

- 客户单/多场地创建与取消。
- 馆长单/多场地、每周重复创建。
- 馆长价格预览和手动改价创建。
- 单订单和订单组移动。
- 以 anchor court 平移连续多场地组。
- 一对多原子置换。
- 关联订单组。
- 馆长取消。
- 编辑订单详情。
- 最近操作撤回和指定 audit operation 回滚。

管理端多场地移动范围由 `venue_settings.multi_court_drag_mode` 持久化为 `group` 或 `single`，并在馆务中心统一设置。排期详情不重复展示这项配置，拖动预览会说明本次实际生效范围；整组模式调用现有 group move/reschedule RPC，单场模式调用现有 `admin_reschedule_booking`。两种模式都保留 `booking_group_id` 和 `booking_link_id`，冲突、计价、权限和审计仍由数据库现有 trigger/RPC 最终裁决。

禁止用多次前端顺序写入替代原子多行 RPC。

### 时间规则

- 默认时区 `America/Toronto`，可配置。
- 默认营业范围 10:00–24:00，但实际以 weekday 配置为准。
- 默认运营步进 30 分钟。
- 客户最短默认 60 分钟；客户/馆长最长均可配置。
- 馆长最短 30 分钟。
- 客户不能预订过去。
- 已开始订单锁定开始时间和场地，但允许修改结束时间。
- `venue_settings.lock_historical_bookings` 默认 `true`。

## 10. 价格引擎

按每个场地、每个 slot segment 计算。当前前端 demo preview 和数据库遵循相同的“具体程度”排序：

1. 有有效日期范围优先于永久规则。
2. 日期边界更完整、范围更窄优先。
3. 指定会员等级优先。
4. 指定场地优先。
5. 明确/更窄星期范围优先。
6. 更窄时间范围优先。
7. 更新时间和 ID 作为确定性 tie-breaker。

会员折扣在小计后应用。多场地逐场计算。数据库 trigger 保证基础价格覆盖，提交时以数据库计算为准。

前端 manager form 可调用 `admin_preview_booking_price`，并通过 `admin_create_*_with_price` 记录明确的馆长 override。客户界面不显示内部 rule name。

## 11. RLS 与 API 暴露边界

必须长期保持：

- 所有客户端可达表启用 RLS。
- 馆务表强制 RLS、撤销直接 grants，仅通过 RPC 使用。
- private schema 不向 `anon`/`authenticated` 直接开放。
- 用户只能读取自己的私人订单。
- `court_slots`/客户 slot RPC 只暴露占用，不泄露客户身份。
- audit 表拒绝客户端直接增删改。
- `SECURITY DEFINER` function 设置明确空 `search_path` 并使用 schema-qualified reference。
- function 先 revoke，再只向必要角色 grant execute。

Supabase 新项目正在趋向默认不把新表暴露到 Data API；migration 仍必须明确决定 RLS 和 grants，不能依赖 Dashboard 默认值。

### 线上安全顾问现状（2026-08-19）

- `private.manager_accounts` 和 `venue_member_tiers` 报告 “RLS enabled, no policy”。前者是有意的 deny-by-default private table；后者通过 manager RPC 使用，但未来 migration 应增加显式 deny policy 以让意图更清楚。
- `btree_gist` 位于 `public` schema，顾问建议迁移到独立 extension schema；改动前必须评估 exclusion constraint 依赖。
- 多个 `SECURITY DEFINER` RPC 被 `authenticated` 调用，顾问会统一警告。这里是设计所需，但每个函数必须保留 `private.require_manager()` 或严格 owner/customer 校验，不能把“有内部校验”当成永久假设。
- Leaked password protection 未启用。当前主要是 Google/OTP，但如开放密码登录应启用。

参考 Supabase remediation：

- [Database linter](https://supabase.com/docs/guides/database/database-linter)
- [Password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

Performance advisor 当前主要报告尚未使用的索引。项目数据量较小，不能只因 `unused_index` 就删除；需结合生产查询计划和增长后数据再决定。

## 12. 馆务中心 RPC

主要 manager-only RPC：

- `admin_get_venue_operations`
- `admin_update_venue_settings`
- `admin_replace_opening_hours`
- `admin_upsert_pricing_rule`
- `admin_delete_pricing_rule`
- `admin_upsert_venue_event`
- `admin_cancel_venue_event`
- `admin_upsert_member`
- `admin_get_member_tiers`
- `admin_upsert_member_tier`
- `admin_search_members`
- `admin_search_audit_events`
- `admin_get_venue_schedule_events`

客户/配置读取：

- `get_venue_booking_configuration(date)`
- `get_customer_court_slots(date)`

增加新的 venue setting 时必须同时完成：

1. migration 与数据库 constraint。
2. 读取/写入 RPC JSON contract。
3. 馆务中心 form。
4. 所有消费该设置的客户、馆长页面和数据库 validation。

## 13. Audit 与撤回

`private.app_audit_events` 是长期追加式日志。订单和馆务 mutation 记录 before/after、changed fields、actor、source、entity、operation id 和版本化 metadata。

排期侧使用：

- `admin_list_recent_audit_operations(10)`：精简摘要。
- `admin_revert_audit_operation(operation_id)`：撤回指定且仍安全的操作。
- `admin_undo_last_booking_action()`：Ctrl+Z。

馆务中心使用 `admin_search_audit_events(...)` 做完整分页查询。

新增日志实体时保留稳定的 `event_type`、`entity_type` 和 `metadata.schema_version`；不要把非订单操作硬塞进 booking 字段。回滚前必须确认当前数据仍等于预期 after state，避免覆盖其他馆长后续修改。

## 14. Realtime

Realtime 监听不含客户身份的排期投影。它是同步便利通道，不是事务结果；mutation 完成后仍要刷新权威数据，并能容忍漏发和重复事件。

扩展 subscription 或 schema 前需重新核对最新 Supabase Realtime publication 和 schema 支持。

## 15. Edge Functions 与 Stripe

仓库包含：

- `supabase/functions/create-checkout/index.ts`
- `supabase/functions/stripe-webhook/index.ts`

但 2026-08-19 线上 Supabase 返回 **0 个已部署 Edge Functions**。因此当前只能把 Stripe 视为代码骨架，`VITE_STRIPE_ENABLED` 应保持关闭，安全默认是到店支付。

上线 Stripe 前必须：部署 functions、配置 server-only secrets、验证签名、保证 webhook 幂等、从数据库计算金额而非信任前端、测试成功/失败/过期/重复回调。

## 16. GitHub Pages 部署

工作流：[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)。

每次 push 到 `main`：

1. pnpm 11.16.0。
2. Node 22。
3. frozen lockfile 安装。
4. 注入 secrets/variables 后 Vite build。
5. 上传 `dist` Pages artifact。
6. GitHub Pages deploy。

Vite `base` 为 `./`，支持 `/badminton/` 子路径。

正常变更流程：`codex/...` 分支 → 本地验证 → commit/push → PR → merge `main` → 检查 Actions 和线上页面。除非仓库策略改变，不提交 `dist`。

## 17. 验证清单

### 所有变更

- `pnpm lint`
- `pnpm build`
- `git diff --check`
- 检查中文/English。
- UI 改动检查桌面和手机。

### 订单逻辑

- 单/多场地创建。
- 并发冲突只能成功一个。
- 30 分钟移动和 resize。
- no-op drop、无效/过去落点。
- 已开始订单只改结束。
- group move、swap、link、cancel、undo。
- 价格 preview 等于最终保存金额。
- Realtime/刷新后状态一致。

### 数据库/安全

- 新表 schema exposure、grants、RLS。
- 非馆长调用 manager RPC 必须失败。
- 用户不能读取他人订单身份。
- 运行 Supabase security/performance advisors。
- 比较 remote/local migration versions。
- 检查 function `search_path`、权限和 owner。

### 馆务配置

- 保存并重开馆务中心。
- 验证场地页、预订管理、场地监控。
- 使用直接 RPC 尝试无效动作，确认数据库也阻止。

## 18. 已知边界

- 当前生产访问是馆长限定，即使客户 UI 已存在。
- Stripe 尚未部署上线。
- `supabase/schema.sql` 不是当前完整安装包。
- demo mode 只近似后端行为，不能证明生产正确。
- 显示偏好和尚未账号化的馆长交互偏好（包括拖拽方向锁定）保存在 `localStorage`，尚未跨设备同步。
- Security advisor 的预期 warning 仍需逐函数持续审计，不能整体忽略。

## 19. 上下文维护

任何改变产品行为、schema、RPC contract、Auth、权限、计价、馆务配置、部署或安全模型的 PR，都必须同步更新 `PRODUCT_CONTEXT.md` / `TECHNICAL_CONTEXT.md`。这两份文档的目的就是让 compact 和后续交接安全；过期上下文本身属于缺陷。
