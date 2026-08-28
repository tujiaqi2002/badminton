# Tiger one-time database maintenance

本目录只保存经 Issue 单独授权的 one-time maintenance SQL。它刻意位于 `supabase/migrations` 之外，不会被 Supabase GitHub integration、`db push`、新环境 bootstrap 或 Pages deployment 自动执行。

## Issue #165 / R2

- `reservation_reset_r2_stage_fixture.sql`：只在 `badminton_stage` 精确 synthetic baseline 上补 2 条活动、2 条会员、2 条 booking action 和 4 条 PII-free audit fixture。
- `reservation_reset_r2_stage_rehearsal.sql`：只对该精确 stage baseline 执行 transaction-scoped reset + restore rehearsal。

两份 SQL 都是 stage-specific evidence，不是 production runner：

- 不包含 production project ref；
- 不删除任何 Auth user/identity/session、profile、staff 或 manager authorization；
- 不使用 `TRUNCATE ... CASCADE`；
- 使用 explicit tables/IDs、冻结 counts/fingerprints、PostgreSQL 17 gate、advisory/table locks 和短 serializable transaction；
- `pg_temp` helper 与临时 snapshot 在 transaction 结束后消失，不创建 persistent RPC/table/schema；
- append-only triggers 只在受锁事务的 delete/restore 段通过 `session_replication_role=replica` 暂停，随后恢复 `origin`，并以逐关系 fingerprint、ledger、RLS、Realtime 和 sequence assertions 验证；
- 成功后写入一个固定、PII-free maintenance audit marker；相同 operation 第二次运行会在任何 delete 前拒绝。

R2 hosted 协议依次验证：

1. fixture SQL 的 rollback-only dry-run；
2. fixture commit；
3. 把 runner 顶部 `tiger.r2.fail_after_reset` 的临时执行副本改为 `true`，确认 reset 后故障整笔 rollback；
4. 原文件成功执行 reset + restore；
5. 原文件第二次执行返回 `tiger_r2_rehearsal_already_completed`；
6. read-only manager/non-manager、RLS/grant、Realtime、migration/advisor postflight。

不要删除 marker、修改 frozen fingerprint 或换 project 后重跑来绕过门禁。需要新的 staging rehearsal 时，应创建新 operation/version 并重新盘点；需要 production 执行时，必须进入 Issue #165 R3，刷新 production backup/manifest，重新生成 production-specific runner，并再次取得 destructive confirmation。R2 文件不得直接改成 production ref 后复用。

Supabase 官方逻辑备份/恢复流程见 [Database Backups](https://supabase.com/docs/guides/platform/backups) 与 [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)。

## Issue #165 / R3A

- `reservation_reset_r3a_backup_writer.mjs`：只接受 header/ciphertext/footer 的 repo-external exclusive writer；拒绝明文/rows 字段和仓库内路径。
- `reservation_reset_r3a_verify_backup.mjs`：在 PGlite + pgcrypto 内存环境解密并验证 chunk/relation hash、Auth/Reservation 关系与 ledger；明文不落盘。
- `reservation_reset_r3b_production_draft.sql`：production-specific R3B review artifact，当前固定 `execution_authorized = false`。

R3A 已完成 production read-only manifest、fresh encrypted backup 和 isolated recovery proof，但没有 production/Auth mutation。Production draft 冻结 15 个 preserve selectors / 206 rows 与 25 个 purge selectors / 4,327 rows；它不删除 `auth.*`，也不重置 sequence。任何 future R3B 执行都需要 fresh preflight、最终文件 hash review 和用户再次明确 destructive confirmation；Auth 必须在 database commit/postflight 后按独立 runbook 处理。

R3A/R3B 边界与恢复限制见 [`docs/reservation-migration/reservation-reset-r3a-production-preflight.md`](../../docs/reservation-migration/reservation-reset-r3a-production-preflight.md) 和 [`reservation-reset-r3b-auth-runbook.md`](../../docs/reservation-migration/reservation-reset-r3b-auth-runbook.md)。
