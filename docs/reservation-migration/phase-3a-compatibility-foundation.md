# Reservation Phase 3A：未激活兼容基础层

> Issues：[#128](https://github.com/tujiaqi2002/badminton/issues/128)、[#131](https://github.com/tujiaqi2002/badminton/issues/131)
> 状态：foundation 与 shadow timezone access 已应用生产；未执行 catch-up、未激活 dual-write；RLS policy consolidation 待评审。
> Migrations：`20260824052629_reservation_phase_3a_compatibility_foundation`（生产）、`20260824130514_reservation_phase_3a_shadow_timezone_access`（生产）、`20260824132704_phase_3a_venue_settings_policy_consolidation`（pending）

## 中文

### 1. 目标和边界

Phase 3A 为 Phase 3B 的受控双写建立基础，但不改变当前产品读取路径，也不替换任何现有 mutation RPC。本阶段提供：

- 当前 legacy booking writer 的完整 inventory；
- 与 Phase 2 完全相同的稳定 UUIDv5 和 Toronto DST 转换规则；
- 私有、可分批、幂等的结构 catch-up helper；
- manager-only、零 PII 的 shadow mismatch view 与汇总 RPC；
- unsafe link/merge/split 与 financial drift 的 fail-closed 检测；
- ownership-only 更新不污染 legacy `updated_at` 或 `court_slots` Realtime projection。

本阶段明确不做：

- 不执行 catch-up；
- 不包装或替换现有 writer；
- 不启用 dual-write；
- 不把客户或馆长页面切换到 Reservation read model；
- 不创建 Payment、refund 或 reallocation 来猜测旧动作；
- 不启用 Stripe；
- 不删除 legacy 字段/RPC。

### 2. 当前 writer inventory

生产 routine catalog 与 migration code search 交叉核对得到 **17 个直接修改 `public.bookings` 的函数**：

| 类别 | 当前生产函数 |
| --- | --- |
| 客户创建/取消 | `create_multi_booking`, `cancel_booking` |
| 馆长创建 | `admin_create_multi_booking`, `admin_create_multi_booking_with_price`, `admin_create_weekly_booking`, `admin_create_weekly_booking_with_price` |
| 移动/调整/置换 | `admin_reschedule_booking`, `admin_move_booking_group`, `admin_reschedule_booking_group`, `admin_swap_booking_schedule` |
| 详情/取消/付款 | `admin_update_booking_details`, `admin_cancel_booking`, `admin_mark_booking_paid` |
| 关系 | `admin_link_booking_groups`, `admin_unlink_booking_group` |
| 撤回 | `admin_revert_audit_operation`, `admin_undo_booking_change` |

另有 3 个间接 wrapper：

- `create_booking` → `create_multi_booking`；
- `admin_create_booking` → `admin_create_multi_booking`；
- `admin_undo_last_booking_action` → `admin_revert_audit_operation`。

前端当前实际调用其中的 multi-create、cancel、move/swap、link/unlink、mark-paid、details 与 audit revert/undo 入口。尚未部署的 Stripe skeleton 还有 2 条 service-role 写路径：

- `create-checkout` 写 `stripe_checkout_session_id`；
- `stripe-webhook` 写 booking/payment/hold 状态。

Stripe 路径在本 Phase 只登记风险，不启用、不部署。

### 3. 关键现状发现

Phase 2 已给 192 条历史 booking 补上 Reservation/Session ownership。Phase 1 的 `bookings_enforce_session_projection` 会立即检查 owned booking 的 legacy local time 是否等于 Session 的 timestamptz projection。

因此，旧 schedule writer 若只修改 `bookings.start_at/end_at`、没有在同一事务同步 Session，会被数据库拒绝。这不是取消数据库约束的理由；Phase 3B 必须按每个 writer 的真实 scope 先准备/更新 Session，再提交 Court allocation，或采用同等安全的事务顺序。

Phase 3A 不修改这些 writer，避免在完成全部并发和 rollback 测试前进入半激活状态。

### 4. 新数据库对象

#### 私有 deterministic helper

- `private.reservation_phase3_uuid(entity, source_key)`：复用 Phase 2 namespace；
- `private.reservation_legacy_timestamp_to_timestamptz(local, timezone)`：DST nonexistent/ambiguous fail closed；
- `private.reconcile_legacy_recurrence_series(...)`：事务 advisory lock、完整周序列验证、幂等 upsert；
- `private.reconcile_legacy_booking_group(...)`：锁定完整 group/link scope，补 Reservation、Party/source、Session 和 booking ownership；
- `private.catch_up_reservation_aggregates(after_group_id, limit)`：UUID cursor、每批最多 200 groups；
- `private.assert_reservation_shadow_clean()`：任何 mismatch 都阻止下一阶段 activation。

全部 private helper 对 `public`、`anon`、`authenticated`、`service_role` 明确撤销 EXECUTE。未来 Phase 3B 的安全 public RPC 由数据库 owner 权限调用，不向 client 暴露 helper。

#### Shadow read model

`public.reservation_shadow_mismatches` 是 `security_invoker` view；只给 `authenticated` SELECT，并额外要求当前 actor 是 `staff_members.role='admin'`。列中只有内部 UUID、mismatch code、count/state/amount，不含姓名、邮箱、电话或备注。

`public.admin_get_reservation_shadow_status(sample_limit)` 是 `SECURITY INVOKER` manager-only summary，不新增 public `SECURITY DEFINER` advisor finding。

当前 comparison 覆盖：

- booking ownership；
- group 内 contact/relationship facts；
- group/link source mapping；
- link 与 canonical Reservation scope；
- Session time/party/notes projection；
- primary contact；
- currency 与 recurrence sequence；
- legacy payment flag 对 booking allocation balance；
- Payment 对 append-only allocation ledger balance。

### 5. Catch-up 的安全边界

结构 catch-up 可以安全处理：

- Phase 2 后新增的 unowned single/multi-court group；
- 新 group 的 deterministic Reservation/Session/Party/source；
- 已有 group 的 contact snapshot 或 Session metadata 同步；
- 同一个当前 legacy link scope 中尚未拥有 aggregate 的 groups；
- 重试和重复批次，不产生重复 target rows。

它会拒绝：

- 一个 current link scope 已经对应多个 owned Reservations；
- 一个 canonical Reservation 仍含当前 scope 之外的 booking group（需要 split/merge lineage）；
- currency 或 recurrence 来源冲突；
- group 内客户/关系事实冲突；
- DST 无法唯一映射；
- target deterministic ID 已被不兼容事实占用。

它不会自动修复 financial mismatch。legacy row 被改成 `paid` 但没有 Payment/allocation 时，只报告 `booking_payment_balance_mismatch`，不会凭状态猜测收款事实。Phase 3B 必须在 mark-paid transaction 当下记录 actor、occurred_at、scope、Payment 和 allocations；部署前已经产生的 drift 只能使用 audit-backed reconciliation。

### 6. Link/unlink 决策

Phase 3A 证明当前 schema 不能把“两个已有且各自有不可变账本的 Reservation”通过更新 `booking_link_id` 安全合并。helper 会返回 relationship-transition-required，而不会：

- 改写既有 Payment 的 `reservation_id`；
- 更新/删除 allocation ledger；
- 暂时关闭 immutable trigger；
- 静默选择主要联系人；
- 丢失任何 Party/source/price/audit lineage。

Phase 3B activation 前必须追加并验证最小的 audited relationship/financial transition 表达，然后替换 link/unlink RPC。这个门禁是本阶段的预期产物，不是未处理错误。

### 7. 隔离验证

PR #129 合并后，第 40 个 migration 于 2026-08-24 12:59:44 UTC 成功进入生产。postgres/admin diagnostic 在把 inventory 正确限定为 17 个 `public` legacy writers 后返回 `phase_3a_reservation_compatibility_verified`；192/192 bookings owned，123 Reservations、135 Sessions、131 Parties、23 Payments、26 allocations/CAD 1,642.00，shadow/ownership/Session/payment drift 与 catch-up events 均为 0，冻结指纹和 advisor 47/40 基线不变。

真实 authenticated 测试发现 `security_invoker` view 无权读取 RPC-only `venue_settings.timezone`，因此返回 `42501`。PR #130 follow-up 只增加 authenticated `timezone` 单列 grant 与 manager-only SELECT policy；其他配置和 writes 继续 RPC-only。第 41 个 migration 于 2026-08-24 13:18:16 UTC 成功应用，真实 manager/non-manager 权限测试、Phase 2/3A diagnostics、数据与冻结指纹全部通过。

上线后 performance advisor 新增一条 `multiple_permissive_policies` WARN：既有 `venue_settings_rpc_only FOR ALL false` 与 manager SELECT policy 在 authenticated SELECT 上重叠。Issue #131 的 pending migration 先验证 RLS/FORCE RLS、精确 policy 形状、timezone-only grant 和无 authenticated table/DML grants，再只删除冗余 false policy。RLS 对无适用 policy 的 DML 默认拒绝，client 也仍无 DML grant；不会扩大读取、写入或产品行为。

PGlite 使用真实 Phase 1、Phase 2、Phase 3A 与两个 follow-up migrations，当前 14 项测试通过：

- Phase 2 完整 backfill 与 7 个 negative/rollback cases；
- authenticated 馆长可读取 clean shadow 状态，非馆长看不到 mismatch rows 且不能调用汇总 RPC；
- Phase 3A 对 frozen aggregate 返回零 mismatch；
- 全量 catch-up 重跑不改变 mapping/audit；
- 新 unowned booking 被确定性补齐且不重复；
- 同一 legacy group 指向不同 Auth users 时 fail closed；
- 两个 owned Reservations 的 legacy link fail closed；
- paid flag drift 被发现但不虚构 Payment；
- 如果 authenticated 意外获得 venue_settings DML grant，policy consolidation 会在 drop 前 fail closed，并只回滚自身；既有 aggregate、grant 与旧 policy 保持不变。

可复跑验证：

```text
pnpm run test:phase2
psql ... -f supabase/diagnostics/phase_3a_reservation_compatibility.sql
```

生产 diagnostic 必须返回 `phase_3a_reservation_compatibility_verified` 和 `shadow_mismatch_rows = 0`，否则 Phase 3B 不得激活。

### 8. 发布门禁

当前 Supabase GitHub integration 会在 migration PR 合并到 `main` 后自动应用 pending migration。因此本分支/PR：

- 第 40 个 foundation 与第 41 个 timezone access migrations 已应用生产；
- 第 42 个 policy consolidation 可以开发、提交、push 和评审，但不授权 merge/生产部署；
- migration 42 merge 前必须 fresh remote/local history、生产只读 snapshot、隔离 apply、diagnostics、advisors 与明确生产授权；
- migration 42 上线后仍不执行 catch-up、不激活 dual-write；Phase 3B 另开 activation PR。

---

## English

### 1. Goal and boundaries

Phase 3A establishes the foundation for controlled Phase 3B dual-write without changing the current product read path or replacing any mutation RPC. It provides:

- a complete inventory of current legacy booking writers;
- the exact stable UUIDv5 and Toronto DST conversion rules used by Phase 2;
- private, bounded, idempotent structural catch-up helpers;
- a manager-only, zero-PII shadow mismatch view and summary RPC;
- fail-closed detection for unsafe link/merge/split and financial drift;
- ownership-only updates that do not contaminate legacy `updated_at` or the `court_slots` Realtime projection.

This phase explicitly does not:

- execute catch-up;
- wrap or replace an existing writer;
- activate dual-write;
- switch customer or manager screens to the Reservation read model;
- invent a Payment, refund, or reallocation from an ambiguous legacy action;
- enable Stripe;
- remove a legacy field or RPC.

### 2. Current writer inventory

Cross-checking the production routine catalog with migration code found **17 functions that directly mutate `public.bookings`**:

| Category | Current production functions |
| --- | --- |
| Customer create/cancel | `create_multi_booking`, `cancel_booking` |
| Manager create | `admin_create_multi_booking`, `admin_create_multi_booking_with_price`, `admin_create_weekly_booking`, `admin_create_weekly_booking_with_price` |
| Move/resize/swap | `admin_reschedule_booking`, `admin_move_booking_group`, `admin_reschedule_booking_group`, `admin_swap_booking_schedule` |
| Details/cancel/payment | `admin_update_booking_details`, `admin_cancel_booking`, `admin_mark_booking_paid` |
| Relationships | `admin_link_booking_groups`, `admin_unlink_booking_group` |
| Revert | `admin_revert_audit_operation`, `admin_undo_booking_change` |

Three indirect wrappers also exist:

- `create_booking` → `create_multi_booking`;
- `admin_create_booking` → `admin_create_multi_booking`;
- `admin_undo_last_booking_action` → `admin_revert_audit_operation`.

The frontend currently calls the multi-create, cancel, move/swap, link/unlink, mark-paid, details, and audit revert/undo paths. The undeployed Stripe skeleton contains two additional service-role write paths:

- `create-checkout` writes `stripe_checkout_session_id`;
- `stripe-webhook` writes booking/payment/hold state.

Those Stripe paths are inventoried only; they are not enabled or deployed in this phase.

### 3. Important current-state finding

Phase 2 assigned Reservation/Session ownership to all 192 historical bookings. The Phase 1 `bookings_enforce_session_projection` trigger immediately verifies that an owned booking's legacy local time equals its Session timestamptz projection.

Therefore, a legacy schedule writer that changes only `bookings.start_at/end_at` without synchronizing the Session in the same transaction is rejected by the database. The constraint must not be weakened. Phase 3B must prepare/update the Session according to each writer's real scope before committing the Court allocation, or use an equivalently safe transaction order.

Phase 3A deliberately leaves those writers unchanged so the system never enters a partially activated state before concurrency and rollback coverage is complete.

### 4. New database objects

#### Private deterministic helpers

- `private.reservation_phase3_uuid(entity, source_key)` reuses Phase 2 namespaces.
- `private.reservation_legacy_timestamp_to_timestamptz(local, timezone)` rejects nonexistent/ambiguous DST values.
- `private.reconcile_legacy_recurrence_series(...)` uses a transaction advisory lock, validates complete weekly sequences, and upserts idempotently.
- `private.reconcile_legacy_booking_group(...)` locks the complete group/link scope and reconciles Reservation, Party/source, Session, and booking ownership.
- `private.catch_up_reservation_aggregates(after_group_id, limit)` uses a UUID cursor and processes at most 200 groups per batch.
- `private.assert_reservation_shadow_clean()` blocks activation on any mismatch.

All private helpers explicitly revoke EXECUTE from `public`, `anon`, `authenticated`, and `service_role`. Future secure Phase 3B public RPCs call them with database-owner privileges; clients never receive helper access.

#### Shadow read model

`public.reservation_shadow_mismatches` is a `security_invoker` view. Only `authenticated` receives SELECT, and the query additionally requires the current actor to have `staff_members.role='admin'`. Its columns contain only internal UUIDs, mismatch codes, counts, states, and amounts—never names, emails, phones, or notes.

`public.admin_get_reservation_shadow_status(sample_limit)` is a manager-only `SECURITY INVOKER` summary, so it does not add a public `SECURITY DEFINER` advisor finding.

The comparison currently covers:

- booking ownership;
- contact/relationship facts within a group;
- group/link source mapping;
- link and canonical Reservation scope;
- Session time/party/notes projection;
- primary contact;
- currency and recurrence sequence;
- legacy payment flags versus booking allocation balance;
- Payment versus append-only allocation-ledger balance.

### 5. Catch-up safety boundary

Structural catch-up can safely handle:

- an unowned single/multi-court group created after Phase 2;
- deterministic Reservation/Session/Party/source creation for a new group;
- contact snapshot or Session metadata synchronization for an existing group;
- groups without aggregate ownership inside one current legacy link scope;
- retries and repeated batches without duplicate target rows.

It rejects:

- a current link scope that already maps to multiple owned Reservations;
- a canonical Reservation containing a booking group outside the current scope, which requires split/merge lineage;
- incompatible currency or recurrence sources;
- conflicting customer/relationship facts within one group;
- a DST value without one unique instant;
- an incompatible fact occupying a deterministic target ID.

It never repairs financial mismatch automatically. If a legacy row becomes `paid` without a Payment/allocation, Phase 3A reports `booking_payment_balance_mismatch` and does not infer a receipt. Phase 3B must record actor, occurred_at, scope, Payment, and allocations during the mark-paid transaction. Drift that already exists before deployment requires audit-backed reconciliation.

### 6. Link/unlink decision

Phase 3A demonstrates that the current schema cannot safely merge two existing Reservations with independent immutable ledgers by updating `booking_link_id`. The helper returns relationship-transition-required rather than:

- rewriting an existing Payment's `reservation_id`;
- updating or deleting allocation-ledger history;
- temporarily disabling immutable triggers;
- silently choosing a primary contact;
- losing Party/source/price/audit lineage.

Before Phase 3B activation, the smallest audited relationship/financial transition representation must be added and verified, then link/unlink RPCs can be replaced. This gate is an intended Phase 3A result, not an ignored defect.

### 7. Isolated verification

After PR #129 merged, the fortieth migration reached production successfully at 2026-08-24 12:59:44 UTC. The postgres/admin diagnostic, with inventory correctly scoped to the 17 legacy `public` writers, returns `phase_3a_reservation_compatibility_verified`. All 192 bookings remain owned, with 123 Reservations, 135 Sessions, 131 Parties, 23 Payments, 26 allocations/CAD 1,642.00, zero shadow/ownership/Session/payment drift, zero catch-up events, unchanged frozen fingerprints, and the unchanged 47/40 advisor baseline.

Real authenticated-role testing found that the `security_invoker` view could not read RPC-only `venue_settings.timezone`, producing `42501`. The PR #130 follow-up grants authenticated SELECT on the `timezone` column only and adds a manager-only SELECT policy; every other setting and all writes remain RPC-only. The forty-first migration reached production successfully at 2026-08-24 13:18:16 UTC, and the real manager/non-manager role tests, Phase 2/3A diagnostics, data totals, and frozen fingerprints all passed.

The post-deployment performance advisor added one `multiple_permissive_policies` WARN because the existing `venue_settings_rpc_only FOR ALL false` policy overlaps the manager SELECT policy for authenticated SELECT. The pending Issue #131 migration first verifies RLS/FORCE RLS, the exact policy shape, the timezone-only grant, and the absence of authenticated table/DML grants, then drops only the redundant false policy. RLS default-denies DML with no applicable policy, and clients still have no DML grant, so the change widens neither reads, writes, nor product behavior.

PGlite applies the real Phase 1, Phase 2, Phase 3A, and both follow-up migrations. All 14 current tests pass:

- complete Phase 2 backfill plus seven negative/rollback cases;
- an authenticated manager can read the clean shadow status, while a non-manager sees no mismatch rows and cannot call the summary RPC;
- zero Phase 3A mismatch on the frozen aggregate;
- full catch-up rerun changes no mapping or audit fact;
- a new unowned booking is caught up deterministically without duplicates;
- one legacy group pointing at different Auth users fails closed;
- linking two owned Reservations fails closed;
- paid-flag drift is detected without fabricating a Payment;
- if authenticated unexpectedly receives a venue-settings DML grant, policy consolidation fails closed before the drop and rolls back only itself, preserving the aggregate, grant, and old policy.

Rerunnable verification:

```text
pnpm run test:phase2
psql ... -f supabase/diagnostics/phase_3a_reservation_compatibility.sql
```

The production diagnostic must return `phase_3a_reservation_compatibility_verified` with `shadow_mismatch_rows = 0`; otherwise Phase 3B activation is prohibited.

### 8. Release gate

The current Supabase GitHub integration automatically applies pending migrations when a migration PR is merged into `main`. Therefore this branch/PR:

- the fortieth foundation and forty-first timezone-access migrations are already applied in production;
- the forty-second policy-consolidation migration may be developed, committed, pushed, and reviewed, but is not authorized for merge or production deployment;
- migration 42 requires fresh local/remote history, a production read-only snapshot, isolated apply, diagnostics, advisors, and explicit production authorization before merge;
- migration 42 still does not execute catch-up or activate dual-write; Phase 3B uses a separate activation PR.
