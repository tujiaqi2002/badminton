# Reservation Phase 4A.1：馆长读取契约

> Issue：[GitHub #142](https://github.com/tujiaqi2002/badminton/issues/142)
> Migration：`20260825091608_reservation_phase_4a_manager_read_contract`
> 当前状态：已应用并验证于独立 `badminton_stage` 与生产；两者均为 48 个 migration；现有 UI 与 legacy read path 未切换。

## 1. 目标与边界

Phase 4A.1 先为统一 Reservation 模型建立稳定、分页、馆长专用的读取契约，再让前端接入。它解决的是“如何正确读取”，不是“立即换 UI”。

本阶段包含：

- 一笔有效 Reservation 的汇总投影；
- 一片实际 Court allocation 的排期投影；
- 馆长排期窗口、Reservation 搜索、单笔详情和 PII-free shadow status RPC；
- 显式权限、RLS、固定 `search_path`、keyset pagination 和必要索引；
- staging migration、权限、真实角色、查询计划和 advisor 验证。

本阶段不包含：

- 不修改客户、预约、价格、付款或审计数据；
- 不切换馆长或客户 UI；
- 不删除或停用 `booking_group_id`、`booking_link_id`、旧字段、旧视图或旧 RPC；
- 不增加 Reservation Realtime publication；
- 不部署 Stripe、客户登录或新的写入能力。

因此，migration 即使进入某个环境，也只增加读取能力；现有产品行为保持不变，直到单独的 Phase 4A.2 前端接入获得确认。

## 2. 唯一业务解释

所有读取遵守以下顺序：

1. `bookings.id` 仍是一片实际 Court allocation 的不可变来源 ID。
2. `reservation_allocation_memberships` 决定该 allocation 当前属于哪个 Reservation 和 Session。
3. `reservation_sessions` 决定当前到场时间段；一次到场可以包含一片或多片场地。
4. `reservation_parties` 与 `reservation_party_roles` 决定联系人、参与者、原始预订人和付款人；主要联系人来自显式 `primary_contact` role，不从姓名、电话或时间推断。
5. 当前应收金额由有效 allocation 的价格相加；到账金额由成功 Payment 的追加式 allocation entries 相加。
6. merge、split、reverse 只改变当前 membership/lineage，不改写 allocation origin、旧付款或审计历史。

这让“同一次创建的多场地预订”和“馆长后来关联的多笔预订”在读取层成为同一个概念：一个 Reservation 包含一个或多个 Session，每个 Session 包含一个或多个 Court allocation。

## 3. v1 读取对象

### `reservation_admin_summary_v1`

一行代表一笔当前有效 Reservation。它提供：

- Reservation reference、状态、来源和 recurrence 摘要；
- allocation / Session 数量、首末时间、下一场时间和场地 ID；
- 主要联系人；
- 当前总价、到账、退款和余额；
- 从 ledger 推导的 `unpaid`、`partial`、`paid`、`refunded`、`no_charge` 或 `inconsistent`；
- transition 数量和最后关系变化。

零价 Reservation 的正确状态是 `no_charge`，不要求也不伪造 CAD 0 Payment。

### `reservation_admin_allocations_v1`

一行代表一片实际 Court allocation。它同时返回：

- 不可变 origin Reservation / Session / allocation ID；
- 当前 effective Reservation / Session ID；
- 当前场地、开始/结束、状态、价格和来源；
- 当前 Reservation 的主要联系人和付款汇总；
- legacy group/link 只作为来源追溯字段，不再决定业务归属。

排期可以继续按一片场地渲染，同时用同一个 `reservation_id` 和 `session_id` 自然聚合多场地和关联订单。

### 馆长 RPC

| RPC | 用途 | 边界 |
| --- | --- | --- |
| `admin_list_reservation_allocations(...)` | 按时间窗口读取排期 | 最长 31 天，最多 1,000 条，以 `(starts_at, allocation_id)` keyset 分页 |
| `admin_search_reservations(...)` | 按球馆本地日期、文字、预约状态和付款状态搜索 | 最长 367 天，每页最多 50 条，以 `(matched_start_at, reservation_id)` keyset 分页 |
| `admin_get_reservation_detail(uuid)` | 一次取得一笔 Reservation 完整馆长详情 | 返回 summary、parties/roles、sessions/allocations、payment shares、Payments/entries、来源、transitions 和 assignment 摘要 |
| `admin_get_reservation_read_shadow_status(int)` | 观察新旧读模型是否一致 | 只返回计数、mismatch codes 和无 PII 样本，最多 200 条 |

详情 RPC 故意不返回 payment provider reference、idempotency key、付款备注或 Party 的 `auth_user_id`。这些字段不是当前馆长页面完成工作所必需，不应扩大浏览器中的敏感数据面。

## 4. 一次调用、稳定分页

前端 adapter 不应先查 Reservation，再逐笔查 Session、Court、联系人和 Payment。排期、搜索和详情分别由一个 RPC 返回当前页面所需的完整快照，固定为一次数据库往返，避免 application-level N+1。

分页使用稳定的复合 keyset，不使用深页 `OFFSET`：

- 排期：`(starts_at, allocation_id)`；
- 搜索：`(matched_start_at, reservation_id)`。

相同时间的多条记录由 UUID 打破平局。下一页必须把服务端返回的两个 cursor 字段原样传回；不得只传时间。

Migration 新增 `reservation_sessions_admin_window_idx (starts_at, id, reservation_id, ends_at)`。Staging 强制查询计划确认排期窗口使用该索引；membership detail 使用既有 `reservation_allocation_memberships_effective_idx`。

## 5. 权限边界

- 两个 view 使用 PostgreSQL `security_invoker=true`，继续遵守底层 RLS；
- 四个公开读取 RPC 均为 `SECURITY INVOKER STABLE SET search_path=''`；
- 所有 RPC 首先要求 `auth.uid()` 对应 `staff_members.role='admin'`；
- 仅 `authenticated` 获得 view `SELECT` 和 RPC `EXECUTE`；
- `public`、`anon` 与 `service_role` 不获得新的显式入口；
- `private.assert_reservation_phase4a_read_contract()` 只供数据库 owner 验证；
- 本阶段不给任何 client role 新增 DML，也不改变 Realtime。

Staging 真实 JWT 角色验证结果：馆长四个 RPC 成功；已认证非馆长返回 `Manager access required`；匿名调用返回 permission denied。详情 payload 未发现上述敏感字段。

## 6. Staging 证据

Migration 在独立 `badminton_stage` 原子应用后，history 为 48 个版本，最新是 `20260825091608_reservation_phase_4a_manager_read_contract`。Hosted diagnostic 返回：

- `phase_4a_manager_read_contract_verified`；
- 192 个 booking / 192 个 effective membership；
- 192 个 allocation read rows / 123 个 Reservation summary rows；
- Phase 3B writer boundary 仍为 17 public entries / 0 direct legacy / 17 private delegates / 3 wrappers；
- shadow、Session projection、payment、incomplete operation 和 Phase 4A read mismatch 全部为 0；
- 7 张 Phase 3B 表继续 FORCE RLS；Realtime 继续只有 `public.court_slots`。

Staging 冷调用观测约为：schedule 39 ms、search 41 ms、detail 52–85 ms；这包含 hosted connection、RLS 与 JSON 组装成本。直接索引计划中，排期窗口约 0.214 ms，membership detail 约 0.109 ms，过滤后的 Reservation summary 执行约 2.152 ms。这里记录的是合成小数据集的安全基线，不是未来流量 SLA。

Migration 后 advisor 没有发现 Phase 4A 新安全问题或未索引 FK：security 仍为 50 条既有 staging findings；performance 为 59 条 `unused_index` INFO，`unindexed_foreign_keys=0`。Fresh staging 的 unused index 统计只能用来观察，不能单独作为删索引依据。

Draft PR #143 首轮 [Actions run 32832318539](https://github.com/tujiaqi2002/badminton/actions/runs/32832318539) 在仓库固定 Node `v22.23.2` / pnpm `11.16.0` / PostgreSQL `16.15` 下通过 33/33、0 skip；真实三连接 Payment retry、AA 与 refund race、lint/build 全绿。本地 bundled Node `v24.19.0` / pnpm `11.19.0` 为 32/33 pass、0 fail、1 个无本地 PostgreSQL 的明确 skip，lint/build 通过。

首次 staging apply 在任何 DDL 前因 Phase 3B baseline status 文本不匹配而原子停止，remote history 和对象均未改变。Preflight 改为验证 Phase 3B assertion 的真实结构后，正式 apply 成功；本地 migration 文件随后只重命名为 Supabase 实际记录的 `20260825091608`，内容未在成功应用后回改。

### 生产上线证据

用户在 2026-08-25 09:40:51 UTC 最终只读门禁再次通过后，明确授权合并 PR #143 并部署 migration 48；授权不包含 Phase 4A.2、默认 read/UI、Stripe 或 legacy decommission。PR 于 09:41:17 UTC 合并为 `3db78f8d8c2b2eec58e137a57ff2f2ec5bbab61c`，Supabase integration 于 09:41:55 UTC 原子应用本 migration，生产 history 精确推进到 48。[Pages run 32833288305](https://github.com/tujiaqi2002/badminton/actions/runs/32833288305) build/deploy 成功。

生产 diagnostic 返回 `phase_4a_manager_read_contract_verified`：192 allocations / memberships、123 current Reservations、0 Phase 3B/4A mismatch。真实 manager 的 schedule/search/detail/shadow 全部成功；authenticated non-manager 返回 `Manager access required`，anon 返回 permission denied。三个 view 均为 security-invoker，四个 RPC 均为 invoker + empty `search_path` + authenticated-only entry，private assertion 对所有 client role 无 EXECUTE。Detail 包含 Party、Session/allocation、payment 与 lineage arrays，并确认不含 provider reference、idempotency 或 `auth_user_id`。

生产 forced plan 使用新 `reservation_sessions_admin_window_idx`，25-row window execution 约 0.134 ms；detail membership 使用 `reservation_allocation_memberships_effective_idx`，execution 约 3.935 ms。上线后 advisors 为 48 security（2 INFO / 46 WARN）与 60 performance INFO（全部 `unused_index`，0 unindexed FK），没有 Phase 4A 新安全 regression。

## 7. 发布与回退

合并前生产为 47 个 migration，不存在 Phase 4A view/RPC，Phase 3B.2 diagnostic clean。含本 migration 的 PR 合并会触发 Supabase protected-branch integration，因此合并被视为同时授权生产安装；本次已在 fresh production preflight 和用户明确授权后完成。

当前生产与 staging 均为 48 migrations，Phase 4A diagnostic clean，Realtime 仍只有 `public.court_slots`。当前 UI 不依赖这些新对象；Phase 4A.2 必须通过独立门禁后才允许受控 shadow/adoption。

安全发布顺序：

1. 先安装本 additive read contract；不切 UI。（已完成）
2. 观察 migration、RLS/grants、diagnostic、真实角色和 query plan。
3. 另开 Phase 4A.2 接入前端 adapter，并保留 legacy adapter / feature flag。
4. 生产观察和 rollback window 结束后，才评估后续 customer read 与 Phase 5 legacy decommission。

由于当前 UI 不依赖这些对象，Phase 4A.1 出现问题时的首选回退是保持 legacy UI、撤销 client grants 或用新的 append-only migration 修正对象；不能回改已应用 migration，也不删除 Reservation ledger/history。旧字段、旧 RPC 和旧 Realtime 投影只有在单独高风险 decommission Issue 获确认后才能下线。

---

# Reservation Phase 4A.1: Manager Read Contract

> Issue: [GitHub #142](https://github.com/tujiaqi2002/badminton/issues/142)
> Migration: `20260825091608_reservation_phase_4a_manager_read_contract`
> Current status: applied and verified on isolated `badminton_stage` and production; both have 48 migrations; the existing UI and legacy read path have not switched.

## 1. Goal and scope

Phase 4A.1 establishes a stable, paginated, manager-only read contract for the unified Reservation model before any frontend adoption. It changes how the new model can be read, not what the live UI currently does.

This phase includes a current Reservation summary, a physical Court-allocation schedule projection, manager RPCs for schedule/search/detail/shadow status, explicit security and RLS boundaries, keyset pagination, a supporting index, and hosted staging validation.

It does not mutate customer, booking, price, payment, or audit data; switch either manager or customer UI; retire any legacy field/view/RPC; add Reservation Realtime publication; deploy Stripe; open customer login; or add a write capability. A separately confirmed Phase 4A.2 is required before the frontend adopts this contract.

## 2. Canonical interpretation

`bookings.id` remains the immutable physical Court-allocation origin. `reservation_allocation_memberships` determines its current effective Reservation and Session. Sessions represent actual visits and may contain one or more Court allocations. Explicit Party roles determine contacts, participants, source bookers, and payers; identity is never inferred from matching names, phones, emails, or times.

The current amount due is the sum of effective allocation prices. Money received is the sum of succeeded append-only Payment allocation entries. Merge, split, and reverse update effective membership and lineage without rewriting allocation origins, historical payments, or audit facts.

This gives multi-court bookings created together and bookings linked later one business meaning: a Reservation contains one or more Sessions, and each Session contains one or more Court allocations.

## 3. Versioned read objects

`reservation_admin_summary_v1` returns one row per current effective Reservation, including reference, status, source/recurrence/transition summary, Session and allocation counts, time range, courts, explicit primary contact, and ledger-derived totals and payment state. Payment state is one of `unpaid`, `partial`, `paid`, `refunded`, `no_charge`, or `inconsistent`. Zero-price Reservations are `no_charge`; no CAD 0 Payment is fabricated.

`reservation_admin_allocations_v1` returns one row per physical Court allocation with immutable origin IDs, effective Reservation/Session IDs, current court/time/status/price, and the current Reservation contact/payment summary. Legacy group/link IDs remain source-only trace fields and do not determine ownership.

The manager RPCs are:

- `admin_list_reservation_allocations(...)`: maximum 31-day window, maximum 1,000 rows, `(starts_at, allocation_id)` keyset pagination;
- `admin_search_reservations(...)`: venue-local date/filter/search, maximum 367-day range and 50 rows, `(matched_start_at, reservation_id)` keyset pagination;
- `admin_get_reservation_detail(uuid)`: one JSON snapshot containing summary, Parties/roles, Sessions/allocations, payment shares, Payments/entries, source facts, transitions, and assignment summary;
- `admin_get_reservation_read_shadow_status(int)`: PII-free counts, mismatch codes, and at most 200 sanitized samples.

The detail payload intentionally excludes provider references, idempotency keys, payment notes, and Party `auth_user_id`, because the current manager workflows do not need those values in the browser.

## 4. Fixed round trips and stable pagination

The frontend adapter must not load a Reservation and then issue per-row Session, Court, contact, or Payment queries. Schedule, search, and detail each return the required page snapshot in one RPC, eliminating application-level N+1 behavior.

Pagination uses compound keysets rather than deep `OFFSET`: `(starts_at, allocation_id)` for schedule and `(matched_start_at, reservation_id)` for search. The UUID is a deterministic tie-breaker. Clients must return both server-provided cursor fields unchanged.

The migration adds `reservation_sessions_admin_window_idx (starts_at, id, reservation_id, ends_at)`. Forced staging plans used this index for schedule windows and the existing `reservation_allocation_memberships_effective_idx` for detail membership lookup.

## 5. Security boundary

Both views set `security_invoker=true` and therefore continue to obey underlying RLS. All four public RPCs are `SECURITY INVOKER STABLE SET search_path=''`, require the authenticated actor to have `staff_members.role='admin'`, and grant entry only to `authenticated`. No new explicit entry is granted to `public`, `anon`, or `service_role`. The private assertion is database-owner-only. This phase grants no client DML and changes no Realtime publication.

Hosted role tests proved that a real manager can use all four RPCs, an authenticated non-manager receives `Manager access required`, and an anonymous actor receives permission denied. The detail payload contains none of the intentionally excluded sensitive fields.

## 6. Hosted staging evidence

After atomic application, `badminton_stage` has 48 migrations, latest `20260825091608_reservation_phase_4a_manager_read_contract`. The hosted diagnostic returned `phase_4a_manager_read_contract_verified`: 192 bookings and memberships, 192 allocation rows, 123 Reservation summaries, zero Phase 3B shadow/Session/payment/incomplete-operation drift, and zero Phase 4A mismatch. The writer boundary remains 17 public entries / zero direct legacy / 17 private delegates / three wrappers; seven tables still use FORCE RLS; Realtime still contains only `public.court_slots`.

Observed cold hosted calls were approximately 39 ms for schedule, 41 ms for search, and 52–85 ms for detail, including hosted connection, RLS, and JSON assembly. Direct indexed execution was approximately 0.214 ms for the schedule window, 0.109 ms for membership detail, and 2.152 ms for filtered Reservation summary. These synthetic-data observations are a safety baseline, not a future traffic SLA.

No Phase 4A security or unindexed-FK advisor finding was introduced. Staging remained at 50 existing security findings; performance reported 59 `unused_index` INFO findings and zero unindexed foreign keys. Fresh synthetic unused-index data is observational and is not sufficient evidence to remove an index.

Draft PR #143's first [Actions run 32832318539](https://github.com/tujiaqi2002/badminton/actions/runs/32832318539) passed 33/33 with zero skips under pinned Node `v22.23.2`, pnpm `11.16.0`, and PostgreSQL `16.15`, including real multi-connection Payment retry, AA, and refund races plus lint/build. Bundled local Node `v24.19.0` / pnpm `11.19.0` passed 32 of 33 with zero failures and one explicit no-local-PostgreSQL skip; lint/build passed.

The first staging attempt stopped atomically before DDL because the preflight expected the wrong Phase 3B status text. No remote object or history row was created. After validating the real Phase 3B assertion shape, the apply succeeded. The local file was then renamed only to the actual Supabase-recorded version `20260825091608`; its contents were not rewritten after successful application.

### Production deployment evidence

After the final 2026-08-25 09:40:51 UTC read-only gate passed, the user explicitly authorized merging PR #143 and deploying migration 48; Phase 4A.2, default read/UI, Stripe, and legacy decommission remained excluded. PR #143 merged at 09:41:17 UTC as `3db78f8d8c2b2eec58e137a57ff2f2ec5bbab61c`, and the Supabase integration atomically applied this migration at 09:41:55 UTC, advancing production exactly to 48 migrations. [Pages run 32833288305](https://github.com/tujiaqi2002/badminton/actions/runs/32833288305) succeeded.

Production returned `phase_4a_manager_read_contract_verified`: 192 allocations/memberships, 123 current Reservations, and zero Phase 3B or Phase 4A mismatch. Schedule, search, detail, and shadow calls succeeded for a real manager; an authenticated non-manager received `Manager access required`, and anonymous execution was denied. All three views are security invoker, all four RPCs are invoker with empty `search_path` and authenticated-only entry, and the private assertion is inaccessible to client roles. Detail contains Party, Session/allocation, payment, and lineage arrays without provider references, idempotency data, or `auth_user_id`.

Production forced plans used the new `reservation_sessions_admin_window_idx` at approximately 0.134 ms for a 25-row window and the existing `reservation_allocation_memberships_effective_idx` at approximately 3.935 ms for detail membership lookup. Post-deployment advisors report 48 security findings (2 INFO / 46 WARN) and 60 performance INFO findings, all unused indexes with zero unindexed foreign keys and no new Phase 4A security regression.

## 7. Release and rollback

Before merge, production had exactly 47 migrations, no Phase 4A view/RPC, and a clean Phase 3B.2 status. Because merging the PR triggered the protected Supabase integration, merge and production installation were treated as one authorization action. This deployment completed only after a fresh production read-only preflight and explicit authorization.

Production and staging now both have 48 migrations with a clean Phase 4A diagnostic, while `public.court_slots` remains the only Realtime business table. The current UI does not depend on the new objects; Phase 4A.2 requires a separate gate before controlled shadow/adoption.

The safe sequence is: install this additive contract without switching UI; observe migration/security/diagnostic/role/query-plan evidence; implement Phase 4A.2 behind a legacy adapter or feature flag; then consider customer reads and Phase 5 legacy decommission only after a production observation and rollback window.

Because the live UI does not depend on these objects, the preferred Phase 4A.1 rollback is to keep the legacy UI active, revoke client grants if necessary, or correct the contract with a new append-only migration. Applied migrations must not be edited, and Reservation ledger/history must not be deleted. Legacy fields, RPCs, and Realtime projections require a separate high-risk decommission issue and explicit authorization.
