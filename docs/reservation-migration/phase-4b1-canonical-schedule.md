# Reservation Phase 4B.1：canonical 排期与容量读取

> Issue：[#148](https://github.com/tujiaqi2002/badminton/issues/148)
> 状态：实现与独立 staging 验证完成；生产仍默认使用 legacy 排期来源。未修改数据库、生产配置或 legacy 资产。

## 1. 本阶段解决的问题

Phase 4A 已证明 canonical Reservation read contract 与 legacy projection 一致，Phase 4B.0 又建立了可登录的独立 staging 前端。本阶段首次让馆长排期和容量监控可以直接以 canonical Court allocation 为渲染来源，同时保留一个明确、可构建时回退的 legacy 来源。

读取来源由 `VITE_RESERVATION_SCHEDULE_READ_SOURCE` 控制：只有精确值 `canonical` 才启用新来源；缺失、大小写错误或未知值全部 fail closed 为 `legacy`。`.env.example` 默认 legacy，只有无凭据的 `.env.staging.example` 默认 canonical。因此当前生产构建、Pages 配置和 production Supabase 均未切换。

## 2. 单一排期 view model

`src/lib/reservationScheduleRead.js` 把 version 1 canonical allocation DTO 映射一次，再交给现有排期与容量组件。view model 明确区分：

- `id`：真实 physical Court allocation identity，继续作为单片场地操作目标；
- `effective_reservation_id`：当前商业预约归属；
- `effective_session_id`：当前场次归属，多场地同一场次据此分组；
- `reservation_id` / `session_id`：canonical projection identity；
- `legacy_source_group_id` / `legacy_source_link_id`：只保留为来源追踪，不再决定 canonical ownership；
- primary Party 联系人、allocation 时段/场地/状态/金额，以及 Reservation payment summary。

映射不会从姓名、电话、时间或 legacy link 猜测 effective identity。缺少 allocation、effective Reservation、effective Session、court、start/end、primary contact、payment/status，或出现重复 allocation identity 时都会报固定安全错误并停止渲染。备注正文不进入本阶段的 schedule summary；只有 `has_notes` 提示，完整详情仍留给 Phase 4B.2。

## 3. 页面行为与错误边界

- `AdminSchedule` 与 `AdminCapacity` 共用同一批 canonical view-model rows；同一 Reservation 的 Court 1 / Court 2 allocations 同时出现在排期，并让容量从 5 正确减为 3。
- canonical schedule 继续复用 Phase 4A 的 venue-timezone window 与 `(starts_at, allocation_id)` keyset pagination；没有 offset pagination 或 application N+1。
- 新范围请求会取消旧请求，并用 request identity 防止慢响应覆盖当前日期范围。
- canonical RPC、schema 或 mapping 失败时，排期和容量显示持续的中英文错误面板并隐藏数据网格；不会把空数组伪装成“全部场地空闲”，也不会按单次请求静默回落到 legacy。
- Realtime 边界仍只有 `public.court_slots`。其事件会刷新客户场地和当前打开的馆长排期/容量；没有把 Reservation 表加入 publication。
- legacy shadow comparison 只在 legacy source 下运行；canonical 已成为当前 staging render source 时不再重复 shadow-fetch 自己。

订单搜索仍使用 `admin_search_bookings`，这是预期且不属于 schedule source。选中详情、移动/取消/关联等 action scope、order/customer canonical reads、付款/计价和 Stripe 均未在 Phase 4B.1 宣称完成。

## 4. Staging 浏览器与 API 证据

在 `badminton_stage` 使用真实 synthetic manager Auth 完成：

- 中文与 English 桌面排期均显示 2026-09-07 10:00–11:00 的两条 `Synthetic customer 14` allocation，分别位于 Court 1 与 Court 2，payment 为 unpaid；
- 中英文容量监控同一时段均显示剩余 3 片场地；
- 390×844 手机排期与容量均正常，`document` / `body` 宽度没有超过 viewport，底部管理导航可用；
- 页面没有 canonical read-error；验证结束后 synthetic manager 已退出。

视觉证据：

- legacy Before：[`排期中文`](../screenshots/issue-148/after-manager-schedule-desktop-zh.png)、[`容量中文`](../screenshots/issue-148/after-manager-capacity-desktop-zh.png)
- canonical 桌面 After：[`排期中文`](../screenshots/issue-148/after-4b1-canonical-schedule-desktop-zh.png)、[`排期 English`](../screenshots/issue-148/after-4b1-canonical-schedule-desktop-en.png)、[`容量中文`](../screenshots/issue-148/after-4b1-canonical-capacity-desktop-zh.png)、[`容量 English`](../screenshots/issue-148/after-4b1-canonical-capacity-desktop-en.png)
- canonical 手机 After：[`排期 390×844`](../screenshots/issue-148/after-4b1-canonical-schedule-mobile-en.png)、[`容量 390×844`](../screenshots/issue-148/after-4b1-canonical-capacity-mobile-en.png)

Supabase API 日志从本轮 canonical 验证开始时间起记录了 10 次 `POST /rpc/admin_list_reservation_allocations`，全部 HTTP 200；同一时间窗口直接 `GET /rest/v1/bookings` 为 0。7 次 `admin_search_bookings` 来自页面保留的订单查询区域，不是排期或容量的数据来源。

## 5. 最终验证

- bundled Node `v24.19.0` / pnpm `11.19.0`；
- `pnpm test`：82 tests，81 pass、1 个明确的 no-local-PostgreSQL skip、0 fail；
- `pnpm run lint`：通过；
- production build：通过，默认 legacy，artifact 不含 staging project ref 或 canonical schedule RPC；
- canonical staging build：通过，包含预期的 staging ref 与 canonical schedule RPC；
- hosted 只读 diagnostic：48 migrations，最新 `20260825091608`，192 bookings/memberships、192 canonical allocations、123 Reservations，Phase 3B/4A mismatch 全为 0；writer boundary 17/0/17/3、7 张 FORCE RLS 表、Realtime 仍只有 `public.court_slots`。

Vite 仅保留既有的 >500 kB chunk warning。

## 6. 明确未做与下一门禁

- 没有 migration、DB push、RLS/grant/RPC 或业务数据变化；
- 没有修改 production Supabase、Pages variable 或默认 read source；
- 没有切换 order/detail/customer reads 或验证 canonical action scope；
- 没有改变付款、计价、Stripe、通知或普通客户登录；
- 没有删除 legacy booking read、adapter、字段、RPC 或 rollback path。

下一步先停在 Draft PR 评审。Phase 4B.2 selected detail/action adoption、Phase 4B.1 的生产默认切换、PR merge/Pages deployment，以及任何 Phase 5 decommission 都必须分别取得明确授权。

---

# Full English

## Reservation Phase 4B.1: canonical schedule and capacity reads

Issue [#148](https://github.com/tujiaqi2002/badminton/issues/148) Phase 4B.1 is implemented and verified against isolated staging. Production still defaults to the legacy schedule source. This phase changed no database object, production configuration, or legacy asset.

### Purpose and switch boundary

Phase 4A proved that the canonical Reservation read contract matched the legacy projection, and Phase 4B.0 supplied a repeatable signed-in staging frontend. Phase 4B.1 lets the manager schedule and capacity monitor render directly from canonical Court allocations while retaining an explicit build-time legacy source.

`VITE_RESERVATION_SCHEDULE_READ_SOURCE` controls the source. Only the exact value `canonical` enables canonical rendering; missing, differently cased, or unknown values fail closed to `legacy`. `.env.example` defaults to legacy, while only the credential-free `.env.staging.example` defaults to canonical. Production Pages, production Supabase, and the default production build therefore remain unchanged.

### One schedule view model

`src/lib/reservationScheduleRead.js` maps the version 1 canonical allocation DTO exactly once before existing schedule and capacity components consume it. The physical Court allocation remains `id` and the single-court action target. `effective_reservation_id` expresses current commercial ownership, while `effective_session_id` groups every Court allocation in the current session. Projection Reservation/Session identities and legacy group/link source traces remain separate fields. Primary Party contact, Court/time/status/amount facts, and the Reservation payment summary are explicit.

The mapper never infers effective identity from a name, phone number, time, or legacy link. A missing allocation, effective Reservation, effective Session, Court, time range, primary contact, payment/status, or a duplicate allocation identity stops rendering with an allowlisted safe error. Schedule summaries carry only `has_notes`, not note bodies; complete selected detail remains Phase 4B.2 scope.

### UI, concurrency, and failure behavior

`AdminSchedule` and `AdminCapacity` consume the same canonical view-model rows. The two Court 1/Court 2 allocations for one Reservation appear together and reduce the five-court capacity to three. The loader reuses the Phase 4A venue-timezone window and `(starts_at, allocation_id)` keyset pagination, with no offset pagination or application N+1. A new range aborts the obsolete request, and a request identity prevents a slow response from replacing the current range.

An RPC, schema, or mapping failure shows a persistent bilingual error panel and hides the schedule/capacity grid. The UI cannot misrepresent an empty error result as full availability, and it never performs a per-request silent fallback to legacy data. Realtime remains limited to `public.court_slots`; an event refreshes the customer Court view and the currently open manager schedule/capacity without publishing Reservation tables. Legacy shadow comparison runs only under the legacy source and does not duplicate the canonical render request.

Order search intentionally remains on `admin_search_bookings`; it is not a schedule source. Selected detail, move/cancel/link action adoption, canonical order/customer reads, pricing, payment, and Stripe are outside Phase 4B.1.

### Staging browser and API evidence

A real synthetic manager session in `badminton_stage` rendered two `Synthetic customer 14` allocations on Court 1 and Court 2 from 10:00–11:00 on September 7, 2026, with an unpaid status. Chinese and English desktop schedules matched, and both capacity pages showed three remaining courts. The 390×844 schedule and capacity views had no document/body overflow and retained usable manager navigation. No canonical read-error appeared, and the synthetic manager signed out after validation.

Visual evidence:

- Legacy Before: [`Chinese schedule`](../screenshots/issue-148/after-manager-schedule-desktop-zh.png), [`Chinese capacity`](../screenshots/issue-148/after-manager-capacity-desktop-zh.png)
- Canonical desktop After: [`Chinese schedule`](../screenshots/issue-148/after-4b1-canonical-schedule-desktop-zh.png), [`English schedule`](../screenshots/issue-148/after-4b1-canonical-schedule-desktop-en.png), [`Chinese capacity`](../screenshots/issue-148/after-4b1-canonical-capacity-desktop-zh.png), [`English capacity`](../screenshots/issue-148/after-4b1-canonical-capacity-desktop-en.png)
- Canonical mobile After: [`390×844 schedule`](../screenshots/issue-148/after-4b1-canonical-schedule-mobile-en.png), [`390×844 capacity`](../screenshots/issue-148/after-4b1-canonical-capacity-mobile-en.png)

From the start of this canonical browser run, Supabase API logs contain ten successful HTTP 200 POST calls to `admin_list_reservation_allocations` and zero direct GET calls to `/rest/v1/bookings`. Seven `admin_search_bookings` calls came from the unchanged order-search region and did not supply schedule or capacity data.

### Final verification and next gate

Bundled Node `v24.19.0` and pnpm `11.19.0` produced 81 passes, one explicit no-local-PostgreSQL skip, and zero failures across 82 tests. Lint and both production/canonical-staging builds passed. The default production artifact remains legacy and contains neither the staging project reference nor the canonical schedule RPC; the staging artifact contains the expected staging reference and RPC. The hosted read-only diagnostic remains clean at 48 migrations ending in `20260825091608`, 192 bookings/memberships and canonical allocations, 123 Reservations, zero Phase 3B/4A mismatch, the 17/0/17/3 writer boundary, seven FORCE RLS tables, and `public.court_slots`-only Realtime. The only build notice is the existing >500 kB Vite chunk warning.

This phase performed no migration, database push, RLS/grant/RPC or data change; no production Supabase/Pages/read-source switch; no order/detail/customer or action-scope adoption; no pricing/payment/Stripe/customer-login change; and no legacy removal. Work stops at Draft PR review. Phase 4B.2 selected detail/action adoption, production default cutover and deployment, and every Phase 5 decommission action each require separate explicit authorization.
