# Reservation reset R2：`badminton_stage` reset / restore rehearsal

> 关联 Issue：[#165](https://github.com/tujiaqi2002/badminton/issues/165)
> 基线：2026-08-27
> 状态：R2 已完成；production R3 destructive gate 尚未授权。

## 1. 授权边界

用户从明确门禁继续，授权内容只有：

- 在 `badminton_stage` / `vcoujmzsgdboidndtzzg` 使用 synthetic data；
- 编写 migration auto-apply path 之外的 one-time reset/restore runner；
- 验证故障 rollback、成功 restore、重复执行拒绝、权限和 postflight；
- 记录证据与 Draft PR。

本阶段没有连接或修改 production，没有删除任何 Auth row，没有 migration、DDL persistence、public/private RPC、grant、RLS policy、Realtime publication、selector、Pages deployment 或 PR merge。

R2 transaction snapshot 不替代独立 recovery artifact；future R3 仍须刷新 repo 外 encrypted logical backup。官方流程见 [Database Backups](https://supabase.com/docs/guides/platform/backups) 与 [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)。

## 2. Stage preflight 与补充 fixture

Preflight 只读确认：

- project `badminton_stage`，状态 `ACTIVE_HEALTHY`；
- PostgreSQL `17.6.1.155`；
- 51 migrations，最新 `20260827090512_reservation_phase_4c1_party_lineage`；
- 192 bookings、139 court slots、123 Reservations、135 Sessions、131 Parties、192 memberships、23 Payments、26 allocation entries、2 recurrence series；
- 3 Auth users、2 identities、3 sessions、2 profiles、2 admin staff；
- 所有 booking 都属于固定 synthetic manager，客户邮箱只使用 `example.invalid`；
- Realtime 只有 `public.court_slots`。

Stage 原来没有 `venue_events`、`venue_members` 或 `booking_admin_actions`。为覆盖 production 已确认的 purge 类别，stage-only fixture 在 rollback dry-run 通过后写入：

- 2 个 deterministic events 与 2 个 event-court rows；
- 2 个 deterministic members，联系人使用 `example.invalid`；
- 2 个 negative-ID booking admin actions；
- 4 个 negative-ID、PII-free member/event audit rows。

Fixture 前后 Auth user count 都是 3；没有 Auth mutation。Fixture 和 runner 都位于 [`supabase/maintenance`](../../supabase/maintenance)，不在 migration path。

## 3. Frozen manifest 与 runner 结构

Runner 冻结：

| Scope | Relations | Rows | Combined fingerprint |
| --- | ---: | ---: | --- |
| Preserve | 17 | 134 | `5d5f491dfb3f49b9aeb11208c34c9e64` |
| Purge / restore | 24 | 1,563 | `d7b8917ef74c84b6dc8472966aab6203` |

Preserve scope 包括 Auth users/identities/sessions/refresh tokens、profiles/staff、Courts、venue settings/opening/pricing/member tiers、manager accounts、Phase 3 writer config、4 条 pricing audit 和 51 migration rows。Purge scope 包括完整 legacy/canonical transaction graph、booking audit/actions，以及精确 fixture event/member IDs。

六个 affected identity sequences 同时冻结并要求保持原值：audit events、booking actions、payment allocations、legacy sources、transition sequence 和 Reservation reference number。Runner 不把 sequence 重置为 1，因为 preserved audit/config rows 仍可能占用正 ID；它使用 explicit identity restore 和 negative-ID marker，避免不可回滚的 sequence side effect。

Hosted protocol 执行并在提交前复核的文件 SHA-256：

- fixture：`2a8a8d4ee8834d463564cc92c905aa5e3c25c8f8e9ac113fa78b375c5c750cc9`；
- runner：`7723aa4991e211956724f9434da85cb2065990c26335e8792088549295e9581f`。

安全结构：

- serializable transaction，5 秒 lock timeout、120 秒 statement/idle timeout；
- transaction advisory lock + explicit table locks；
- `pg_temp` count/fingerprint helpers 和 transaction-local table snapshots；
- explicit child-to-parent deletes，没有 `TRUNCATE` 或 `CASCADE`；
- `session_replication_role=replica` 只包住已锁定的 delete/restore 段，用于越过 append-only user triggers；
- reset 后先证明 24 类 purge rows 归零且 17 类 preserve rows 不变；
- restore 后逐关系 count/fingerprint、CAD 1,642.00 ledger、ownership、FK validation flags、28/28 public RLS、Realtime 和 sequences 全部通过才允许 commit；
- 固定 operation marker 使第二次运行在删除前 fail closed。

## 4. Hosted PostgreSQL 17.6 结果

### Failure rollback probe

执行临时 `fail_after_reset=true` 副本后，runner 已完成实际 delete 和 reset assertions，再按设计抛出：

```text
tiger_r2_rehearsal_injected_failure_after_reset
```

整个 transaction rollback。随后原 runner 的所有 frozen preflight fingerprints 仍匹配，证明没有残留 reset 或 marker。

### Reset + restore

原文件返回：

| Evidence | Result |
| --- | --- |
| Status | `tiger_r2_stage_reset_restore_verified` |
| PostgreSQL | 17.6 |
| Migration count | 51 |
| Preserve rows | 134 |
| Purge / restored rows | 1,563 |
| Reset time | 111.372 ms |
| Restore time | 184.523 ms |
| Total transaction work | 295.895 ms |
| Auth deleted | No |
| Sequence values changed | No |

这些毫秒数是当前 synthetic stage 的 hosted rehearsal 时间，不是 future production RTO。R3 必须用 production fresh manifest 和维护窗口重新测量。

### Second run

同一 SQL 再次运行时，在任何 delete 前返回：

```text
tiger_r2_rehearsal_already_completed
```

因此 one-time policy 已验证为安全拒绝，不是重复清理。

## 5. Hosted postflight

- marker count 1；business counts 恢复为 192 / 139 / 123 / 135 / 131 / 192 / 23 / 26，ledger 仍为 CAD 1,642.00；
- Auth 仍是 3 users / 2 identities / 3 sessions，staff 仍是 2；
- synthetic login manager 的 read shadow RPC 返回 `clean`、192 allocations / 123 summaries / 0 mismatch；
- synthetic authenticated non-manager 仍返回 `Manager access required`；
- public tables 28/28 RLS；Realtime 仍只有 `public.court_slots`；migration history 仍为 51；
- `private` schema 对 anon/authenticated 都没有 USAGE，四张内部 Phase 3 tables 也没有任何 anon/authenticated SELECT/INSERT/UPDATE/DELETE grant。

Supabase table inventory 的通用提示会把四张未启用 RLS 的 private internal tables 标成高风险；实际 schema/grant 检查证明它们不在 Data API exposed schema 且 client 无权限，因此 R2 不自动加 RLS/policy。Current official advisors 为 51 security（2 INFO / 49 WARN）和 56 performance INFO；全部是既有 extension/authenticated manager boundary/password protection/unused-index 类别，没有 R2 persistent object finding。[RLS 参考](https://supabase.com/docs/guides/database/postgres/row-level-security)。

## 6. 下一门禁：R3

R2 完成不授权 production purge。R3 至少需要：

1. fresh production encrypted backup 与 restore credential check；
2. production counts/IDs/fingerprints、Audit selector 和 Auth preserve/purge manifest 重新冻结；
3. 新的 production-specific runner review，不能修改或复用 R2 stage file；
4. maintenance window、真实 RTO/rollback boundary 和 final destructive confirmation；
5. database transaction 与非 manager Auth user/session deletion 分开授权和排序；
6. production manager login、RLS/RPC/Realtime/advisor/browser postflight。

在这些条件完成前，production 保持原样，profile selector 继续 legacy，PR merge/deployment 也不属于 R2。

---

## English summary

Issue #165 R2 completed a hosted PostgreSQL 17.6 reset/restore rehearsal against exact synthetic `badminton_stage` fingerprints. A fault injected after the real reset rolled the entire transaction back. The successful run reset and restored 1,563 rows while preserving 134 rows, all frozen relation fingerprints, six sequence values, the CAD 1,642.00 ledger, Auth, RLS, Realtime, and 51 migrations. Reset took 111.372 ms, restore 184.523 ms, and total transaction work 295.895 ms. A second run was rejected before deletion by the fixed audit marker.

The SQL is stage-specific, outside the migration path, and creates no persistent RPC or schema object. It does not authorize or implement production or Auth deletion. R3 requires a fresh production backup/manifest, a newly reviewed production-specific runner, maintenance/RTO planning, and another explicit destructive confirmation.
