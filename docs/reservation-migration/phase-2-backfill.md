# Reservation migration Phase 2 deterministic backfill

> 状态：migration 已于 2026-08-24 由 Supabase GitHub integration 自动应用生产，完整诊断通过；**尚未开始 dual-write、read cutover 或前端切换。**
>
> 设计：[Issue #118](https://github.com/tujiaqi2002/badminton/issues/118)；本阶段：[Issue #123](https://github.com/tujiaqi2002/badminton/issues/123)

## 1. 本阶段结论

Phase 2 将现有 192 条 Court-level legacy booking 无损映射到 Phase 1 的 Reservation aggregate，同时继续保留 legacy 读写路径。目标结果是：

| 实体 | 目标数量 | 来源与语义 |
| --- | ---: | --- |
| Recurrence Series | 2 | 保留两个已存在的 weekly series |
| Reservations | 123 | 未关联 group 各一笔；相同非空 `booking_link_id` cluster 各一笔 |
| Legacy sources | 136 | 131 个 booking group + 5 个 link cluster |
| Parties | 131 | 每个 legacy booking group 一个 Party，不跨 group 猜测或去重 |
| Party roles | 254 | 131 个 `original_booker` + 每笔 Reservation 恰好 1 个 `primary_contact` |
| Sessions | 135 | `(booking_group_id, start_at, end_at)` 各一个，不跨 group 合并 |
| Court allocations | 192 | 继续使用原 `bookings.id`，只补 `reservation_id` / `session_id` |
| Payments | 23 | 2 笔 audit-backed + 21 笔无审计 reconciliation |
| Payment allocations | 26 | 每个 legacy `paid` booking 恰好一条 allocation |

这不是业务切换。旧 RPC、页面、group/link/recurrence 字段、状态、价格、备注、slot 和当前冲突约束都继续工作。

## 2. 冻结生产基线

只读基线于 **2026-08-24 01:48:50 UTC** 取得，不包含客户 PII：

- 192 条 booking、131 个 group、5 个 link cluster、139 条 active booking/slot；
- 123 个目标 Reservation、135 个目标 Session、2 个 recurrence series；
- 26 条 `paid` booking，合计 CAD 1,642.00；其中 5 条有可证明的 dedicated payment audit，21 条没有；
- Phase 1 的 9 张目标表全空，192 条 booking 的 ownership columns 全为空；
- customer、session、link、currency、DST、slot、pricing shape 异常均为 0；
- booking 全行指纹：`20802718eff3b81bd5fe38d99808e8d8`；
- booking 非 ownership payload 指纹：`d27b6924d560d7fc1bf2f54ce3f38688`；
- `court_slots` 指纹：`2617c5b347e5f516bae80cbb4bd92ccc`；
- dedicated payment audit 指纹：`80cbd801fce56b51b9d0e51c68a60e2c`。

这些是本次 migration authoring 时的 fail-closed 输入，不是可永久复用的生产常量。migration 上线时这些指纹仍精确匹配，因此事务才允许继续；未来迁移仍必须在部署前重新跑 baseline 并 review 差异。

## 3. 确定性映射

所有新 UUID 使用独立 UUIDv5 namespace 和稳定 source key：

- Reservation：`group:<booking_group_id>` 或 `link:<booking_link_id>`；
- Party：`booking-group:<booking_group_id>`；
- Session：group UUID + 完整 legacy start/end；
- Recurrence Series：legacy recurrence series UUID；
- Payment：audit operation + Reservation，或单个 unaudited booking UUID。

Reference number、legacy source row ID、allocation ID 和 idempotency key 也使用固定排序/稳定 source key。migration 在写入前检查同实体与跨实体 UUID collision。隔离测试在两个独立数据库应用同一输入，并比较 aggregate、roles、payment ledger、allocation 和 booking ownership 的完整映射指纹。

主要联系人 fallback 是：优先选择冻结快照时仍有 active booking 的 group，再按最早 `created_at`，最后按 group UUID。使用冻结快照时刻而非执行时钟，保证同一输入重复计算不会漂移。不同客户可以属于同一 Reservation；每个原 group 仍独立保留 Party 与 `original_booker` 角色，不擅自推断夫妻、participant 或 payer 身份。

## 4. Session、时间和 recurrence

Legacy `timestamp` 按 `America/Toronto` 解释并写为 `timestamptz`。migration 同时拒绝：

- spring-forward 不存在的本地时间；
- fall-back 重复、无法唯一解释的本地时间；
- 转换后无法精确 round-trip 的值；
- 非正时长或同一 Session 内冲突的 party size/notes。

两个 legacy recurrence series 都是完整、连续、同 weekday 的 weekly occurrences。一笔 linked Reservation 同时含一个 recurrence group 和一个非 recurrence group；它们本来已由馆长明确 link，因此仍作为同一 Reservation，并使用其中唯一可证明的 recurrence series/week，两个原 group 都通过 legacy sources 和 Parties 保留。没有跨 link/group 自动推断新的关系。

## 5. 付款真实性与 `legacy_unspecified`

旧模型记录了 booking 的 `paid` 状态，但没有可靠记录整笔 Reservation 当时选择“一个人付”还是“多人分摊”。因此 Phase 2 给 `reservations.payment_plan` 增加内部值 `legacy_unspecified`：

- 不把历史数据伪装成 `single_payer`；
- 不创建历史 `reservation_payment_shares`；
- 未来新预约仍使用既定的 `single_payer` / `split_equal` / `split_custom` 选择，产品能力没有被取消。

付款 ledger 只重建当前为 `paid` 的 26 条 booking：

- 5 条有 dedicated non-paid → paid audit：按每条 booking 的最后一个有效 transition 取证，再按同一 operation + Reservation 合并为 2 笔 Payment；已证明金额合计 CAD 160.00，并保留 audit `occurred_at`；
- 21 条没有付款审计：每条 booking 独立创建 1 笔 Payment 和 1:1 allocation，合计 CAD 1,482.00；`occurred_at`、payer、provider、provider reference 保持 null；
- 所有历史 Payment 使用 `method = legacy_unknown`、`source = legacy_reconciliation`；
- `pay_at_venue` 不会成为成功 Payment；cancelled + paid 事实保留，但不凭空创建 refund；
- 每笔 Payment 必须完全分配，每条 paid booking 恰好一条 allocation，总 Payment 与 allocation 都必须为 CAD 1,642.00。

## 6. 事务、安全与兼容性

migration 使用单一短事务、transaction-level advisory lock、明确 table locks、`lock_timeout` 和 `statement_timeout`。写入前完成基线、shape、DST、payment evidence 与 collision 检查；最后任一 assertion 失败都会整体 rollback。

现有 `bookings` 只更新 `reservation_id` / `session_id`。为避免无意义改变 legacy payload 与 public slot，事务内仅暂停通用 `updated_at` 和 slot projection triggers；ownership integrity trigger 与 append-only audit trigger继续运行。最终必须得到 192 条明确的 `booking.reservation_backfilled` audit event，并验证除两个 ownership columns 外的 booking 指纹及整个 `court_slots` 指纹不变。

Phase 2 不增加 client DML grant、public RPC、view、Realtime publication、Edge Function 或前端行为。Phase 1 的 RLS/FORCE RLS 和 manager-only SELECT 边界保持不变。

## 7. 验证证据

使用仓库实际 Phase 1 migration、Phase 2 migration 和诊断 SQL 在 PGlite/PostgreSQL 隔离环境应用：

- happy path 实际应用与完整诊断通过；
- 两次独立 mapping 的完整确定性指纹一致；
- customer snapshot conflict fail-closed；
- Toronto nonexistent / ambiguous DST 各自 fail-closed；
- contradictory payment audit、UUID collision、payment over-allocation 各自 fail-closed；
- 写入后的 synthetic late failure 使整个事务 rollback；
- migration 和诊断 SQL 通过 PostgreSQL parser。
- 使用 Codex Desktop 内置 Node.js `v24.19.0`、pnpm `11.19.0` 和固定版本 PGlite `0.5.6`；`pnpm test` 为 30/30、`pnpm lint` 通过、`pnpm build` 通过；
- 仓库部署 workflow 固定 Node.js 22，与本地 Node.js 24 不同，因此本地通过不替代 GitHub Actions/部署环境的最终兼容性门禁。

本阶段没有 UI 变化，因此 Before/After 浏览器截图不适用。仓库没有独立 Supabase Preview 项目，本次隔离验证不能代替正式 Supabase Preview 或生产前的 fresh baseline。

## 8. 生产结果与修正后的门禁

PR #126 于 2026-08-24 04:45:32 UTC 合并。当前项目的 Supabase GitHub integration 随即自动克隆 `main`，并于 04:46:10 UTC 在 protected production branch 应用本 migration；没有执行 seed，也没有部署 Edge Functions。这个自动部署发生在预期的 manual `db push --dry-run` 之前。

04:47 UTC 的只读生产诊断返回 `phase_2_reservation_backfill_verified`：

- 123 Reservations、135 Sessions、192 owned Court allocations、131 Parties；
- 23 reconciliation Payments、26 allocations、CAD 1,642.00；
- 192 条明确的 ownership audit events；
- booking 非 ownership payload、139 条 `court_slots`、payment audit evidence 指纹保持不变；
- customer/session/relationship/DST/pricing/payment evidence 异常均为 0；
- security advisor 仍为既有 47 条（2 INFO / 45 WARN），没有 Phase 2 新 finding；performance advisor 为 40 条 `unused_index` INFO，没有更高等级 finding。

因此未来门禁必须修正：在当前 integration 配置下，**合并含 pending migration 的 PR 就是生产部署动作**。此类 PR 必须在 merge 前完成 fresh baseline、migration-history comparison、dry-run 和生产授权；如果团队希望把 merge 与部署分开，必须先明确关闭 Supabase 自动生产部署。Phase 3 仍需新的 Issue 与明确确认。

---

## Full English version

### 1. Phase outcome

Phase 2 losslessly maps all 192 Court-level legacy booking rows into the Phase 1 Reservation aggregate while leaving the legacy read/write path active. The expected result is 2 Recurrence Series, 123 Reservations, 136 legacy-source records, 131 Parties, 254 Party roles, 135 Sessions, 192 existing Court allocations, 23 Payments, and 26 Payment allocations. Existing booking IDs are retained; only `reservation_id` and `session_id` are populated.

This is not a cutover. Existing RPCs, frontend behavior, group/link/recurrence columns, status, pricing, notes, slots, and overlap enforcement remain authoritative.

### 2. Frozen production baseline

The read-only, zero-PII baseline was captured at **2026-08-24 01:48:50 UTC**. It contains 192 bookings, 131 groups, five link clusters, 139 active bookings/slots, two recurrence series, and 26 paid booking rows totalling CAD 1,642.00. Five paid rows have dedicated payment audit evidence and 21 do not. All nine Phase 1 target tables and all ownership columns are empty. Customer, Session, link, currency, DST, slot, and pricing-shape anomalies are zero.

The frozen fingerprints are: full bookings `20802718eff3b81bd5fe38d99808e8d8`, booking payload excluding ownership `d27b6924d560d7fc1bf2f54ce3f38688`, `court_slots` `2617c5b347e5f516bae80cbb4bd92ccc`, and dedicated payment audit `80cbd801fce56b51b9d0e51c68a60e2c`.

These values are fail-closed inputs for this review, not permanent production constants. Any operational change causes the migration to stop before writing. A fresh baseline, reviewed migration update, and renewed dry run are mandatory immediately before production deployment.

### 3. Deterministic mapping

Every derived UUID uses a separate UUIDv5 namespace and a stable source key. Unlinked groups map one-to-one to Reservations; groups with the same non-null `booking_link_id` map to one Reservation. Each legacy group remains a distinct Party and receives `original_booker`; no cross-group customer deduplication or payer/participant inference occurs. Sessions use `(booking_group_id, start_at, end_at)`, so no automatic cross-group merge is possible.

The primary contact is selected from groups active at the frozen snapshot, then by earliest creation time, then by group UUID. Freezing the evaluation time keeps the result deterministic. Reference numbers, source-row IDs, allocation IDs, and idempotency keys are also stable. The migration checks same-entity and cross-entity UUID collisions before writing. Two independent isolated databases produced the same full aggregate/role/ledger/ownership mapping fingerprint.

### 4. Time and recurrence

Legacy timestamps are interpreted in `America/Toronto` and stored as `timestamptz`. Nonexistent spring-forward values, ambiguous fall-back values, failed round trips, non-positive intervals, and conflicting Session snapshots all fail closed.

Both recurrence series are complete weekly sequences on one weekday. One manager-linked Reservation contains one recurring group and one non-recurring group. Because the explicit link already defines a single Reservation and exactly one recurrence series/week is provable, the Reservation retains that occurrence identity while both original groups remain represented by legacy sources and Parties. No new cross-group relationship is inferred.

### 5. Truthful payment reconstruction

The legacy model did not record whether the customer intended one payer or a split payment. Phase 2 therefore adds the internal `legacy_unspecified` payment-plan value instead of falsely assigning `single_payer`. No legacy payment shares are invented. Future Reservations retain the confirmed `single_payer`, `split_equal`, and `split_custom` choices.

Only the 26 currently paid booking rows are reconstructed. The latest valid non-paid-to-paid event is selected for each of the five audited rows and grouped by operation plus Reservation into two Payments totalling CAD 160.00, with proven occurrence times. Each of the remaining 21 rows receives its own one-to-one reconciliation Payment/allocation totalling CAD 1,482.00, with null occurrence time, payer, provider, and provider reference. All reconstructed Payments use `legacy_unknown` and `legacy_reconciliation`. `pay_at_venue` is never treated as succeeded; cancelled-and-paid facts remain, but no refund is invented. Payments and allocations must both total CAD 1,642.00 and reconcile exactly.

### 6. Transaction, security, and compatibility

The migration runs in one bounded transaction with an advisory lock, explicit table locks, and lock/statement timeouts. All baseline, shape, DST, evidence, and collision checks run before durable completion; any late assertion rolls the entire operation back.

Only booking ownership columns change. Generic timestamp and slot-projection triggers are paused transactionally to preserve the legacy booking payload and `court_slots`; ownership integrity and append-only audit triggers remain active. Exactly 192 explicit ownership audit events must be produced. No client DML grant, public RPC, view, Realtime publication, Edge Function, or frontend behavior is added.

### 7. Verification, production result, and corrected gate

The actual Phase 1 and Phase 2 SQL applied successfully in an isolated PostgreSQL-compatible environment, followed by the complete diagnostic. Independent deterministic mappings matched. Negative tests covered customer conflict, both Toronto DST failure classes, contradictory payment evidence, UUID collision, over-allocation, and a late transactional rollback. PostgreSQL parsing also passed. With the Codex Desktop bundled Node.js `v24.19.0`, pnpm `11.19.0`, and pinned PGlite `0.5.6`, `pnpm test` passed 30/30, lint passed, and the production build passed. The deployment workflow uses Node.js 22, so GitHub Actions remains the final compatibility gate.

There is no UI change, so browser Before/After screenshots do not apply. No independent Supabase Preview project exists.

PR #126 merged at 04:45:32 UTC on 2026-08-24. The configured Supabase GitHub integration immediately cloned `main` and applied this migration to the protected production branch at 04:46:10 UTC; it skipped seed data and deployed no Edge Functions. The read-only production diagnostic returned `phase_2_reservation_backfill_verified`: 123 Reservations, 135 Sessions, 192 owned Court allocations, 131 Parties, 23 reconciliation Payments, 26 allocations, and CAD 1,642.00. All source-shape, DST, payment-evidence, payload, slot, permission, and provenance checks passed. Security advisors remained at the 47 existing findings with no Phase 2 addition; performance advisors reported only 40 unused-index INFO notices.

This establishes an important deployment fact: with the current integration, merging a PR that contains a pending migration is itself a production deployment. Future database PRs must complete the fresh baseline, migration-history comparison, dry run, and production authorization before merge, or the automatic production deployment must first be disabled. Phase 3 dual-write/read comparison remains separately gated.
