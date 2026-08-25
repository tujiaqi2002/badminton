# Tiger Technical Context

> Tiger 的长期工程、Supabase、安全和部署上下文。最后核对：2026-08-25。

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
- 数据库：PostgreSQL 17.6（平台 build `17.6.1.155`），项目状态在 2026-08-23 为 `ACTIVE_HEALTHY`。
- 独立 staging：`badminton_stage` / project ref `vcoujmzsgdboidndtzzg`，PostgreSQL 17.6、同为 `us-west-2`；只使用 `example.invalid` 客户与单一 synthetic Auth/manager，不复制任何生产 PII。生产 ref 禁止用于 staging fixture 或未授权 migration。
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
| `VITE_RESERVATION_READ_SHADOW` | Actions Variable | 默认关闭；馆长排期 canonical shadow read 观察开关 |

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
6. 馆长 RPC 必须在数据库端校验权限。较新的入口统一调用 `private.require_manager()`；部分 legacy RPC 使用等价的 `auth.uid()` + `staff_members` 内联校验，`admin_create_booking` 则包装安全的 multi-booking RPC。不能假设所有现有入口都直接调用同一个 helper。

因此篡改 localStorage、JWT 以外的 UI state 或前端 `isAdmin` 都不能获得数据库管理权限。

### 管理员管理 RPC

- `admin_list_manager_accounts()`：返回安全管理员目录。
- `admin_invite_manager(text)`：邀请/重新启用邮箱。
- `admin_set_manager_status(uuid, boolean)`：启停权限。

`private.manager_accounts` 强制 RLS，未开放客户端直接权限。当前限制：不能停用自己、不能停用最后一位 active 馆长、非 disabled 记录最多 25 条。邀请只登记权限，不发送邮件。

禁止恢复前端硬编码邮箱白名单。

## 7. 线上数据模型

2026-08-23 已通过 Supabase 只读连接确认下列表存在且 RLS 已开启。

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

### Reservation 目标模型（已确认；Phase 1 物理基础已上线）

Issue #118 已确认目标 ownership model 为 `Reservation → Sessions → Court allocations`，并拆分 party roles、payment intent、真实 payment ledger、payment allocations 与 recurrence series。Phase 1 空表和 nullable ownership columns 已进入生产，但当前读写行为仍以 `bookings` row-per-court 加 `booking_group_id` / `booking_link_id` 运作；“schema 已存在”和“业务已切换”不能混写为同一事实。

第一轮物理迁移保持 additive：新增 `reservations`、`reservation_sessions`、party/payment/recurrence 父实体，并给现有 `bookings` 增加 nullable `reservation_id` / `session_id`。`bookings` 暂时继续作为 Court allocation 物理表和冲突时间投影，保留 `bookings_no_time_overlap`、`court_slots`、legacy 字段和旧 RPC，直到 shadow reconciliation 和生产观察完成。

新时间字段使用 `timestamptz`；legacy `timestamp` 必须在 backfill 时按 `venue_settings.timezone`（当前 `America/Toronto`）解释并单独验证 DST。金额继续使用 `numeric`。所有关系使用 FK/关系表，所有 FK 与 RLS 查询列建立匹配索引，不用 JSON/数组代替核心关系，也不在当前规模提前分区。

Phase 0 报告位于 [`docs/reservation-migration/phase-0-baseline.md`](./docs/reservation-migration/phase-0-baseline.md)，可复跑只读 SQL 位于 [`supabase/diagnostics/phase_0_reservation_baseline.sql`](./supabase/diagnostics/phase_0_reservation_baseline.sql)。报告只给 Phase 1 additive schema 有条件通过，不授权 migration 或生产写入。

### Phase 1 additive schema（生产已应用；backfill 见 Phase 2，尚未 cutover）

Issue #121 / migration `20260823072016_reservation_aggregate_schema` 新增 9 张空表：`recurrence_series`、`reservations`、`reservation_legacy_sources`、`reservation_parties`、`reservation_party_roles`、`reservation_sessions`、`reservation_payment_shares`、`payments`、`payment_allocation_entries`。现有 `bookings` 只增加 nullable、无 default 的 `reservation_id` / `session_id`。

关键物理约束：

- booking ownership 两列同时为空或同时存在；Session/Reservation 使用 composite FK，currency 也与 Reservation 对齐；
- 接入新模型的 booking 由 private security-invoker trigger 按 venue timezone 校验 Session `timestamptz` 与 legacy local `timestamp` 投影；
- Party roles/payment shares 不能引用另一笔 Reservation 的 Party，每笔 Reservation 最多一个 primary contact；
- Payment payer/refund 与 allocation ledger 使用 composite FK 保证同一 Reservation；provider/idempotency 唯一；ledger 为 signed append-only；
- 正常 Payment 的 `occurred_at` 必填；仅 `legacy_reconciliation` 可为 null，禁止为无法还原付款时间的旧 paid rows 使用 migration time 或 booking time 冒充；
- 9 张 public 表均 RLS + FORCE RLS，authenticated 只有 manager-only SELECT，anon/service_role 无 direct grants；没有新增 public RPC/view/Realtime publication；
- 全部 FK 有 leading-column index，不分区，不移动 `btree_gist`，不削弱 `bookings_no_time_overlap`。

详细设计与隔离验证证据见 [`docs/reservation-migration/phase-1-schema.md`](./docs/reservation-migration/phase-1-schema.md)。2026-08-23 生产复核确认 migration history、9 张空表、nullable/default-free ownership columns、约束、RLS/FORCE RLS、最小 grants、private integrity functions、触发器和 FK indexes 均完整；没有新增 Realtime table，也没有 backfill 任何 legacy booking。

### Phase 2 deterministic backfill（生产已应用，尚未 dual-write/read cutover）

Issue #123 / migration `20260824015013_reservation_deterministic_backfill` 将冻结的 192 条 legacy bookings 映射为 123 Reservations、135 Sessions、131 Parties、2 个 recurrence series、23 Payments 和 26 allocations。`bookings` 只补 ownership columns，旧 group/link/recurrence、价格、状态、时间和 slot 投影保持不变；没有 dual-write、read cutover、public RPC、Realtime 或 client DML grant。

所有目标 UUID 使用分实体 UUIDv5 namespace 和稳定 source key；reference/source/allocation identity 与 idempotency keys 使用固定排序。主要联系人按冻结时刻的 active group、最早创建时间、group UUID 选择，避免执行时间导致结果漂移。Toronto 本地时间必须是唯一、可 round-trip 的 `America/Toronto` 值，nonexistent 和 ambiguous DST 都 fail-closed。

历史 payer intent 不可证明，因此 payment plan 增加内部 `legacy_unspecified`，不创建 payment shares。5 条有付款审计的 paid bookings 按最后有效 paid transition 重建为 2 笔 audit-backed Payments；21 条无审计 paid bookings 各自创建 1:1 reconciliation Payment/allocation。总 Payment 和 allocation 均为 CAD 1,642.00，未知 payer/provider/time 保持 null，`pay_at_venue` 不转为 succeeded，cancelled + paid 不推断 refund。

隔离环境实际应用 Phase 1 + Phase 2 migration 及完整诊断；两个独立数据库的 aggregate/role/ledger/ownership mapping fingerprint 一致，8 个 happy/negative/rollback tests 通过。PR #126 合并后，Supabase GitHub integration 于 2026-08-24 04:46:10 UTC 自动应用第 39 个 migration；上线后只读诊断完整通过。详细证据见 [`docs/reservation-migration/phase-2-backfill.md`](./docs/reservation-migration/phase-2-backfill.md)。

### Phase 3A compatibility foundation（42 个 migration 已生产；未激活）

Issue #128 / migration `20260824052629_reservation_phase_3a_compatibility_foundation` 只为后续 dual-write 建立未激活基础：复用 Phase 2 的 deterministic UUIDv5 与严格 Toronto DST 规则，提供 private、cursor-bounded、advisory-lock + stable row-lock 的 group/recurrence catch-up，以及 manager-only、zero-PII 的 security-invoker shadow mismatch view/RPC。migration 本身不调用 catch-up，不包装或替换旧 writer，不切换 read path，也不新增 client DML 或 Realtime publication。

生产 catalog 当前有 17 个直接写 `public.bookings` 的 routine、3 个间接 wrapper，以及 2 个尚未部署的 Stripe Edge write path。Phase 3A 对 unsafe relationship/financial transition 采取 fail-closed：不同 Reservation 的 group 之后被 link/unlink、一个 Reservation 的 legacy scope 被拆散、paid flag 与 ledger 不一致等情况只报告 mismatch，不伪造 merge/split、Payment、refund 或 allocation history。

Phase 1 的 `bookings_enforce_session_projection` 会立即校验 owned booking 的 legacy local schedule 与 Session `timestamptz`。因此现有只更新 `bookings` 的 move/reschedule/swap/undo RPC 在 owned rows 上不能作为 Phase 3 写入路径；Phase 3B 必须在同一事务中按固定锁顺序同步 Session 与 Court allocation，不能删除或放宽该约束。ownership-only catch-up trigger 只保留旧 `updated_at`；`sync_public_court_slot` 对非排期字段变化提前返回，避免污染 slot/Realtime 证据。

Phase 2/3A 共 14 项 PGlite integration tests 已通过：完整 Phase 2 映射、authenticated 馆长/非馆长的实际 view/RPC 权限路径、policy consolidation、authenticated DML grant drift fail-closed、空 drift、分批幂等 catch-up、新 legacy group、客户身份冲突、unsafe link 与付款 drift 均有覆盖。设计与发布门禁见 [`docs/reservation-migration/phase-3a-compatibility-foundation.md`](./docs/reservation-migration/phase-3a-compatibility-foundation.md)，部署后只读验证脚本为 [`supabase/diagnostics/phase_3a_reservation_compatibility.sql`](./supabase/diagnostics/phase_3a_reservation_compatibility.sql)。

PR #129 合并后，Supabase integration 于 2026-08-24 12:59:44 UTC 成功应用第 40 个 migration。上线后 postgres/admin diagnostic 在把 writer inventory 正确限定为 17 个 `public` legacy writers 后完整通过；192/192 ownership、aggregate/payment/Session 对账、Realtime boundary 与冻结 legacy/slot/payment-audit 指纹均无漂移，catch-up audit events 为 0，advisor 基线仍为 security 47（2 INFO / 45 WARN）和 performance 40 INFO。

真实 `authenticated` 角色验证发现 view 对 `public.venue_settings.timezone` 的依赖被既有 `venue_settings_rpc_only` RLS 与缺失 grant 正确阻止，导致 manager/non-manager 都收到 `42501`。不能为此开放整张配置表。PR #130 / migration `20260824130514_reservation_phase_3a_shadow_timezone_access` 只授予 authenticated `timezone` 单列 SELECT，并增加 manager-only SELECT policy；其他 columns 与所有 writes 继续 RPC-only。该 migration 于 2026-08-24 13:18:16 UTC 由 Supabase integration 自动应用。生产角色测试确认 manager 可读 clean status、non-manager 为 0 rows/RPC rejected，且 column grant 精确为一列；Phase 2/3A diagnostics 与冻结指纹无漂移。

部署后 performance advisor 新增一条 `multiple_permissive_policies` WARN：既有 `venue_settings_rpc_only FOR ALL ... false` 与 manager SELECT policy 都是 permissive，并在 authenticated SELECT 上以 OR 评估。Issue #131 / migration `20260824132704_phase_3a_venue_settings_policy_consolidation` 先断言 RLS + FORCE RLS、精确 policies、timezone-only column grant 和无 authenticated table/DML grants，再只删除冗余 false policy。删除后 manager SELECT 是唯一适用读取 policy；INSERT/UPDATE/DELETE 因无适用 policy 被 RLS 默认拒绝，同时仍没有 client DML grants。migration 不改变数据、RPC、view、Realtime、catch-up、dual-write 或前端。

用户在 fresh production preflight 后明确授权 PR #132 merge/生产部署。PR 于 2026-08-24 13:47:59 UTC 合并，Supabase integration 于 13:48:37 UTC 应用第 42 个 migration。上线后 Phase 2/3A diagnostics、真实 manager/non-manager authenticated 路径、RLS/grants metadata、数据总量与四个冻结指纹全部通过；审计总数仍为 1,739，catch-up events 为 0，17 个 public booking writers、private helper grants 和仅 `court_slots` 的 Realtime boundary 均未改变。Security advisor 保持 47 条，performance advisor 恢复为 40 个 `unused_index` INFO，目标 WARN 消失。

### Phase 3B.1 inactive transaction kernel（PR #135；历史安装记录，现已由 Phase 3B.2 激活）

Issue #134 最初只授权 3B.1 authoring。用户在 2026-08-25 fresh production preflight 后单独授权合并 #135；Supabase GitHub integration 已将 migrations `20260824143442_reservation_phase_3b_inactive_transaction_kernel` 和 `20260824164530_phase_3b_writer_inventory_c_collation` 应用生产。该内核为未来原子 writer activation 提供 private transaction primitives，但仍不替换 public routines、不调用 catch-up、不切 read path、不新增 client DML 或 Realtime publication。

关系变化采用 append-only 表达：`reservation_transitions`、source/target/allocation/Party lineage 表保存 merge、split 和 reverse；`reservation_allocation_memberships` 是唯一可变、可重建的 current-effective projection。`bookings.reservation_id` 继续是不可变 physical Reservation origin；`booking.session_id` 是该 origin 内的 legacy schedule projection，可在 reschedule/reverse 时原子指向新的 projection Session。membership 只允许由新 transition 单版本推进，transition history 拒绝 UPDATE/DELETE。Party lineage 主键允许 one-to-many 与 many-to-one，覆盖 split 后 reverse 汇回同一 Party 的合法场景。reverse 根据当前 effective Session 重建 restored Session，因此后续 schedule/details 不会被 transition 创建时的旧 Session facts 覆盖；分化后的 Session 保持分开。

付款语义把 `payment_allocation_entries.reservation_id` 定义为收款时的 commercial/effective Reservation，而 `booking.reservation_id` 继续保留 physical origin。为允许一笔 Payment 跨多个 origin 的 Court，草案把 allocation booking FK 从 composite `(booking_id, reservation_id)` 调整为 `booking_id -> bookings.id`；业务归属由 private payment primitive 在锁内验证 effective membership、currency、payer Party、剩余金额与完整 scope。Payment/refund/allocation 继续 append-only；refund 使用新的负数 entries，legacy payment status 在同一事务从 ledger balance 投影。

所有 private mutation 使用 stable `operation_id` + request fingerprint，设置 transaction-local 5 秒 lock timeout / 30 秒 statement timeout，并使用 operation advisory lock、按 UUID 排序的 booking advisory locks，再按 Reservation → Session → booking → membership/Party/Payment 顺序取得 row locks。相同请求重试返回原结果；key 被不同请求复用、已提交未完成 operation 或不完整 merge/split scope均 fail closed。任何 constraint 失败会回滚 journal、新 aggregate、legacy projection 和 audit。

`private.reservation_phase3b_writer_inventory` 固定 17 个 schema-qualified direct writer signatures、3 个 wrappers 与 2 个 undeployed Stripe paths；assertion 根据 catalog/body/grants/security config 精确对账并输出 fingerprint，新增 rogue writer 时 fail closed。六张 public transition/membership 表均 RLS + FORCE RLS，authenticated 只有 manager-only SELECT，所有 client role 无 DML；全部 private helpers 为 security-invoker、空 `search_path` 且无 client EXECUTE。

Hosted staging 首次运行 diagnostic 时发现 inventory column 使用 ICU/default collation，而由 `pg_catalog.format` 生成的 candidate signature 使用 `C` collation；同一 17-member 集合因此出现数组顺序误报。Append-only migration `20260824164530_phase_3b_writer_inventory_c_collation` 将 signature identity/order 固定为 `C`，hosted diagnostic 随后通过。此前 `a28b...` 是 ICU/default ordering；生产当前按 `C` ordering 的 direct raw fingerprint 为 `ac236...`。raw `pg_get_functiondef` fingerprint 还会受 CRLF 和纯 SQL 格式化影响，不能作为跨项目相等断言；跨环境硬门禁是 canonical signature 集合、`prosecdef`/empty `search_path`、最小 grants 与 wrapper indirectness，raw fingerprint 只用于同一数据库的 fresh before/after review。

隔离测试使用真实 Phase 1/2/3A migration 链，覆盖 inactive apply、幂等、schedule/details/cancel 与 full rollback、不同客户显式-primary merge、Party lineage、一人/AA/退款、跨-origin Payment、已付款 split、merge/split reverse、permission denial、writer drift 和 read-only diagnostic。PR #135 merge 前的首轮 `reservation-db-tests` 已在 PostgreSQL 16.15、Node 22、pnpm 11.16.0 上使用三个真实连接通过：22/22 tests、0 fail、0 skip，same-key Payment retry、重叠 AA 与 competing refund 均证明 advisory/row lock 顺序、幂等和失败回滚在真实 session 下成立；lint 与 build 同时通过。证据为 [Actions run 32746853283](https://github.com/tujiaqi2002/badminton/actions/runs/32746853283)。设计见 [`docs/reservation-migration/phase-3b-inactive-transaction-kernel.md`](./docs/reservation-migration/phase-3b-inactive-transaction-kernel.md)，诊断见 [`supabase/diagnostics/phase_3b_inactive_transaction_kernel.sql`](./supabase/diagnostics/phase_3b_inactive_transaction_kernel.sql)。

最终本地使用 bundled Node `v24.19.0` / pnpm `11.19.0` 跑通 21 个 PGlite migration-chain tests、lint 与 build；1 个 real-PostgreSQL concurrency test 因本机无服务明确 skip，并已由上述 PR CI 成功执行。2026-08-24 15:57 UTC 的 merge 前 fresh production Phase 2/3A diagnostics 再次通过：192/192 bookings owned、123 Reservations、135 Sessions、131 Parties、23 Payments、26 allocations/CAD 1,642.00、0 shadow mismatch/catch-up、1,739 audit events，Realtime 仍只有 `court_slots`。当时 production 为 42 migrations 与未应用 3B.1 的 advisor 47 security（2 INFO / 45 WARN）/ 40 performance INFO 基线；没有执行 local `db push`。

用户另建并授权初始化独立 `badminton_stage` 后，已用首个 migration 前的 Git schema、原始 migrations 1–38、确定性 synthetic legacy fixture、仅替换四个冻结数据指纹的 Phase 2，以及原始 Phase 3A/3B migrations 完成 hosted replay。Migration history 与仓库 44 个 version/name 精确一致；Phase 2/3A/3B diagnostics、RLS/grants、Realtime 和 inactive-zero-row 门禁全部通过。初始化生成器与双语说明位于 [`supabase/staging`](./supabase/staging)。该项目完成 production-like hosted apply；follow-up [Actions run 32753722730](https://github.com/tujiaqi2002/badminton/actions/runs/32753722730) 又在 PostgreSQL 16.15 上得到 22/22、0 fail、0 skip。这两项证据当时不授权 merge/生产自动部署；在后续 fresh production preflight 和用户明确确认后，#135 才合并上线。

staging advisors 为 49 security（生产既有 47 + 新项目平台自带 `public.rls_auto_enable()` 的 anon/authenticated EXECUTE 两条已记录 WARN）及 74 performance INFO。4 条 `unindexed_foreign_keys` 指向 composite FK column order；逐项核对发现完整反向等值索引或 `booking_id` 唯一主键已覆盖 FK maintenance lookup，因此不建立重复索引。70 条 `unused_index` 来自 fresh synthetic stage 的零业务流量，需在 activation/真实 query plan 后再判断。

PR #135 于 2026-08-25 06:24:23 UTC 合并，Supabase integration 于 06:25:04 UTC 完成生产应用。上线后 Phase 2/3A/3B.1 read-only diagnostics 全部通过：123 Reservations、135 Sessions、192/192 owned Court allocations、131 Parties、23 Payments、26 allocation entries / CAD 1,642.00，shadow mismatch 为 0。`private.assert_reservation_phase3b_kernel_inactive()` 返回 status `inactive`，operation / membership / transition count 均为 0。

Production writer inventory 仍为 17 direct / 3 wrappers / 2 undeployed Stripe paths，direct fingerprint `ac236997585da13cc6cc0439b8eafcf0`，wrapper fingerprint `d1eb5d63d36f01f1caad2e4e9e516dbf`。6 张 Phase 3B public tables 全部 RLS + FORCE RLS，client mutation function count 为 0，private helper 无 client EXECUTE，booking dual-write trigger count 为 0，Phase 3B Realtime publication count 为 0。`public.court_slots` 仍是唯一业务 Realtime 投影。

上线后 security advisor 保持 47（2 INFO / 45 WARN），没有 Phase 3B.1 新 security finding。Performance advisor 为 62 INFO：4 `unindexed_foreign_keys` + 58 `unused_index`，无 WARN/ERROR。4 条 FK 提示对应 membership effective Session/origin 和 transition allocation from/to 的 composite 列顺序；PR #137 的 performance-only follow-up 已在 staging 为这些及 activation 新增 FK 补齐 8 个 ordered indexes，但首次生产 activation 在到达该 follow-up 前已原子回滚，所以生产仍保留 4 条提示。

### Phase 3B.2 atomic writer activation 与零价恢复（Issue #136 / #139；staging / 生产均为 47，生产已激活）

Issue #136 最初授权在 `badminton_stage` 激活和验证 writer。PR #137 后来获明确授权，于 2026-08-25 07:16:55 UTC 合并；首次 Supabase protected-branch deployment 在 migration 45 的最终 assertion 以 SQLSTATE `55000` / `payment=1` 停止，单一 transaction 完整回滚。Issue #139 / PR #140 修复并通过独立门禁后获明确 merge/生产授权；PR #140 于 08:23:38 UTC 合并为 `1499cf4da939e6d0e00b7eec9bb2380c65c3b32e`，integration 于 08:25:06–08:25:07 UTC 顺序应用 migrations 45–47，生产现已激活。

Migration `20260824172041_reservation_phase_3b_atomic_writer_activation` 使用单一 `BEGIN`/`COMMIT` 原子完成 17-writer activation。它先核对 44-version baseline fingerprint、Phase 3B.1 inactive kernel、Phase 3A shadow、RLS/grants/Realtime 与 17 direct / 3 wrapper inventory；任一前置不符都在替换 function 前 fail closed。旧 public function 的规范化定义和 hash 被冻结到 private inventory，随后 17 个精确 signature 被移到 `private.reservation_phase3b_legacy_*`；同名 public signature 重建为 `SECURITY DEFINER SET search_path = ''` entry，先校验调用者，再在受控 activation context 中委托 legacy mutation 并调用 private transaction primitive。

Activation 边界是 17 public entries / 0 public direct legacy writers / 17 private legacy delegates / 3 public wrappers。Private legacy delegates 和 primitives 对 client roles 无 EXECUTE；public entries 保持既有最小 grant。唯一新入口 `admin_link_booking_groups_with_primary(uuid,uuid,uuid,text)` 只 grant 给 `authenticated` 与 `service_role`，并立即调用 `private.require_manager()`；这是 security advisor 保留 `authenticated_security_definer_function_executable` WARN 的有意设计，不是匿名或无授权入口。

`reservation_session_assignments` 是第七张 Phase 3B public append-only 表，记录 booking 的 origin projection Session 和 effective Session 每次变化。`reservation_allocation_memberships.last_session_assignment_id` 把当前 projection 指向对应历史事实；controlled activation context 与 deferred projection constraint trigger 保证 legacy delegate 中间态不被误拒，但提交前 physical/effective Session、membership、price、payment 和 audit 必须一致。表强制 RLS，client DML grant 为 0，不加入 Realtime。

Stable `x-idempotency-key` 驱动 operation id/request fingerprint。Create、schedule、cancel/restore、details、mark-paid/refund、link/unlink、undo/revert 都经由 Phase 3B primitive；mark-paid 追加 Payment/allocation，paid 转 unpaid 追加 refund。不同客户 merge 通过新的 explicit-primary RPC 选择 primary Party 和 `single_payer` / `split_equal` / `split_custom`；旧双参数 link 只在 primary 无歧义时委托，内部 split 可保留 `legacy_unspecified`。

Migration 安装时为 staging 的 192 个 booking 建立 192 条 effective membership；不修改 immutable booking origin。新 `private.assert_reservation_phase3b_activation()` 只输出 PII-free counts/status，核对 migration、activation state、17/0/17/3 writer boundary、192 membership、Phase 3B-aware shadow、physical/effective Session、payment projection、zero started operations、7 张 FORCE RLS 表、zero client DML/private EXECUTE 与仅 `court_slots` Realtime。旧 Phase 3A diagnostic 也改为同时支持 pre-activation 17 direct 和 post-activation 17/17/3 catalog。

Migration `20260824181500_phase_3b_activation_fk_indexes` 是独立 performance-only follow-up，为 membership effective Session/origin、4 组 Session assignment 和 transition allocation from/to 共 8 个 composite FK 建立声明列顺序索引。它不分拆 activation 的原子性，也不改变 writer 或业务行为。Staging performance advisor 的 `unindexed_foreign_keys` 已从 8 变为 0；剩余 `unused_index` INFO 数量随测试访问统计变化，不根据 fresh/synthetic 流量删除索引。

PII-free 根因是唯一一条合法零价 booking：`total_amount=0`、succeeded ledger allocation=0、`payment_status=pay_at_venue`、无 Payment/refund。旧 assertion 的 `allocated_amount >= total_amount AND status <> paid` 把 `0 >= 0` 误判为必须 paid；但 schema 和 manager override 都允许 0，Phase 3A 对非-paid 零价投影期望 allocation=0，Payment primitive 又禁止零金额 allocation，因此不能伪造 CAD 0 Payment。

Issue #139 recovery 对尚未进入生产 history 的 migration 45 做有限修正：`allocated > total` 一律 mismatch；`paid` 必须 `allocated IS NOT DISTINCT FROM total`；只有 `total > 0 AND allocated = total` 才要求 paid；partial allocation 只兼容 `pay_at_venue`；退款规则保持追加式。已经应用旧 45 的 staging 通过 append-only `20260825074102_phase_3b_zero_price_activation_assertion` 收敛：migration 先要求精确 46-version baseline，再读取 `pg_get_functiondef`；旧 predicate 必须恰好一次并替换，新 predicate 必须恰好一次并 no-op，其他 source shape 全部 SQLSTATE `55000` fail closed。函数仍是 private `SECURITY INVOKER STABLE SET search_path=''`，并再次 revoke public/anon/authenticated/service_role EXECUTE。

Hosted staging 现已精确对齐 47 个 repo version/name，诊断返回 `phase_3b_atomic_writer_activation_verified`：192 memberships、0 shadow/session/payment drift、0 incomplete operation、RLS/grants/Realtime boundary clean。完整旧形状替换演练、新形状 no-op 演练和正式 migration 47 均通过；17-writer synthetic matrix 把一个 manager override 改为 CAD 0 后仍通过 success、permission rejection、idempotent retry 与 late rollback，持久 stage 回到 192/192 clean baseline。多连接 hosted contention 证据继续有效。

Recovery 本地门禁显式使用 Codex bundled Node `v24.19.0` 与 pnpm `11.19.0`：`pnpm run test:reservation` 共 28 tests，27 pass / 0 fail / 1 skip；新增 PGlite SQL truth table 覆盖零价、正价未付/部分/已付、refund、paid-without-ledger 与 over-allocation。Skip 仅因本机未设 `PHASE3B_POSTGRES_URL`，对应真实 Payment/AA/refund concurrency 仍由 PostgreSQL CI 执行。`pnpm run lint` 与 `pnpm run build` 通过，Vite 6.4.3 仅保留既有 >500 kB chunk warning。内置版本与仓库固定 Node 22 / pnpm 11.16.0 不同，因此 recovery PR CI 仍是生产兼容性门禁。

PR #137 合并前通过非破坏性 merge `693ca38` 对齐最新 `main`；[Actions run 32819898640](https://github.com/tujiaqi2002/badminton/actions/runs/32819898640) 在 Node 22 / pnpm 11.16.0 / PostgreSQL 16-alpine 下为 26/26、0 skip。Recovery 位于 PR #140；最终 [Actions run 32824013095](https://github.com/tujiaqi2002/badminton/actions/runs/32824013095) 在同一固定版本下为 28/28、0 skip，真实并发、lint/build 全绿。合并后的 [GitHub Pages run 32826377671](https://github.com/tujiaqi2002/badminton/actions/runs/32826377671) build/deploy 成功。

2026-08-25 07:41–07:44 UTC recovery preflight baseline 显示 production 为 44 migrations / 3B.1 inactive，staging 为 47 migrations / activated 17/0/17/3 boundary。Production 当时的 advisors 是 47 security（2 INFO / 45 WARN）和 62 performance INFO（4 `unindexed_foreign_keys` + 58 `unused_index`）；staging 是 50 security（2 INFO / 48 WARN）和 60 performance INFO（全部 `unused_index`，0 `unindexed_foreign_keys`）。Recovery assertion `proconfig=['search_path=\"\"']`、ACL 只有 postgres owner，anon/authenticated/service_role EXECUTE 全为 false。

Fresh production preflight 全部在 read-only transaction/catalog API 内完成：Phase 2/3A/3B.1 diagnostics 通过，123 Reservations、135 Sessions、192/192 owned allocations、131 Parties、23 Payments、26 allocations / CAD 1,642.00；kernel 为 0 operation / 0 membership / 0 transition，writer 仍为 17 direct / 3 wrappers。Activation state table、Session-assignment table、explicit-primary RPC 与 private legacy delegates 当时均不存在，Edge Functions 为 0。

上线后 production history 精确为 47，migration fingerprint 为 `10799dd49909e684c3eb035fa05fbf91`。Phase 2/3A/3B.2 diagnostics 通过：192 bookings / 192 memberships，0 shadow/session/payment/incomplete-operation drift；23 Payments 与 26 allocations 仍各自合计 CAD 1,642.00。唯一零价 booking 仍是 `pay_at_venue`，0 Payment / 0 allocation / 0 refund。Writer boundary 为 17 public entries / 0 public direct legacy / 17 private legacy delegates / 3 wrappers；7 张表 RLS + FORCE RLS，client DML/private helper EXECUTE 为 0，Realtime 仅 `public.court_slots`，Edge Functions 为 0。Production advisors 为 48 security（2 INFO / 46 WARN）和 67 performance INFO（全部 `unused_index`，0 `unindexed_foreign_keys`）。

[`supabase/rollback/phase_3b_atomic_writer_activation_rollback.sql`](./supabase/rollback/phase_3b_atomic_writer_activation_rollback.sql) 位于 migration path 之外，只用于手工 emergency rollback。它恢复冻结的 17 个 public legacy definition、撤销 explicit-primary RPC 对 client 的入口，并保留全部 transition、membership、Payment 和 audit history。该脚本已在 activated stage 内以外层 transaction 执行完整演练，内部诊断确认 legacy mode，外层 rollback 后 stage 恢复 activated 且无数据/历史污染。

### Phase 4A.1 manager read contract（Issue #142 / PR #143；staging / 生产均为 48，UI 未切换）

Append-only migration `20260825091608_reservation_phase_4a_manager_read_contract` 已应用于独立 `badminton_stage` 与生产。它在严格核对 47-version Phase 3B.2 baseline、17/0/17/3 writer boundary、192/192 membership、zero shadow/session/payment/incomplete drift、7 张 FORCE RLS 表与 `court_slots`-only Realtime 后才创建对象；不写业务数据、不执行 read/UI cutover、不新增 client DML 或 Realtime publication。

`public.reservation_admin_summary_v1` 与 `public.reservation_admin_allocations_v1` 均设置 `security_invoker=true`。前者一行表示一笔 current effective Reservation，后者一行表示一片 physical Court allocation；current ownership 只由 `reservation_allocation_memberships` 决定，origin ID 保持不可变，legacy group/link 仅作为 source facts。主要联系人来自显式 Party role。应收金额由 effective allocation 价格相加，到账/退款由 succeeded append-only allocation entries 推导；状态区分 `unpaid`、`partial`、`paid`、`refunded`、`no_charge` 和 `inconsistent`。

四个 public RPC 为 `SECURITY INVOKER STABLE SET search_path=''`，只向 `authenticated` grant EXECUTE，并在查询前要求 `auth.uid()` 对应 `staff_members.role='admin'`：

- `admin_list_reservation_allocations(...)`：最长 31 天、最多 1,000 条，以 `(starts_at, allocation_id)` keyset 分页；
- `admin_search_reservations(...)`：球馆本地日期/搜索/预约与付款状态筛选，最长 367 天、每页最多 50，以 `(matched_start_at, reservation_id)` keyset 分页；
- `admin_get_reservation_detail(uuid)`：一次 JSON snapshot 返回 summary、Parties/roles、Sessions/allocations、payment shares、Payments/entries、source、transitions 与 assignment summary；不返回 provider reference、idempotency key、payment notes 或 `auth_user_id`；
- `admin_get_reservation_read_shadow_status(int)`：只返回 PII-free mismatch counts/codes/samples。

这一 API shape 把排期、搜索、详情分别固定为一次数据库往返，避免 application N+1。Migration 新增 `reservation_sessions_admin_window_idx (starts_at,id,reservation_id,ends_at)`；hosted forced plans 确认 schedule window 使用该 index，membership detail 使用既有 `reservation_allocation_memberships_effective_idx`。观察到的冷 RPC 时间约为 39 ms / 41 ms / 52–85 ms；直接 indexed plan 约为 0.214 ms / 0.109 ms，filtered summary execution 约 2.152 ms。合成 stage 数据只建立基线，不定义生产 SLA。

Staging 与生产 history 现均为 48，diagnostic 返回 `phase_4a_manager_read_contract_verified`：192 allocation rows、123 summary rows、0 mismatch，Phase 3B 全部门禁仍 clean。真实生产角色矩阵验证 manager 成功、authenticated non-manager `Manager access required`、anon permission denied；三个 view 均为 security-invoker，四个 RPC 均为 invoker + empty `search_path` + authenticated-only entry，private assertion 对所有 client role 无 EXECUTE。详情包含 Party/Session/allocation/payment/lineage arrays 并排除 provider reference、idempotency 与 `auth_user_id`。

生产 forced plan 使用 `reservation_sessions_admin_window_idx`，25-row schedule window execution 约 0.134 ms；membership detail 使用 `reservation_allocation_memberships_effective_idx`，完整 lookup execution 约 3.935 ms。上线后 advisors 为 48 security（2 INFO / 46 WARN）与 60 performance INFO（全部 `unused_index`，0 unindexed FK）；没有 Phase 4A security regression。Staging 仍为 50 security（2 INFO / 48 WARN）与 59 performance INFO。

最终 [Actions run 32832792480](https://github.com/tujiaqi2002/badminton/actions/runs/32832792480) 在 Node `v22.23.2` / pnpm `11.16.0` / PostgreSQL `16.15` 下为 33/33、0 skip，真实三连接 Payment retry、AA 与 refund race、lint/build 全绿。用户随后授权 merge/生产应用；PR #143 于 09:41:17 UTC 合并为 `3db78f8d8c2b2eec58e137a57ff2f2ec5bbab61c`，integration 于 09:41:55 UTC 应用 migration 48，[Pages run 32833288305](https://github.com/tujiaqi2002/badminton/actions/runs/32833288305) build/deploy 成功。完整中英文契约和回退边界见 [`docs/reservation-migration/phase-4a-manager-read-contract.md`](./docs/reservation-migration/phase-4a-manager-read-contract.md)。

### Phase 4A.2 frontend adapter 与 controlled shadow read（Issue #142 / PR #145 已部署；默认关闭）

`src/lib/reservationReadModel.js` 定义 client DTO version 1，并分别 normalise legacy allocation rows、canonical schedule response、Reservation summary/search/detail 与 shadow status。Server `schema_version` 必须精确为 1，未知 version fail closed。Detail 使用显式 whitelist，未声明的 provider reference、idempotency、raw payload、payment note 或 Auth identifier 不会因服务端未来扩展而自动进入 DTO。

`src/lib/reservationReadShadow.js` 只比较 allocation-presence、court、venue-local time、status、amount/currency、origin Reservation、projection Session 与 legacy source trace。Canonical `timestamptz` 使用 venue timezone 转为 local timestamp；日期 boundary 也按 venue timezone 生成 UTC instant。分页只使用 `(starts_at, allocation_id)` cursor，并拒绝缺失/重复 cursor 或超过 100 pages。Canonical overlap results 在对比前按 legacy start-at window 过滤，避免跨午夜 allocation 的假 mismatch。

`VITE_RESERVATION_READ_SHADOW` 只有精确 `true` 才启用，`.env.example` 与 Pages workflow 默认 false。调用点位于 `isAdmin` 后的 `fetchAdminBookings`；legacy rows 先正常写入 React state，shadow promise 不控制 loading/toast/rendering。新请求和 component unmount 会 abort 旧 shadow。关闭时不调用新 RPC。日志固定为 `reservation_read_shadow_v1`，只含 count/code/totals；error message、PII、notes、IDs 与 database samples 都不进入日志。

Legacy search 是 Court-allocation row，canonical search 是 effective Reservation row，因此本阶段不做伪等价逐行比较。Canonical search/detail adapter 与 fixtures 已建立，默认 UI cutover 仍留给 Phase 4B/4C。实现没有 migration、grant/RLS、Realtime、mutation 或 customer-read 变化。设计与 rollback 见 [`docs/reservation-migration/phase-4a2-frontend-shadow-adapter.md`](./docs/reservation-migration/phase-4a2-frontend-shadow-adapter.md)。

本地 bundled Node `v24.19.0` / pnpm `11.19.0` 验证为 adapter suite 14/14；Reservation migration suite 33 tests 中 32 pass、真实 PostgreSQL concurrency 因未配置本地 URL 明确 skip；lint/build 通过。Default-off demo manager browser 在桌面与 390×844 手机布局完成排期、筛选、切周回归，console 无 error/warn 且无 shadow event。真实 PostgreSQL concurrency 与 feature-on manager RPC path 继续由 PR CI 和受控 manager/staging observation 门禁证明，不能用 demo browser 代替。

最终 merge-head CI [run 32837678041](https://github.com/tujiaqi2002/badminton/actions/runs/32837678041) 在 Node `v22.23.2` / pnpm `11.16.0` / PostgreSQL 16 下完成：Reservation migration/concurrency 33/33、adapter 14/14、0 skip，lint/build 全绿。用户在 fresh gate 后授权 Ready + merge + 默认关闭的 Pages 部署；PR [#145](https://github.com/tujiaqi2002/badminton/pull/145) 于 2026-08-25 10:36:34 UTC 合并为 `ea3e6a80afcec64736a54b2bba65f0936f7e9ab8`。

合并后的 Pages [run 32838082873](https://github.com/tujiaqi2002/badminton/actions/runs/32838082873) build/deploy 全绿。线上首页返回 200，并引用该 run 生成的 `index-ssrRc0gW.js`；bundle 中 shadow event/flag literals 均为 0。GitHub Actions 未设置 `VITE_RESERVATION_READ_SHADOW`，所以 workflow 使用 `false`，Vite dead-code elimination 已移除 shadow 调用。Production/staging 仍为 48 migrations，合并没有触发 Supabase migration。Feature-on production observation、默认 read/UI cutover 与 legacy decommission 仍未授权。

## 8. 线上迁移状态

2026-08-25 PR #143 上线后，生产精确为 48 个版本：

- 首个：`20260812161833_private_manager_schedule`
- 生产最新：`20260825091608_reservation_phase_4a_manager_read_contract`

独立 `badminton_stage` 也为 48 个版本，最新同为 `20260825091608_reservation_phase_4a_manager_read_contract`。其中 Phase 2 migration 的 DDL/回填逻辑未变，只把四个冻结生产数据指纹替换为合成 fixture 的 staging 指纹；Phase 2 diagnostic 也必须使用相同 staging 指纹专门化，原样 production-fingerprint 版本会按设计 fail closed。Production migrations 45–48 已由 protected-branch integration 成功应用；Phase 4A.2 不新增 migration，默认 read/UI cutover、Stripe 或 legacy decommission 仍需新的独立门禁与明确授权。

本次未发现之前的 “Remote migration versions not found in local migrations directory” 漂移。

Phase 2 生产验证结果为 `phase_2_reservation_backfill_verified`：123 Reservations、135 Sessions、192 owned Court allocations、131 Party snapshots、23 reconciliation Payments、26 allocations 和 CAD 1,642.00；legacy booking payload、139 条有效 `court_slots` 与 dedicated payment audit evidence 未改变。该段计数是 Phase 2 当时的 backfill snapshot；Phase 3B.2 已让后续 legacy writes 原子维护 aggregate/ledger projection，Phase 4A.1 又安装了 canonical manager read API，但默认 read/UI 尚未 cutover。

### 迁移规则

- 每次 schema/RPC/RLS 变化增加新的时间戳 migration。
- 已在线应用的 migration 不得回改。
- DDL 使用 Supabase migration 工具，不用普通 SQL query 工具。
- 推送新 migration 前先比较 local/remote versions。
- 当前 Supabase GitHub integration 会在 `main` merge 后自动部署 pending migrations；所以有 migration 的 PR 必须在 merge 前完成 production preflight/授权，或先关闭自动部署，不能把 merge 与 production deployment 当成两个独立动作。

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

### 线上安全顾问现状（2026-08-24）

- 47 条 security findings：2 INFO、45 WARN。
- `private.manager_accounts` 和 `venue_member_tiers` 报告 “RLS enabled, no policy”。当前 direct grants/schema access 已关闭，实际 deny-by-default；新表仍要显式表达 policy 与 grants。
- `btree_gist` 位于 `public` schema。现有 GiST exclusion constraint 依赖它，Reservation 第一轮迁移不移动 extension。
- 43 个 public `SECURITY DEFINER` routines 可由 `authenticated` execute，顾问会统一警告。只读审计确认所有 definer 都有明确 `search_path`，入口使用统一 helper、等价内联 staff check 或安全 wrapper；新增入口必须先 revoke default execute、再最小 grant，并持续逐函数审计。
- Leaked password protection 未启用。当前主要是 Google/OTP manager-only，不阻塞 additive schema；开放密码/客户 Auth 前必须启用。

参考 Supabase remediation：

- [Database linter](https://supabase.com/docs/guides/database/database-linter)
- [Password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

Performance advisor 在 Phase 2/Phase 3A foundation 后为 40 条 INFO 级尚未使用索引。Migration 41 上线后新增的 1 条 `multiple_permissive_policies` WARN 已由 Issue #131 / migration 42 在不扩大权限的前提下清除；当前重新回到 40 个 `unused_index` INFO。Phase 2 仍未切换读取，Reservation/payment indexes 尚未被业务查询使用是预期状态；不能只因 `unused_index` 就删除，需结合 Phase 3 shadow queries、生产查询计划和增长后数据再决定。

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

Realtime 监听不含客户身份的排期投影。2026-08-23 publication 核对显示 public/private 业务表中只有 `public.court_slots` 位于 `supabase_realtime`。它是同步便利通道，不是事务结果；mutation 完成后仍要刷新权威数据，并能容忍漏发和重复事件。

扩展 subscription 或 schema 前需重新核对最新 Supabase Realtime publication 和 schema 支持。

## 15. Edge Functions 与 Stripe

仓库包含：

- `supabase/functions/create-checkout/index.ts`
- `supabase/functions/stripe-webhook/index.ts`

但 2026-08-23 线上 Supabase 返回 **0 个已部署 Edge Functions**。因此当前只能把 Stripe 视为代码骨架，`VITE_STRIPE_ENABLED` 应保持关闭，安全默认是到店支付。

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

## English update: Phase 4A.1 production read contract and Phase 3B technical record

Phase 4A.2 is deployed from PR #145 as a default-off frontend foundation with no database change. `reservationReadModel.js` defines a version 1 client DTO for legacy allocation rows and canonical schedule, Reservation summary/search/detail, and status responses. Unknown server schema versions fail closed, and detail normalization whitelists fields so later provider references, idempotency data, raw payloads, payment notes, or Auth identifiers cannot silently enter the DTO.

`reservationReadShadow.js` compares only stable allocation facts: presence, court, venue-local time, status, amount/currency, origin Reservation, projection Session, and legacy source traces. It converts canonical `timestamptz` values and request boundaries with the venue timezone, follows `(starts_at, allocation_id)` cursors, rejects missing/repeated cursors and excessive pages, and filters canonical overlap results to the current legacy start-window semantics before comparison. Legacy booking-row search and canonical Reservation-row search intentionally have different cardinality and are not forced into a false row equivalence.

Only exact `VITE_RESERVATION_READ_SHADOW=true` enables the verified manager schedule call site; example and Pages builds default to false. Legacy rows update React state first, while shadow work never controls loading, toasts, rendering, mutations, or customer reads. Obsolete requests are aborted. Logs emit only the fixed event plus counts, codes, and totals; PII, notes, IDs, samples, and server error messages are excluded. Full bilingual design and rollback behavior are documented in [`docs/reservation-migration/phase-4a2-frontend-shadow-adapter.md`](./docs/reservation-migration/phase-4a2-frontend-shadow-adapter.md).

Final merge-head CI [run 32837678041](https://github.com/tujiaqi2002/badminton/actions/runs/32837678041) passed 33/33 Reservation PostgreSQL tests and 14/14 adapter tests with zero skips under Node `v22.23.2`, pnpm `11.16.0`, and PostgreSQL 16, plus green lint/build. After explicit authorization, PR [#145](https://github.com/tujiaqi2002/badminton/pull/145) merged at 10:36:34 UTC as `ea3e6a80afcec64736a54b2bba65f0936f7e9ab8`. Post-merge Pages [run 32838082873](https://github.com/tujiaqi2002/badminton/actions/runs/32838082873) succeeded. The live page and CI share `index-ssrRc0gW.js`; the unset Actions variable falls back to false, and the live bundle contains neither the shadow event nor flag literal. Production/staging remain at 48 migrations. Feature-on production observation remains unapproved.

Issue #142 / PR #143 Phase 4A.1 is installed and verified in production and isolated `badminton_stage`; both now have 48 migrations, latest `20260825091608_reservation_phase_4a_manager_read_contract`. The migration performs a strict 47-version and Phase 3B boundary preflight before creating additive read objects. It mutates no business data, grants no client DML, adds no Realtime publication, and switches no UI.

`reservation_admin_summary_v1` and `reservation_admin_allocations_v1` are security-invoker views. Current effective membership determines ownership, explicit Party roles determine the primary contact, and effective allocation prices plus append-only succeeded ledger entries determine money state, including `no_charge`. Four security-invoker, stable, empty-search-path RPCs provide keyset-paginated schedule, keyset-paginated Reservation search, a one-call detail snapshot, and PII-free shadow status. Only authenticated actors receive entry, and every function independently requires the actor to be a manager.

Schedule, search, and detail each use one database round trip and avoid application-level N+1. Production and staging diagnostics reconcile 192 allocations/memberships with 123 current Reservation summaries and zero mismatch. Production role tests passed for a manager, denied an authenticated non-manager with `Manager access required`, and denied anonymous execution. All views are security invoker; all four public RPCs are invoker with empty `search_path` and authenticated-only entry; the private assertion is inaccessible to client roles. The detail snapshot contains Party/Session/allocation/payment/lineage arrays and excludes provider references, idempotency data, and `auth_user_id`.

Production forced plans used `reservation_sessions_admin_window_idx` for the schedule window at approximately 0.134 ms and `reservation_allocation_memberships_effective_idx` for detail membership lookup at approximately 3.935 ms. Post-deployment advisors report 48 security findings (2 INFO / 46 WARN) and 60 performance INFO findings, all unused indexes and zero unindexed foreign keys. No Phase 4A security regression appeared.

Final [Actions run 32832792480](https://github.com/tujiaqi2002/badminton/actions/runs/32832792480) passed 33/33 with zero skips under Node `v22.23.2`, pnpm `11.16.0`, and PostgreSQL `16.15`, including real multi-connection Payment retry, AA, and refund races plus lint/build. After explicit authorization, PR #143 merged at 09:41:17 UTC as `3db78f8d8c2b2eec58e137a57ff2f2ec5bbab61c`; the integration applied migration 48 at 09:41:55 UTC, and [Pages run 32833288305](https://github.com/tujiaqi2002/badminton/actions/runs/32833288305) succeeded. Phase 4A.2 later deployed only the default-off frontend foundation; the live UI still uses the legacy read path. Feature-on observation, default cutover, Stripe, and legacy decommission remain separate and unauthorized. Full bilingual evidence is in [`docs/reservation-migration/phase-4a-manager-read-contract.md`](./docs/reservation-migration/phase-4a-manager-read-contract.md).

PR #135 merged at 2026-08-25 06:24:23 UTC, and the Supabase GitHub integration applied migrations 43–44 at 06:25:04 UTC. At that point production had 44 migrations and the Phase 3B.1 kernel was strictly inactive. Post-deployment Phase 2, Phase 3A, and Phase 3B.1 diagnostics passed with 192/192 owned allocations, zero shadow mismatch, and zero kernel operations, memberships, or transitions.

Issue #136 originally authorized Phase 3B.2 activation on the synthetic `badminton_stage` project. PR #137 was later explicitly authorized and merged at 07:16:55 UTC. Its first protected production deployment stopped in migration 45's final assertion with SQLSTATE `55000` and `payment=1`; the single transaction rolled back in full. Issue #139 / PR #140 then passed its own staging, CI, and production-preflight gate and received explicit merge/deployment authorization. PR #140 merged at 08:23:38 UTC as `1499cf4da939e6d0e00b7eec9bb2380c65c3b32e`, and the integration applied migrations 45–47 at 08:25:06–08:25:07 UTC.

`20260824172041_reservation_phase_3b_atomic_writer_activation` performs the complete 17-writer activation in one transaction after fail-closed checks of the 44-version baseline, inactive kernel, shadow state, security boundary, Realtime publication, and exact writer inventory. It freezes the exact legacy definitions, moves them to private delegates, and recreates the existing public signatures as authorization-first, empty-search-path entries. The resulting boundary is 17 public entries, zero public direct legacy writers, 17 private legacy delegates, and three indirect wrappers. The only new public RPC is manager-gated explicit-primary linking.

The activation adds append-only Session assignment history and a deferred projection check, uses stable idempotency keys, and routes create, schedule, cancellation/restoration, details, payment/refund, relationship, undo, and revert operations through the transaction kernel. Mark-paid appends Payment/allocation facts; paid-to-unpaid appends a refund. Seven Phase 3B public tables use FORCE RLS, clients have no direct DML or private-helper EXECUTE, and Realtime still publishes only `public.court_slots`.

`20260824181500_phase_3b_activation_fk_indexes` adds eight ordered composite-FK indexes. The initial stage database was aligned to 46 repository versions, all Phase 2/3A/3B diagnostics were clean, the full synthetic writer matrix and hosted contention checks passed, and the performance advisor reported zero unindexed foreign keys. The Phase 2 diagnostic must be specialized with the same staging fingerprints; the unchanged production-fingerprint diagnostic intentionally fails closed. A rollback artifact outside the migration path restores the frozen legacy public writers without deleting append-only history and has been rehearsed inside an outer transaction on the activated stage.

Issue #139 identified the sole production mismatch as a legitimate zero-price booking: total zero, ledger allocation zero, `pay_at_venue`, and no Payment/refund. The old `allocated >= total` predicate incorrectly treated `0 >= 0` as requiring paid, even though zero totals and manager overrides are valid, Phase 3A expects zero ledger allocation, and the payment primitive rejects zero-value allocations. The corrected predicate accepts zero-price/no-payment state, requires positive paid balances to reconcile exactly, requires positive fully allocated balances to be paid, preserves partial/refund rules, and rejects every over-allocation.

Because migration 45 never entered production history, its final predicate is corrected for the first production application. Staging had already recorded the old 45, so append-only migration `20260825074102_phase_3b_zero_price_activation_assertion` converges it with a fail-closed `pg_get_functiondef` source-shape guard: exactly one old shape is replaced, exactly one corrected shape is a no-op, and every other shape aborts. The private assertion remains security invoker, stable, empty-search-path, and inaccessible to public/anon/authenticated/service_role.

The recovery was delivered by PR #140. Bundled Node `v24.19.0` / pnpm `11.19.0` produced 27 passes, zero failures, and one explicit no-local-PostgreSQL skip across 28 tests; lint/build passed. The added PGlite SQL truth table covers zero-price, positive unpaid/partial/paid, refund, paid-without-ledger, and over-allocation. Final [Actions run 32824013095](https://github.com/tujiaqi2002/badminton/actions/runs/32824013095) passed 28/28 with zero skips plus real concurrency, lint, and build under pinned Node 22 / pnpm 11.16.0 / PostgreSQL 16. Post-merge [GitHub Pages run 32826377671](https://github.com/tujiaqi2002/badminton/actions/runs/32826377671) built and deployed successfully.

The 07:41–07:44 UTC preflight baseline was 44 production migrations and 47 staging migrations. Production then had 47 security findings and 62 performance INFO findings, including four unindexed-FK notices. Staging had 50 security findings and 60 performance INFO findings, all unused indexes and zero unindexed-FK notices. The recovery assertion has an empty `search_path`, owner-only ACL, and no anon/authenticated/service_role EXECUTE.

The fresh production preflight was read-only and passed with 123 Reservations, 135 Sessions, 192/192 owned allocations, 131 Parties, 23 Payments, and 26 allocations / CAD 1,642.00. Before deployment the kernel was at zero operations, memberships, and transitions with 17 direct writers and three wrappers, and all activation-only objects were absent.

Post-deployment production has exactly 47 migrations with history fingerprint `10799dd49909e684c3eb035fa05fbf91`. Phase 2, Phase 3A, and Phase 3B.2 diagnostics pass with 192 bookings / 192 memberships and zero shadow, Session-projection, payment, or incomplete-operation mismatches. The 23 Payments and 26 allocations still each total CAD 1,642.00. The one zero-price booking remains `pay_at_venue` with no Payment, allocation, or refund.

The active writer boundary is 17 public entries, zero public direct legacy writers, 17 private legacy delegates, and three wrappers. Seven public Phase 3B tables use RLS plus FORCE RLS; clients have zero direct DML and zero private-helper EXECUTE. Realtime publishes only `public.court_slots`, and no Edge Functions are deployed. Production advisors now report 48 security findings (2 INFO / 46 WARN) and 67 performance INFO findings, all unused indexes and zero unindexed foreign keys.

The database write activation is complete. Reads and UI remain on the legacy presentation model and compatible public contracts; Stripe and legacy decommission remain unchanged and unauthorized.
