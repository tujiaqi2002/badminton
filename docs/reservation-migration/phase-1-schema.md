# Reservation migration Phase 1 schema

> Prepared: 2026-08-23
>
> Parent design: [Issue #118](https://github.com/tujiaqi2002/badminton/issues/118)
>
> Phase 0 baseline: [Issue #119](https://github.com/tujiaqi2002/badminton/issues/119) / [PR #120](https://github.com/tujiaqi2002/badminton/pull/120)
>
> Phase 1 implementation: [Issue #121](https://github.com/tujiaqi2002/badminton/issues/121) / [PR #122](https://github.com/tujiaqi2002/badminton/pull/122)

## 状态

Phase 1 已完成 migration authoring 与隔离数据库验证，但 **尚未应用到生产**。本阶段只有 additive schema：不 backfill、不 dual-write、不切换读取、不部署前端、不删除或重命名 legacy 字段。

Migration：[`20260823072016_reservation_aggregate_schema.sql`](../../supabase/migrations/20260823072016_reservation_aggregate_schema.sql)

验证 SQL：[`phase_1_reservation_schema.sql`](../../supabase/diagnostics/phase_1_reservation_schema.sql)

## 1. 物理模型

| 表 | ID | 责任 |
| --- | --- | --- |
| `recurrence_series` | UUID | 周期模板；每次 occurrence 仍是独立 Reservation |
| `reservations` | UUID + bigint display sequence | 商业预约聚合根；只保存 currency、备注、付款意向和来源，不保存可漂移总价/状态 |
| `reservation_legacy_sources` | bigint identity | 保存 legacy group/link/series 到 Reservation 的确定性来源关系 |
| `reservation_parties` | UUID | 预约时客户/组织快照，不按相似联系方式自动合并 |
| `reservation_party_roles` | composite PK | `primary_contact`、`participant`、`original_booker`、`payer` |
| `reservation_sessions` | UUID | 一次实际到场，使用 `timestamptz` |
| `reservation_payment_shares` | UUID | equal/amount/percentage 付款意向，不代表到账 |
| `payments` | UUID | 一次真实收款或退款；provider/idempotency 可追踪 |
| `payment_allocation_entries` | bigint identity | append-only signed ledger，把款项分配到现有 booking Court allocation |
| `bookings`（现有） | UUID | 继续作为物理 Court allocation、GiST 冲突投影和 `court_slots` 来源 |

Phase 1 没有创建第二张 Court allocation 表。现有 `bookings` 只增加无 default 的 nullable `reservation_id` 与 `session_id`，因此当前 legacy rows 不重写，也不要求立即归属新模型。

## 2. 数据库不变量

### Reservation / Session / Court

- `bookings.reservation_id` 与 `session_id` 必须同时为空或同时存在。
- `(session_id, reservation_id)` composite FK 保证 Court allocation 的 Session 属于同一 Reservation。
- `(reservation_id, currency)` composite FK 保证 allocation currency 与 Reservation 相同。
- 一旦 booking 接入新模型，integrity trigger 会按 `venue_settings.timezone` 将 Session `timestamptz` 投影回 legacy local `timestamp`，并要求 allocation 开始/结束完全一致。
- 原 `bookings_no_time_overlap`、slot trigger、audit trigger、venue/future guards 和 legacy RPC 均未修改。

### Parties

- Party ID 与 Reservation ID 使用 composite relationship，role/share 不能引用另一笔 Reservation 的 Party。
- partial unique index 保证每笔 Reservation 最多一个 `primary_contact`。
- legacy party snapshot 可记录原 `booking_group_id`，同一 Reservation 下不能重复映射同一个来源 group。

### Payments

- Reservation currency 与 Payment currency 通过 composite FK 一致。
- Payment 的 payer 和被退款 Payment 必须属于同一 Reservation。
- provider reference 和 payment/allocation idempotency keys 唯一。
- Payment 创建后，金额、currency、payer、method、provider、source、发生时间等事实不可更改；只允许 `pending → succeeded/failed/voided`。
- Refund 是引用原 Payment 的新 row，不覆盖原收款。
- Payment allocation entry 金额非零：allocation 为正，reversal/refund 为负并引用同一 Reservation、同一 booking 的原 entry。
- Allocation ledger 不允许 update/delete；legacy source 不允许 delete；Payment 不允许 delete。
- “分配净额不超过成功 Payment、custom shares 合计、refund 总额”等跨行金额规则仍由 Phase 3 的短事务 RPC + 稳定锁顺序实现，不能把当前 schema 约束误当成完整付款 API。

## 3. RLS 与 API 暴露

- 9 张新 public 表全部 `ENABLE RLS` + `FORCE RLS`。
- `anon`、`service_role` 对新表没有 direct grants；identity sequences 也没有 client/API grants。
- `authenticated` 只有 SELECT，没有 INSERT/UPDATE/DELETE；每张表的 SELECT policy 都再次通过 `staff_members` 检查 manager。
- Phase 1 没有 public RPC、view、Realtime publication 或 Edge Function 变化。
- 3 个 private integrity trigger functions 都是 `SECURITY INVOKER`、固定空 `search_path`，并从 `PUBLIC` / `anon` / `authenticated` / `service_role` 撤销直接 execute。
- 后续 mutation 只能通过另一个 Phase 的最小 public wrapper + private implementation 开放，不能直接扩大 table grants。

这也适配 Supabase 即将在 2026-10-30 对现有项目执行的 Data API 新默认：table grants 与 RLS 在 migration 中明确表达，不依赖 Dashboard 自动暴露。参考 [Supabase breaking change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically) 与 [RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security)。

## 4. 索引与容量

- 每个 FK 都有以 referencing columns 开头的有效 index；隔离验证会自动检查遗漏。
- Reservation/session 列表使用 `(reservation_id, starts_at, id)`；payment 使用 `(reservation_id, occurred_at, id)`；ledger 使用 Reservation/payment/booking key paths。
- provider reference、idempotency key、primary contact、legacy source 和 recurrence sequence 使用 unique/partial unique index。
- 当前没有 view/materialized summary、BRIN、GIN 或 partition。Phase 0 最大表约 4.25 MB，提前分区只会增加 RLS、migration 和运维复杂度。

## 5. Migration 安全与兼容性

- Migration 由 Supabase CLI 2.115.0 的 `supabase migration new reservation_aggregate_schema` 生成文件名，没有手写时间戳。
- 编写前 remote/local history 为 37/37，最新均为 `20260821003535_booking_relationship_management`。
- `bookings` 新字段没有 default，避免全表 rewrite。
- 新 booking check/FKs 先以 `NOT VALID` 加入，再独立 `VALIDATE CONSTRAINT`；当前所有 legacy null rows 都能通过。
- 保留 `btree_gist` 原位置和当前 GiST exclusion constraint，不修改 `realtime` schema/publication。
- 生产仍保持 37 migrations；本分支有第 38 个未应用 migration。PR review/merge 不等于授权生产 `db push`。

## 6. 验证结果

在 PGlite PostgreSQL 隔离环境中用最小现有 Tiger schema 实际执行 migration，并运行完整 metadata/aggregate assertions：

| 检查 | 结果 |
| --- | --- |
| SQL parser（pglast 7.10） | migration + diagnostic parsed |
| Migration apply | passed |
| 9 tables / RLS / FORCE RLS / policies | passed |
| Grants、sequences、function execute/search_path | passed |
| 全部 FK leading indexes | passed；验证过程发现并补齐 2 个遗漏 |
| Existing booking/slot compatibility | 1 synthetic legacy row unchanged，slot projection unchanged |
| Duplicate primary contact | rejected |
| Mismatched Session/allocation time | rejected |
| Cross-Reservation payment allocation | rejected |
| Payment fact rewrite / terminal status rewrite | rejected |
| Ledger update/delete / legacy-source delete | rejected |
| Valid payment transition and signed reversal entry | accepted |
| Repository tests | 22/22 passed |
| Repository lint | passed |
| Repository build | passed；仅保留既有 Vite large-chunk warning |

仓库门禁使用 Codex Desktop 内置 Node.js `v24.19.0` 与 pnpm `11.19.0`。部署 workflow 固定 Node.js 22 与 pnpm 11.16.0，因此本地通过不替代 CI / Supabase Preview 的最终兼容性检查。

生产 advisor 只作为未应用前 baseline：47 security findings（2 INFO、45 WARN）和 19 performance INFO，与 Phase 0 相同。它不能证明未应用 migration 的结果；最终需以 PR Supabase Preview/local full-stack advisor 为准。

PR #122 的 Supabase Preview integration 当前返回 `skipped`，因此它没有提供独立 preview database 证据；本报告不会把该 check 写成通过。生产 migration 仍未应用。

## 7. Phase 2 前的门禁

Phase 1 完成后仍需停止，Phase 2 必须另行确认：

1. 再运行 Phase 0 baseline，冻结 backfill 当时的新计数。
2. 单独验证 `America/Toronto` 的 legacy `timestamp → timestamptz`，尤其 DST 重复/缺失小时。
3. 冻结 legacy group/link → Reservation、group/schedule → Session 的 deterministic ID/source mapping。
4. 定义 21/26 个缺少专门 payment audit 的 paid rows 如何生成 `legacy_reconciliation` Payment，且不虚构 payer/provider/batch。
5. 在 backfill transaction 前后对 allocation IDs、slot、金额、override、currency、recurrence、payment state 和 audit coverage 做零 PII 对账。
6. Phase 2 仍不得切换现有读写；dual-write/read comparison 属于 Phase 3。

## English summary

Phase 1 adds an empty, additive Reservation aggregate and payment-ledger schema without changing production behavior. Nine RLS-protected parent/ledger tables are introduced, while the existing `bookings` table remains the physical Court-allocation and overlap projection. Its new `reservation_id` and `session_id` columns are nullable, default-free, and unpopulated until the separately authorized backfill phase.

Composite foreign keys enforce Reservation ownership across Sessions, Parties, Payments, and Court allocations. New Session times use `timestamptz`; the legacy booking time projection is checked in the configured venue timezone when ownership is populated. Payment facts and signed allocation entries are loss-preserving: provider/idempotency identifiers are unique, refunds and reversals append rows, and financial history cannot be physically deleted or rewritten.

All nine public tables have RLS and FORCE RLS. `authenticated` receives manager-only SELECT and no generic DML; `anon` and `service_role` receive no direct grants. No public RPC, view, Realtime publication, backfill, dual-write path, frontend behavior, or production database was changed. The migration and negative invariants passed an isolated PostgreSQL execution. Production deployment and Phase 2 remain separately gated.
