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
