# 独立 staging 初始化

本目录用于初始化独立 Supabase 项目 `badminton_stage`（project ref：`vcoujmzsgdboidndtzzg`）。它不是生产部署脚本，也不得对生产 project ref `ldbtrouofmqmnkyxiewk` 执行。

## 设计

独立项目没有早于仓库首个 migration 的基础 schema，因此 staging 初始化按以下顺序进行：

1. 从首个 migration 之前的 Git 历史恢复基础 schema。
2. 原样执行 migration 1–37。
3. 使用 `generate_synthetic_legacy_fixture.mjs bookings` 写入 192 条确定性虚构 booking；所有邮箱都使用保留域名 `example.invalid`。
4. 执行 Phase 1 schema migration。
5. 使用 `generate_synthetic_legacy_fixture.mjs audit` 写入 6 条确定性付款审计证据。
6. 从 staging 读取四个 Phase 2 指纹，仅将 Phase 2 migration 内冻结的生产指纹替换为 staging 合成指纹后执行。
7. 原样执行其余 migrations，并把 Supabase migration history 的 version/name 对齐仓库文件名。
8. 运行 Phase 2、Phase 3A、Phase 3B diagnostics、RLS/grant 检查、advisors 和并发验证。

`session_replication_role = replica` 只在 fixture 插入事务中临时使用，目的是让合成数据精确模拟 migration 前的历史行；事务提交前恢复为 `origin`。任何已存在 booking 都会触发 guard 并终止 fixture。

## 本地检查

```text
node --test supabase/tests/staging_fixture.test.mjs
node supabase/staging/generate_synthetic_legacy_fixture.mjs summary
```

---

# Independent staging initialization (English)

This directory initializes the independent Supabase project `badminton_stage` (project ref `vcoujmzsgdboidndtzzg`). It is not a production deployment script and must never be run against the production project ref `ldbtrouofmqmnkyxiewk`.

## Design

The independent project does not contain the base schema that predates the repository's first migration. Staging is therefore initialized in this order:

1. Restore the base schema from Git immediately before the first migration.
2. Apply migrations 1–37 unchanged.
3. Insert 192 deterministic fictional legacy bookings with `generate_synthetic_legacy_fixture.mjs bookings`; every email uses the reserved `example.invalid` domain.
4. Apply the Phase 1 schema migration.
5. Insert six deterministic payment-audit evidence rows with `generate_synthetic_legacy_fixture.mjs audit`.
6. Read the four Phase 2 fingerprints from staging, replace only the frozen production fingerprints in the Phase 2 migration, and apply the specialized migration.
7. Apply all remaining migrations unchanged and align Supabase migration-history versions/names with the repository filenames.
8. Run the Phase 2, Phase 3A, and Phase 3B diagnostics, RLS/grant checks, advisors, and concurrency verification.

`session_replication_role = replica` is scoped to the fixture transaction so the synthetic rows accurately represent pre-migration history. It is restored to `origin` before commit. A guard aborts the fixture if any booking already exists.

## Local checks

```text
node --test supabase/tests/staging_fixture.test.mjs
node supabase/staging/generate_synthetic_legacy_fixture.mjs summary
```
