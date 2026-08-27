# Reservation reset：R0 inventory 与 R1 encrypted recovery proof

> 关联 Issue：[#165](https://github.com/tujiaqi2002/badminton/issues/165)
> 时间基线：2026-08-27
> 当前状态：R0 / R1 已完成；R2 `badminton_stage` synthetic reset/restore rehearsal 后续已完成。

## 1. 决策与授权边界

当前 Reservation 数据不是需要逐条迁移的真实业务历史。用户确认下列记录只是馆长和项目维护者的试用数据，可以进入未来的 purge set：

- Reservation 交易域及其 legacy/canonical 投影、付款、关系、循环与审计记录；
- 2 条测试 `venue_events`；
- 2 条测试 `venue_members` 及其 member audit；
- 唯一非馆长 Auth user，以及对应 identity、session 和 profile。

必须保留：

- 3 名馆长 Auth users、identities、sessions、profiles；
- `staff_members` 与 `manager_accounts` 授权关系；
- Courts、馆务设置、营业时间、定价、会员等级定义；
- 配置/安全审计、Phase 3 writer config 与 migration history。

本次授权只覆盖 R0 read-only inventory 与 R1 backup/restore proof。它不授权 R2 runner、staging reset、production 删除、Auth 删除、migration、selector、deployment、PR merge 或 Phase 5 decommission。

## 2. R0 production inventory

Production project 在盘点时为 `ACTIVE_HEALTHY` / PostgreSQL 17.6，migration history 为 51，最新版本是 `20260827090512_reservation_phase_4c1_party_lineage`。

主要 purge candidate：

| Domain | Rows |
| --- | ---: |
| Legacy bookings | 192 |
| Effective court slots | 139 |
| Reservations | 123 |
| Reservation sessions | 135 |
| Reservation parties | 131 |
| Court-allocation memberships | 192 |
| Payments | 23 |
| Payment allocations | 26 |
| Recurrence series | 2 |
| Booking audit events | 1,652 |
| Booking admin actions | 1,308 |

所有 canonical Reservations 都来自 `legacy_migration`。23 条 Payment 都是 `legacy_unknown`，没有 provider reference；因此没有外部支付系统需要在 reset 前对账或取消。Auth/staff/manager 精确核对证明 3 名 preserve managers 的授权链完整。

安全基线为 28/28 public tables 启用 RLS，private schema 没有 client access，Realtime publication 只有 `public.court_slots`。R0 没有执行写入、DDL、grant 或 Auth mutation。

## 3. R1 encrypted snapshot

快照写入 repo 外、operator-local 受限目录；仓库只记录非敏感元数据，不记录实际路径、key、明文、PII、Auth credential 或 backup artifact。

| Evidence | Result |
| --- | --- |
| Relations | 66 |
| Rows | 4,687 |
| Encrypted chunks | 173 |
| Artifact size | 760,974 bytes |
| Artifact SHA-256 | `7550613970a36081abc2e5c104be6ed18e5edbe6f2b7ed2c82895ec606014c12` |
| Production before/after fingerprints | 66 / 66 identical |

Scope 包含 28 个 public tables、7 个 private tables、23 个 auth tables、`supabase_migrations.schema_migrations` 和 7 个 sequences。

每个 chunk 在 production 内使用 `extensions.pgp_sym_encrypt`、AES-256 与压缩后才返回；本地只写 ciphertext。随机 32-byte key 由 Windows DPAPI CurrentUser 保护，目录关闭 ACL inheritance，只允许当前用户与 SYSTEM。一次未完成的初始 writer 在生成有效内容前已停止，随后复用同一目录和 key 完成最终 artifact；结束时没有残留 writer process。

这是针对 Issue #165 purge/preserve 边界的加密 logical snapshot，不冒充 Supabase platform physical backup。Supabase 官方 backup/restore 操作仍以 [Database Backups](https://supabase.com/docs/guides/platform/backups) 与 [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) 为准。

## 4. Isolated restore proof

恢复在 PGlite in-memory PostgreSQL with pgcrypto 中执行，明文只存在于进程内存，没有落盘。最终结果：

| Check | Result |
| --- | ---: |
| Restore PostgreSQL version | 18.3 |
| Restored relations / rows | 66 / 4,687 |
| Stable JSON round-trip fingerprints | 66 |
| Schema-accurate FK constraints validated | 33 |
| Business integrity assertions | 30 |
| Payment/allocation ledger | CAD 1,642.00 conserved |
| Persisted plaintext | No |
| Local elapsed time | 3,631 ms |

验证覆盖 preserve managers、Auth/staff/manager 关系、Reservation/Session/Party/allocation 所有权、Payments/allocations 金额、legacy/canonical lineage、Court references、配置和 migration history。

恢复时发现 6 条 legacy bookings 的 `recurrence_series_id` 在 canonical `reservation_recurrence_series` 中没有 parent。当前生产 schema 本来就没有 legacy recurrence 到 canonical recurrence 的 FK；6 条 canonical Reservations 都正确引用 2 个 canonical series。由于这些都是确认将清理的测试记录，R1 记录差异但不设计数据修复。

## 5. R1 能证明什么、不能证明什么

R1 已证明：

- artifact 可解密，所有 chunk hash 和关系 payload 可重建；
- preserve/purge 范围可以从同一快照复核；
- 核心 FK、业务关系和 CAD 1,642.00 ledger 在 logical round-trip 后成立；
- 生产在采集前后保持逐关系内容指纹一致。

R1 不能证明：

- PostgreSQL 17.6 hosted 环境中的同版本 reset/restore；
- Supabase Auth Admin API 的真实删除顺序与 session 行为；
- production 数据量和网络条件下的实际 RTO；
- production purge 已被授权或可以立即执行。

隔离 runtime 是 PostgreSQL 18.3，而 production/staging 是 PostgreSQL 17.6。3.631 秒只是本地 logical validation 时间，不是 production RTO。

## 6. 下一门禁：R2

只有用户单独确认后，R2 才能在 `badminton_stage` 使用 synthetic data 编写并演练 one-time reset/restore runner。R2 至少需要验证：

1. purge/preserve selectors 精确命中预期 fixture；
2. FK-safe 删除顺序、sequence reset 和 transaction rollback；
3. preserve manager login、staff/RLS/RPC 权限继续有效；
4. Courts、馆务配置、营业时间、定价、会员等级和审计基线保留；
5. `court_slots`-only Realtime 与 migration history 不变；
6. synthetic restore、postflight assertions、failure recovery 与 hosted RTO。

R2 后续已在 `badminton_stage` / PostgreSQL 17.6 完成 reset/restore、故障 rollback 与重复运行拒绝；完整结果见 [`reservation-reset-r2-stage-rehearsal.md`](./reservation-reset-r2-stage-rehearsal.md)。R2 完成后仍不能自动进入 production。Production preflight、最终 purge manifest、Auth deletion、执行窗口、rollback/RTO 和 destructive confirmation 必须形成下一次独立门禁。

---

## English summary

Issue #165 replaces the preserve-every-test-row migration premise with an explicit reset path. R0 classified the current reservation domain, two venue events, two venue members, and the sole non-manager account as test-only while protecting all three manager authorization graphs and venue/configuration history. R1 captured 4,687 rows across 66 relations in 173 production-encrypted chunks, produced artifact SHA-256 `7550613970a36081abc2e5c104be6ed18e5edbe6f2b7ed2c82895ec606014c12`, and left all 66 production fingerprints unchanged.

An in-memory PostgreSQL 18.3 restore reproduced all 66 stable relation fingerprints, validated 33 foreign keys and 30 business assertions, and conserved the CAD 1,642.00 ledger without persisting plaintext. Because hosted production/staging use PostgreSQL 17.6, R1 is decryptability and logical-recovery evidence—not a same-version hosted rehearsal or production RTO. R2 remains separately authorized, synthetic-only work in `badminton_stage`; no production or Auth deletion is authorized.
