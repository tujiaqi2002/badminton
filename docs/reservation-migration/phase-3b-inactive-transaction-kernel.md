# Reservation Phase 3B.1：未激活事务内核

> Issue：[#134](https://github.com/tujiaqi2002/badminton/issues/134)
> 状态：PR [#135](https://github.com/tujiaqi2002/badminton/pull/135) 已于 2026-08-25 合并并部署生产；事务内核保持未激活。
> Migrations：`20260824143442_reservation_phase_3b_inactive_transaction_kernel` + `20260824164530_phase_3b_writer_inventory_c_collation`（生产已应用）

## 中文

### 1. 结论与边界

Phase 3B.1 已把后续原子双写所需的事务能力放进生产数据库，但没有把任何现有产品入口接到这些能力上。产品行为保持不变：

- 17 个直接 booking writer 和 3 个 wrapper 的函数定义、权限和调用关系不变；
- 不运行 Phase 3A catch-up，不创建任何当前 membership 或 transition；
- 不切换前端或 read path；
- 不新增客户端 mutation RPC、表级 DML 或 Realtime publication；
- 不部署 Stripe，不删除 legacy RPC、字段或 projection。

因此，3B.1 是已经安装到生产的 inactive foundation，不是 dual-write activation。Phase 3B.2 激活、PR #137 合并和对应生产部署仍需后续明确授权。

### 2. 当前有效归属与不可变历史

一个实体 Court allocation 由 `public.bookings` 记录。Phase 2 写入的 `booking.reservation_id` 继续表示不可变的**历史 Reservation 来源**。`booking.session_id` 是同一 physical origin 内的 legacy Session/排期兼容投影；排期改变或关系反向恢复时可以在原 Reservation 内指向新的投影 Session，完整 Session lineage 由 transition allocation 与审计保留。

3B.1 新增 `reservation_allocation_memberships` 作为可重建的当前状态投影：

- `origin_reservation_id`：不可变的历史来源；
- `effective_reservation_id` / `effective_session_id`：当前商业预约与场次；
- `last_transition_id` / `version`：当前状态来自哪一次追加式 transition。

membership 只允许由新的 immutable transition 推进一个版本，不允许删除、改写 origin 或跳版本。migration 本身不回填 membership；未来只有激活后的事务入口在接触一个 scope 时才会惰性建立 version 0 行。

### 3. 追加式 merge / split / reverse

新 schema 把关系变化保存为事实，而不是覆盖旧事实：

| 表 | 含义 |
| --- | --- |
| `reservation_transitions` | 一次 merge、split 或 reverse 操作及稳定 `operation_id` |
| `reservation_transition_sources` | 操作前的 Reservation scope |
| `reservation_transition_targets` | 操作后的 Reservation scope及每个 target 的显式 primary Party |
| `reservation_transition_allocations` | 每个实体 Court 从哪个 effective Reservation/Session 移到哪里 |
| `reservation_transition_parties` | 显式 Party lineage，支持 one-to-many 和 many-to-one |
| `reservation_allocation_memberships` | 从 immutable transition 重建的当前 effective scope |

不变量：

- merge 必须有至少两个 source 和一个新 target；split 必须有一个 source 和至少两个新 target；
- 操作必须完整覆盖每个 source 当前的所有 Court allocation，每个 target 至少接收一个 Court；
- source 与 target 必须使用同一 currency；
- 每个 target 必须显式提供属于该 target 的 mapped primary Party；
- Party 根据显式 lineage 关联，绝不根据姓名、邮箱或电话猜测身份；
- reverse 新增一条反向 transition，不删除原 transition；
- reverse 只恢复关系归属；后续发生的排期与资料修改会带入 restored Session。原 Session scope 已分化时保留多个 Session，不用旧值覆盖新事实；
- 物理 booking origin、原价格、Payment 与 allocation ledger 不被改写。

### 4. 付款模型

一人付清和 AA 使用同一个 append-only ledger：

- 一人付清：一笔 `Payment` 可以分配到多个 Court allocation；
- AA：多位 payer 各自产生一笔 `Payment`，分别分配到同一 Reservation 的 Court；
- refund：创建新的 refund Payment 与负数 allocation entries，不覆盖成功付款；
- legacy `bookings.payment_status` 根据每个 booking 的 ledger balance 在同一事务中更新，只是兼容投影。

为了无损支持“两个已有 Reservation 合并后由一人一次付清”，`payment_allocation_entries` 的 booking FK 从 `(booking_id, reservation_id)` 改为单列 `booking_id -> bookings.id`。这不是放宽业务归属：private payment primitive 会在写入时锁定完整 booking scope，并验证每个 booking 的 `effective_reservation_id`、currency、剩余可分配金额和 payer Party。

因此 `payment_allocation_entries.reservation_id` 表示收款当时的**商业/effective Reservation**，而 booking 自身的 `reservation_id` 保留**物理历史来源**。这使一笔 Payment 可以覆盖来自多个 origin 的 Court，同时历史账本仍然不可变。

### 5. 私有事务 primitive

| 能力 | Private helper | 关键后置条件 |
| --- | --- | --- |
| 接入新 legacy group | `reservation_phase3b_attach_legacy_groups` | Phase 3A deterministic aggregate 存在，membership version 0 |
| 移动场次 | `reservation_phase3b_reschedule_session` | 先 Session、后所有 Court；时间投影完全一致 |
| 取消/恢复 | `reservation_phase3b_set_booking_status` | booking 和 `court_slots` 同事务一致 |
| 客户资料 | `reservation_phase3b_update_booking_details` | 完整 Session scope；沿显式 Party lineage 更新对应联系人 |
| 收款 | `reservation_phase3b_record_payment` | Payment、allocations、legacy status 原子提交 |
| 退款 | `reservation_phase3b_refund_payment` | 负数 entries 追加，原付款不变 |
| 合并/拆分 | `reservation_phase3b_apply_transition` | 完整 scope、显式 primary、immutable lineage |
| 撤回 | `reservation_phase3b_reverse_transition` | 新反向 transition，恢复 effective membership 并保留后续 Session 事实 |
| 解析当前 scope | `reservation_phase3b_effective_scope` | 同时返回 physical origin 与 effective ownership |

这些 helper 当前均为 `SECURITY INVOKER`、固定空 `search_path`，并对 `public`、`anon`、`authenticated`、`service_role` 撤销 EXECUTE。3B.2 的 public writer 只能在完成馆长/客户权限校验后，以数据库函数内部调用它们；客户端不能直接调用。

### 6. 并发、幂等与回滚

每个 mutation 使用稳定 `operation_id` 和 request fingerprint：

- 相同 key + 相同请求重试返回第一次结果，不重复创建 Payment、transition 或 audit；
- 相同 key + 不同请求 fail closed；
- 未完成但已提交的 operation 不会被静默重跑，需要调查；
- 任一 SQL/constraint 失败会回滚 operation journal、新模型、legacy projection 和 audit 的全部变化。

锁顺序固定为：

1. operation advisory lock；
2. 按 UUID 排序的 booking advisory locks；
3. Reservations；
4. Sessions；
5. bookings / Court allocations；
6. memberships、Parties、Payments 和 allocation entries。

helper 设置 transaction-local `lock_timeout = 5s`、`statement_timeout = 30s`，锁内没有网络调用。数据库 constraint 继续是时间冲突、FK 和金额完整性的最终裁判。

### 7. Writer inventory 门禁

`private.reservation_phase3b_writer_inventory` 固定登记：

- 17 个直接修改 `public.bookings` 的 RPC；
- 3 个只委托、不直接写 booking 的 wrapper；
- 2 个尚未部署的 Stripe service-role 路径。

所有函数 signature 使用 schema-qualified canonical identity。`assert_reservation_phase3b_writer_inventory()` 同时验证：

- 实际 direct writer 集合必须与 inventory 完全相同；
- direct/wrapper 必须为 `SECURITY DEFINER`、安全空 `search_path`；
- anon 无 EXECUTE，authenticated 和 service_role 保持当前批准权限；
- wrapper 不得变成 direct writer；
- 输出 before/after review 可使用的 function fingerprints。

任何漏列或新增 writer 都会让 activation preflight fail closed，不能带旁路进入 3B.2。

Hosted staging 首次运行该 gate 时发现一个 portability bug：inventory table 的 text column 使用数据库 ICU/default collation，而 `pg_catalog.format` 生成的 candidate signature 使用 `C` collation；17 个成员完全相同，数组排序却不同。Append-only follow-up `20260824164530_phase_3b_writer_inventory_c_collation` 把 signature identity 和 ordering 固定为 bytewise `C`，不回改已应用的 kernel migration。

这个结果也修正了旧 fingerprint 解释：`a28b...` 是 ICU/default ordering，生产当前按 `C` ordering 的 raw direct fingerprint 为 `ac236...`。Raw `pg_get_functiondef` 输出还受 LF/CRLF 与纯 SQL 格式化影响；staging 从当前 migration replay 后的 raw 值因此不同。跨环境 gate 不再把 raw fingerprint 相等当成正确性条件，而是严格比较 canonical signature 集合、definer/empty-`search_path` 配置、grants 与 wrapper indirectness；fingerprint 只作为同一数据库 fresh before/after drift 证据。

### 8. RLS、审计与诊断

六张 public transition/membership 表全部启用 RLS 与 FORCE RLS。authenticated 只有 manager-only SELECT；anon 与 service_role 没有表权限，所有 client role 都没有 INSERT/UPDATE/DELETE。immutable transition 表由 trigger 拒绝 UPDATE/DELETE；membership 只允许合法的单版本推进。

`supabase/diagnostics/phase_3b_inactive_transaction_kernel.sql` 在 read-only transaction 中验证：

- 六张表、RLS/FORCE RLS、policy 与 grant；
- private helper 的存在、invoker 模式、空 `search_path` 和无 client EXECUTE；
- writer inventory 与 fingerprints；
- 没有 public 3B mutation、booking dual-write trigger 或 Realtime publication；
- migration 未产生 transition、membership 或 operation 行；
- cross-origin payment FK 已安装。

输出仅含状态、计数和函数 fingerprint，不含客户 PII。

### 9. 隔离验证覆盖

PGlite integration tests 使用真实 Phase 1、Phase 2、Phase 3A 及 follow-up migrations，再应用 3B.1，覆盖：

- migration 安装后 public function fingerprint 不变且 kernel 为零行 inactive；
- 新 legacy group 接入、重试幂等和 idempotency-key 冲突；
- schedule、details、cancel/restore、`court_slots` 一致性和强制 rollback；
- 不同客户 merge，缺少明确 primary 时 fail closed；
- merge 后 Party 更新只沿显式 lineage，不误改另一位客户；
- 一人付款、AA 两次付款、跨 origin allocation、退款和 legacy payment projection；
- 一笔已付款 Reservation 拆成两笔，价格和 ledger byte-for-byte 保留；
- merge/split reverse 追加历史并恢复 effective membership；
- immutable transition 拒绝原地更新；
- authenticated 直接调用 private helper 被权限拒绝；
- writer inventory 正常通过，新增 rogue writer 时 fail closed；
- read-only 3B.1 diagnostic 完整通过。

PGlite 能验证事务原子性、失败回滚、锁顺序实现和顺序重试。`.github/workflows/reservation-db-tests.yml` 另外在 PostgreSQL 16 service 上用三个真实连接应用完整 migration chain，并发验证：相同 idempotency key 只创建一笔 Payment、两笔重叠 AA 收款正确串行且不超额、两笔全额退款竞争只有一笔成功且失败方不留下 `started` journal。该 CI 是 PR 合并前硬门禁；writer activation 后仍需在 production-like Supabase branch 重跑 contention/rollback 观察。

最终本地验证使用 Codex Desktop bundled Node `v24.19.0` 与 pnpm `11.19.0`：46 tests 通过、0 fail；1 个 real-PostgreSQL concurrency test 因本机没有 PostgreSQL 而明确 skip。`pnpm run lint` 与 `pnpm run build` 通过，build 只有既有的主 chunk >500 kB warning。

PR #135 merge 前的首轮 [Actions run 32746853283](https://github.com/tujiaqi2002/badminton/actions/runs/32746853283) 已在固定 Node 22、pnpm 11.16.0 与 PostgreSQL 16.15 上完整执行，结果为 22/22 tests、0 fail、0 skip；real-PostgreSQL concurrency、lint 与 build 全部通过。并发结果没有出现重复 Payment、AA 超额分配、双退款成功、deadlock 或失败事务遗留的 `started` operation。这个结果关闭了 PR 的真实 session CI 门禁，但不替代 production-like Supabase branch apply、fresh production preflight 或明确的 merge/生产授权。

同一时点 production 只读复核仍为 42 个 migrations，最新 `20260824132704_phase_3a_venue_settings_policy_consolidation`；security advisors 47（2 INFO / 45 WARN），performance advisors 40（全部 `unused_index` INFO）。本地第 43 个 migration 没有 push，所以这些是未应用 3B.1 的生产基线，不代表 3B.1 部署后 advisor 结果。

用户随后创建并授权初始化独立 `badminton_stage`（`vcoujmzsgdboidndtzzg`）。它从首个 migration 前的 Git schema 恢复基线，原样重放 migrations 1–38，用 192 条纯合成 booking 和 6 条 synthetic payment audit evidence 生成 staging Phase 2 指纹，再原样应用 Phase 3A、3B.1 和 collation follow-up；history 已精确对齐仓库 44 个 version/name。Phase 2/3A/3B diagnostics 均通过，kernel 保持 0/0/0 inactive，27 张 public 表全部 RLS、6 张 3B 表全部 FORCE RLS、client DML/private helper EXECUTE 均为 0，Realtime 仍只有 `court_slots`。

Staging advisors 为 49 security（生产既有 47 加上项目自带 `public.rls_auto_enable()` 的 2 条已记录 WARN）和 74 performance INFO。4 个 composite-FK advisor 项均已有反向但完整的等值 covering index，或由唯一 `booking_id` 主键覆盖；增加同列不同顺序的重复索引没有查询价值。其余 70 个 unused-index 项来自 fresh synthetic stage 无业务流量。Hosted apply 门禁完成后，[Actions run 32753722730](https://github.com/tujiaqi2002/badminton/actions/runs/32753722730) 又在 PostgreSQL 16.15 上以 22/22、0 fail、0 skip 通过真实 same-key、AA、refund races、lint 与 build；当时仍未授权 merge/生产自动部署。

### 9.1 生产部署验证（2026-08-25）

用户只授权合并 PR #135 和自动安装 inactive kernel，不授权 PR #137 activation。fresh production preflight 通过后，PR #135 于 06:24:23 UTC 合并（merge commit `e777071712ab47dea5739e718ab2a855037fb1c5`）；Supabase integration 于 06:25:04 UTC 成功应用 migrations 43–44，[GitHub Pages run 32816825670](https://github.com/tujiaqi2002/badminton/actions/runs/32816825670) 同时通过。

上线后只读验证确认：

- Phase 2 / Phase 3A diagnostics 继续通过：123 Reservations、135 Sessions、192 Court allocations、131 Parties、23 Payments、26 allocation entries、CAD 1,642.00，192/192 owned 且 0 shadow mismatch；
- Phase 3B diagnostic 返回 `phase_3b_inactive_transaction_kernel_verified`，kernel 为 0 operation / 0 membership / 0 transition；
- writer inventory 保持 17 direct / 3 wrappers，direct fingerprint 为 `ac236997585da13cc6cc0439b8eafcf0`，wrapper fingerprint 为 `d1eb5d63d36f01f1caad2e4e9e516dbf`；
- public Phase 3B mutation、booking dual-write trigger、Phase 3B Realtime publication 均为 0；Realtime 仍只有 `public.court_slots`；
- security advisors 保持 47（2 INFO / 45 WARN），没有新增等级变化；performance advisors 为 62 个 INFO，其中 4 个是已记录的 composite-FK index 提示、58 个是 unused-index 提示，没有 WARN 或 ERROR。

因此，生产现在精确停在 44 个 migrations 的 inactive 状态。PR #137 仍是 staging-only Draft；没有启用 writer、运行 catch-up、切换 read/UI、部署 Stripe 或退役 legacy。

### 10. 3B.2 接口契约与退役时间

3B.2 必须在一个 append-only activation migration 中原子覆盖全部 17 个 direct writers；三个 wrapper 继续只委托。每个 writer 先验证 caller 权限，再调用同一 private primitive，完成后执行 aggregate/legacy/financial postcondition。不能逐个上线形成半激活期。

3B.2 仍不切 read path，也不退役 legacy。之后顺序是：

1. Phase 3B.2：原子激活 writer，进入 shadow observation；
2. Phase 4：产品 read/UI cutover，并完成生产观察与可回滚窗口；
3. Phase 5：另开高风险 Issue，才评估删除 legacy group/link/payment projection、旧 RPC 和兼容代码。

因此 decommission 不是本 PR 或 Phase 3B 的内容。只有 Phase 4 已完成、所有 writer 类型在生产持续零 drift、rollback window 结束且新模型可独立运行后，才允许开始 Phase 5。

---

## English

### 1. Outcome and boundary

Phase 3B.1 has installed the database transaction capabilities required for later atomic dual-write in production, but connects no current product entry point to them. Product behavior remains unchanged:

- definitions, privileges, and delegation of the 17 direct booking writers and 3 wrappers remain unchanged;
- no Phase 3A catch-up runs and no current membership or transition row is created;
- frontend and read paths remain unchanged;
- no client mutation RPC, table DML, or Realtime publication is added;
- Stripe is not deployed and no legacy RPC, field, or projection is removed.

This is a production-installed inactive foundation, not dual-write activation. Phase 3B.2 activation, PR #137 merge, and its production deployment still require explicit authorization.

### 2. Effective ownership and immutable history

A physical Court allocation remains a row in `public.bookings`. Its Phase 2 `reservation_id` remains the immutable historical Reservation origin. `booking.session_id` is the legacy Session/schedule projection inside that physical origin; scheduling or relationship reversal may point it to another projection Session in the same origin, while transition allocations and audit preserve full Session lineage.

`reservation_allocation_memberships` is the rebuildable current-state projection:

- `origin_reservation_id`: immutable historical origin;
- `effective_reservation_id` / `effective_session_id`: current commercial Reservation and Session;
- `last_transition_id` / `version`: the append-only transition that produced current state.

A membership may advance only one version through a new immutable transition. Origin changes, deletion, and version jumps are rejected. The migration performs no membership backfill; future activated entry points create version-zero rows lazily for touched scopes.

### 3. Append-only merge, split, and reverse

Relationship changes are recorded as facts rather than overwriting facts:

| Table | Meaning |
| --- | --- |
| `reservation_transitions` | One merge, split, or reverse with stable `operation_id` |
| `reservation_transition_sources` | Reservation scope before the operation |
| `reservation_transition_targets` | Target scope and explicit primary Party for each target |
| `reservation_transition_allocations` | Each physical Court moving between effective Reservation/Sessions |
| `reservation_transition_parties` | Explicit Party lineage supporting one-to-many and many-to-one |
| `reservation_allocation_memberships` | Current effective scope rebuilt from immutable transitions |

Invariants:

- merge requires two or more sources and one new target; split requires one source and two or more new targets;
- the operation maps every current Court in every source exactly once and every target receives a Court;
- all sources and targets share one currency;
- each target has an explicitly mapped primary Party belonging to that target;
- Party identity follows explicit lineage, never name/email/phone similarity;
- reverse appends another transition and never deletes the original;
- reverse changes relationship ownership only and carries later scheduling/details facts into restored Sessions; divergent Session state remains separate rather than being overwritten by stale values;
- physical booking origin, original price, Payment, and allocation ledger are never rewritten.

### 4. Payment model

One-payer settlement and AA use the same append-only ledger:

- one payer: one Payment allocated across multiple Courts;
- AA: multiple payer-specific Payments allocated to Courts in the same Reservation;
- refund: a new refund Payment with negative allocation entries; the successful Payment remains unchanged;
- legacy `bookings.payment_status` is a same-transaction compatibility projection derived from per-booking ledger balance.

To support lossless one-payer settlement after merging existing Reservations, the allocation-to-booking FK changes from `(booking_id, reservation_id)` to `booking_id -> bookings.id`. Business ownership is not weakened: the private payment primitive locks the complete booking scope and validates effective Reservation, currency, remaining allocatable amount, and payer Party before writing.

`payment_allocation_entries.reservation_id` therefore identifies the commercial/effective Reservation at receipt time, while `booking.reservation_id` preserves physical historical origin. A single Payment may cover Courts from multiple origins without rewriting ledger history.

### 5. Private transaction primitives

| Capability | Private helper | Required postcondition |
| --- | --- | --- |
| Attach a new legacy group | `reservation_phase3b_attach_legacy_groups` | Deterministic aggregate exists; membership version 0 |
| Reschedule | `reservation_phase3b_reschedule_session` | Session first, then every Court; exact time projection |
| Cancel/restore | `reservation_phase3b_set_booking_status` | Booking and `court_slots` agree atomically |
| Customer details | `reservation_phase3b_update_booking_details` | Complete Session scope; matching contact follows explicit Party lineage |
| Payment | `reservation_phase3b_record_payment` | Payment, allocations, and legacy status commit together |
| Refund | `reservation_phase3b_refund_payment` | Negative entries append; original payment remains |
| Merge/split | `reservation_phase3b_apply_transition` | Complete scope, explicit primary, immutable lineage |
| Undo | `reservation_phase3b_reverse_transition` | New reverse transition restores membership while preserving later Session facts |
| Resolve current scope | `reservation_phase3b_effective_scope` | Returns both physical origin and effective ownership |

All helpers are currently `SECURITY INVOKER`, pin an empty `search_path`, and revoke EXECUTE from `public`, `anon`, `authenticated`, and `service_role`. A future 3B.2 public writer may invoke them only inside a database function after caller authorization; clients cannot call them directly.

### 6. Concurrency, idempotency, and rollback

Every mutation uses a stable `operation_id` and request fingerprint:

- same key and same request returns the first result without duplicating a Payment, transition, or audit;
- same key and different request fails closed;
- a committed incomplete operation is not silently retried and requires investigation;
- any SQL or constraint failure rolls back the operation journal, aggregate, legacy projection, and audit together.

The global lock order is:

1. operation advisory lock;
2. UUID-sorted booking advisory locks;
3. Reservations;
4. Sessions;
5. bookings / Court allocations;
6. memberships, Parties, Payments, and allocation entries.

Helpers set transaction-local `lock_timeout = 5s` and `statement_timeout = 30s`; no network call occurs under lock. Database constraints remain the final authority for scheduling, FK, and amount integrity.

### 7. Writer-inventory gate

`private.reservation_phase3b_writer_inventory` pins 17 direct booking writers, 3 delegating wrappers, and 2 undeployed Stripe service-role paths with schema-qualified canonical signatures.

`assert_reservation_phase3b_writer_inventory()` verifies the exact direct-writer set, definer/security settings and current grants, ensures wrappers remain indirect, and returns reviewable function fingerprints. Any missing or additional writer fails activation preflight closed.

The first hosted-staging run exposed a portability bug in this gate. The inventory table's text column used the database ICU/default collation, while candidate signatures produced by `pg_catalog.format` used `C` collation. Both arrays contained the same 17 members but sorted differently. The append-only follow-up `20260824164530_phase_3b_writer_inventory_c_collation` pins signature identity and ordering to bytewise `C` without rewriting the already-applied kernel migration.

This also corrects the old fingerprint interpretation: `a28b...` came from ICU/default ordering, while the current production raw direct fingerprint under `C` ordering is `ac236...`. Raw `pg_get_functiondef` output also changes with LF/CRLF and formatting-only SQL differences; staging replayed from current migrations therefore has different raw values. Cross-environment correctness no longer assumes raw-fingerprint equality. It strictly compares the canonical signature set, definer/empty-`search_path` configuration, grants, and wrapper indirectness. A fingerprint remains useful only as a fresh before/after drift signal within the same database.

### 8. RLS, audit, and diagnostics

All six public transition/membership tables use RLS and FORCE RLS. Authenticated users have manager-only SELECT; anon and service-role have no table privileges; no client role has DML. Immutable tables reject UPDATE/DELETE, and membership accepts only a legal one-version advance.

`supabase/diagnostics/phase_3b_inactive_transaction_kernel.sql` runs read-only and verifies table security, private-helper security, writer inventory, absence of public mutations/dual-write triggers/Realtime publication, zero activation rows, and the cross-origin payment FK. Output contains only state, counts, and function fingerprints—never customer PII.

### 9. Isolated validation coverage

PGlite integration tests apply the real Phase 1, Phase 2, Phase 3A, and follow-up migrations before 3B.1. They cover inactive installation, legacy-scope attachment, scheduling/details/cancel, full rollback, idempotency conflicts, explicit-primary different-customer merge, Party lineage, one-payer and AA ledger behavior, cross-origin allocation, refund, paid split without price/ledger rewrite, merge/split reverse, immutable history, permission denial, writer-inventory fail-closed behavior, and the read-only diagnostic.

PGlite verifies transaction atomicity, rollback, implemented lock order, and sequential retries. `.github/workflows/reservation-db-tests.yml` additionally applies the complete migration chain to a PostgreSQL 16 service with three real connections and concurrently verifies: one Payment for the same idempotency key, safe serialization of two overlapping AA receipts without over-allocation, and exactly one winner for two competing full refunds with no committed `started` journal. This CI is a hard PR-merge gate; activation must still repeat contention/rollback observation on a production-like Supabase branch.

Final local verification used the Codex Desktop bundled Node `v24.19.0` and pnpm `11.19.0`: 46 tests passed with zero failures; one real-PostgreSQL concurrency test explicitly skipped because no local PostgreSQL service exists. `pnpm run lint` and `pnpm run build` passed, with only the existing >500 kB main-chunk warning.

PR #135's first pre-merge [Actions run 32746853283](https://github.com/tujiaqi2002/badminton/actions/runs/32746853283) completed on pinned Node 22, pnpm 11.16.0, and PostgreSQL 16.15 with 22/22 tests, zero failures, and zero skips; the real-PostgreSQL concurrency test, lint, and build all passed. The concurrent cases produced no duplicate Payment, AA over-allocation, double-refund winner, deadlock, or committed stale `started` operation. This closes the PR's real-session CI gate, but does not replace a production-like Supabase branch apply, fresh production preflight, or explicit merge/production authorization.

The same point-in-time production read-only check still showed 42 migrations, latest `20260824132704_phase_3a_venue_settings_policy_consolidation`; 47 security advisories (2 INFO / 45 WARN); and 40 performance advisories (all `unused_index` INFO). The local 43rd migration was not pushed, so those values are the pre-3B.1 baseline, not post-deployment advisor results.

The user then created and authorized initialization of the independent `badminton_stage` project (`vcoujmzsgdboidndtzzg`). It restored the Git base schema immediately before the first migration, replayed migrations 1–38 unchanged, used 192 wholly synthetic bookings plus six synthetic payment-audit evidence rows to produce staging Phase 2 fingerprints, and then applied Phase 3A, Phase 3B.1, and the collation follow-up unchanged. Its migration history exactly matches the repository's 44 versions/names. Phase 2, Phase 3A, and Phase 3B diagnostics all pass; the kernel remains 0/0/0 inactive; all 27 public tables use RLS; all six Phase 3B tables use FORCE RLS; client DML/private-helper EXECUTE counts are zero; and Realtime still contains only `court_slots`.

Staging has 49 security advisories: the existing production 47 plus two recorded warnings for the project-provided `public.rls_auto_enable()`. All 74 performance findings are INFO. Four composite-FK findings already have either complete reversed-order equality indexes or the unique `booking_id` primary key, so duplicate indexes were not added; the other 70 unused-index findings are expected on a fresh synthetic database with no workload. After the hosted-apply gate completed, [Actions run 32753722730](https://github.com/tujiaqi2002/badminton/actions/runs/32753722730) passed on PostgreSQL 16.15 with 22/22 tests, zero failures, zero skips, the real same-key/AA/refund races, lint, and build. Merge and automatic production deployment had not yet been authorized at that point.

### 9.1 Production deployment verification (2026-08-25)

The user authorized only merging PR #135 and automatically installing the inactive kernel, not PR #137 activation. After a fresh production preflight passed, PR #135 merged at 06:24:23 UTC (merge commit `e777071712ab47dea5739e718ab2a855037fb1c5`); Supabase integration successfully applied migrations 43–44 at 06:25:04 UTC, and [GitHub Pages run 32816825670](https://github.com/tujiaqi2002/badminton/actions/runs/32816825670) passed.

Post-deployment read-only verification confirmed:

- Phase 2 and Phase 3A diagnostics still pass: 123 Reservations, 135 Sessions, 192 Court allocations, 131 Parties, 23 Payments, 26 allocation entries, CAD 1,642.00, 192/192 owned, and zero shadow mismatch;
- the Phase 3B diagnostic returns `phase_3b_inactive_transaction_kernel_verified`, with zero operations, memberships, and transitions;
- writer inventory remains 17 direct writers and 3 wrappers, with direct fingerprint `ac236997585da13cc6cc0439b8eafcf0` and wrapper fingerprint `d1eb5d63d36f01f1caad2e4e9e516dbf`;
- public Phase 3B mutations, booking dual-write triggers, and Phase 3B Realtime publications are all zero; Realtime still contains only `public.court_slots`;
- security advisories remain 47 (2 INFO / 45 WARN) without a severity change; performance advisories are 62 INFO items—4 recorded composite-FK index notices and 58 unused-index notices—with no WARN or ERROR.

Production therefore stops exactly at 44 migrations with the kernel inactive. PR #137 remains a staging-only Draft; no writer activation, catch-up, read/UI cutover, Stripe deployment, or legacy retirement occurred.

### 10. Phase 3B.2 contract and decommission timing

Phase 3B.2 must atomically cover all 17 direct writers in one append-only activation migration; wrappers remain delegating only. Each writer authorizes the caller, invokes the shared private primitive, and verifies aggregate/legacy/financial postconditions. Partial writer-by-writer activation is not allowed.

3B.2 still does not switch reads or retire legacy behavior. The sequence is:

1. Phase 3B.2: atomically activate writers and enter shadow observation;
2. Phase 4: cut over product reads/UI and complete production observation plus rollback window;
3. Phase 5: open a separate high-risk issue to evaluate retirement of legacy group/link/payment projections, RPCs, and compatibility code.

Decommission is therefore outside this PR and Phase 3B. It may begin only after Phase 4 is complete, every writer remains zero-drift in production, the rollback window has closed, and the new model operates independently.
