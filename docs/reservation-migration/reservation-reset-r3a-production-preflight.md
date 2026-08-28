# Reservation reset R3A：production preflight 与 R3B 执行草案

> 关联 Issue：[#165](https://github.com/tujiaqi2002/badminton/issues/165)
> 基线：2026-08-28
> 状态：R3A 已完成；R3B production / Auth destructive execution **未授权、未执行**。

## 1. 本阶段边界

R3A 只完成 production read-only preflight、最终 selector/manifest、repo 外加密备份、隔离恢复证明，以及默认关闭的 production runner 和 Auth runbook 草案。

本阶段没有 production delete/update/insert、Auth mutation、migration、DDL persistence、grant/RLS/Realtime 变更、deployment、PR merge 或旧数据清理。Production 所有 66 个关系在备份采集前后内容指纹完全一致。

## 2. Fresh production inventory

Production project `ldbtrouofmqmnkyxiewk` 为 `ACTIVE_HEALTHY`，PostgreSQL `17.6.1.155`；migration history 为 51，最新版本为 `20260827090512_reservation_phase_4c1_party_lineage`。

| Domain | Rows |
| --- | ---: |
| Bookings / court slots | 192 / 139 |
| Reservations / Sessions / Parties | 123 / 135 / 131 |
| Party roles / allocation memberships | 254 / 192 |
| Payments / allocation entries | 23 / 26 |
| Payment allocation ledger | CAD 1,642.00 |
| Recurrence series | 2 |
| Booking admin actions | 1,308 |
| Booking/event/member audit purge selector | 1,661 |
| Test venue events / members | 2 / 2 |

所有 123 个 Reservations 都来自 `legacy_migration`，23 个 Payments 都没有 provider reference。Audit selector 使用冻结时的 booking/event/member **实体 ID 集合**，不是猜测 `entity_type` 文案；它命中 1,661 行并保留其余 77 行配置/安全审计。

当前权限/部署基线仍为：28/28 public tables 启用 RLS、private schema 没有 anon/authenticated USAGE、Realtime publication 只有 `public.court_slots`。

## 3. Auth preserve / purge 边界

| Scope | Managers | Non-manager test account |
| --- | ---: | ---: |
| Auth users | 3 | 1 |
| Identities | 4 | 1 |
| Sessions at preflight | 7 | 1 |
| Refresh tokens at preflight | 38 | 1 |
| Profiles | 2 | 1 |
| Staff / manager-account authorization | 3 / 3 | 0 / 0 |

唯一 non-manager 的 selector 由“`auth.users` 中不在 admin `staff_members` 集合”推导，并以 ID 的 SHA-256 冻结；仓库不记录 user UUID、邮箱或其他个人资料。该账号只在将清理的 Bookings/Parties 中有 2 / 2 个业务引用，其他 26 个 public/private Auth FK 落点均为 0。`storage.objects.owner` 与 `owner_id` 命中均为 0。

Auth rows 不属于数据库 runner。数据库事务先删除该账号的 transaction-domain 引用和 profile，成功提交后才允许按独立 runbook 处理 Auth user/identity/session/refresh token。

## 4. Fresh encrypted recovery artifact

Artifact 与 DPAPI key 只存在 repo 外的 operator-local 受限目录；仓库不记录实际路径、key、明文、PII 或 Auth credential。

| Evidence | Result |
| --- | ---: |
| Relations / rows | 66 / 4,687 |
| Encrypted chunks | 242 |
| Artifact size | 1,106,060 bytes |
| Artifact SHA-256 | `7e4e3f877940cc92e79268ae28f71211097e71efaa12bdb9775b256fd377f115` |
| Production fingerprints unchanged | 66 / 66 |
| ACL | Inheritance disabled; current operator + SYSTEM only |
| Persisted plaintext | No |

每个 chunk 在 production PostgreSQL 内通过 `extensions.pgp_sym_encrypt` / AES-256 加密后才返回。随机 32-byte key 由 Windows DPAPI CurrentUser 保护。

PGlite in-memory PostgreSQL 18.3 成功解密并重建 66 个关系，验证了 66 个关系指纹、Auth/staff/manager 关系、Reservation/Session/Party/allocation 引用、CAD 1,642.00 ledger 与 51 条 migration。此结果证明 artifact 可恢复和逻辑关系完整；它不是 hosted PostgreSQL 17.6 的实际 production restore，也不是 production RTO。

## 5. Production runner 草案

[`reservation_reset_r3b_production_draft.sql`](../../supabase/maintenance/reservation_reset_r3b_production_draft.sql) 是独立 production 文件，位于 migration 自动执行路径之外，并固定以：

```text
tiger.r3b.execution_authorized = false
```

开场。因此当前版本即使被误提交执行，也会在 table lock 或 delete 前拒绝。未来 R3B 必须在 fresh manifest 仍一致、文件最终 hash 已 review、用户再次明确确认后，才可以生成启用版本。

当前 **disabled review draft** SHA-256 为 `0f8a9d990988c5fcecb44c23829be99199484bd1b98fe31340c22e2a1e1261bf`。未来启用开关会改变文件 hash，因此它不是可直接授权执行的最终 hash；R3B 必须重新计算并再次确认。

Runner 冻结 15 个 preserve selectors / 206 rows 和 25 个 purge selectors / 4,327 rows：

| Scope | Combined SHA-256 |
| --- | --- |
| Preserve | `d5c5186d647d6f5a9d8f552d886e92773733905821694be1d28b381ac045310f` |
| Purge | `c945049e3725602fd00a9e963591962e74744f96bf89852d32143f384a8cb39c` |

结构包括 serializable transaction、5 秒 lock timeout、固定顺序 table locks、transaction advisory lock、schema/catalog drift gates、40 个逐关系 count/fingerprint assertions、28 个 Auth FK selector assertions、explicit child-to-parent deletes、短暂 transaction-local trigger bypass，以及提交前 preserve/RLS/Realtime/migration/sequence postflight。

Runner 不使用 `TRUNCATE`，不删除任何 `auth.*` row，不重置 sequence。成功时只额外写入固定 negative-ID、PII-free database-complete/Auth-pending audit marker；第二次执行会在 delete 前拒绝。

## 6. R3B 操作顺序与恢复边界

R3B 仍需要一次新的 destructive confirmation。建议预留 15 分钟无人写入的维护窗口；这只是操作窗口，不是已测量 RTO。

1. 停止馆长写操作，保持普通客户登录关闭；确认没有另一个 maintenance runner。
2. 重新跑 read-only counts/fingerprints、Auth/storage selectors 和 backup decryptability check。任何变化都要停止，刷新 runner 后重新 review/确认。
3. 记录最终 runner SHA-256；只有用户明确授权这个 hash、4,327 个 database rows 和唯一 non-manager Auth graph 后，才生成启用版本。
4. 执行 database transaction。锁超过 5 秒、manifest drift、postflight mismatch 或任何 SQL error 都在 commit 前自动 rollback。
5. database marker 返回 `tiger_r3b_database_reset_committed_auth_pending` 后，先完成只读 database postflight。
6. 再按 [`reservation-reset-r3b-auth-runbook.md`](./reservation-reset-r3b-auth-runbook.md) 删除唯一 non-manager Auth user，并完成 JWT/session 与 manager login 验证。
7. 更新 Issue/项目文档。PR merge、deployment 和 Phase 5 selector/decommission 仍是独立授权。

重要恢复边界：database commit 后没有单 SQL transaction undo。若 DB postflight 后发现问题，应立即停止 Auth 删除并使用加密 artifact 进入受控恢复；当前只完成逻辑隔离恢复证明，没有测量 hosted production restore RTO。因此最终 R3B confirmation 必须把 post-commit database purge 视为操作上不可即时撤回。

R2 hosted stage reset + restore 总时间是 295.895 ms，但 production 从未执行 delete，不能把 R2 数字当 production RTO。

## 7. Fresh advisors

R3A read-only baseline 为 49 条 security advisor notices（2 INFO / 47 WARN）和 59 条 performance INFO。它们是既有 RLS/no-policy、public extension、authenticated manager security-definer boundary、leaked-password protection 与 unused-index 类别；R3A 没有新增 persistent database object，不在本阶段顺手修复。参考 [Supabase Database Linter](https://supabase.com/docs/guides/database/database-linter)。

Supabase 官方恢复与 Auth 行为参考：[Database Backups](https://supabase.com/docs/guides/platform/backups)、[Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)、[Managing User Data](https://supabase.com/docs/guides/auth/managing-user-data) 与 [User Sessions](https://supabase.com/docs/guides/auth/sessions)。

---

## English summary

R3A completed a read-only production preflight, froze the exact purge/preserve selectors, refreshed a repository-external encrypted backup, and proved an in-memory logical recovery. The artifact contains 4,687 rows across 66 relations in 242 encrypted chunks, hashes to `7e4e3f877940cc92e79268ae28f71211097e71efaa12bdb9775b256fd377f115`, and left all 66 production fingerprints unchanged.

The production database runner is a disabled review artifact. It would purge 4,327 selected database rows while preserving 206 frozen manager/config/migration rows, but it cannot run while `tiger.r3b.execution_authorized = false`. It does not delete Auth data. The sole non-manager Auth graph is a separate post-commit operation. No production or Auth deletion, merge, migration, or deployment was performed in R3A.
