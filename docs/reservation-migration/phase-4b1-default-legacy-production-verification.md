# Reservation Phase 4B.1：default-legacy 生产发布验证

> Issue：[#148](https://github.com/tujiaqi2002/badminton/issues/148)
> PR：[#149](https://github.com/tujiaqi2002/badminton/pull/149)
> 结论：Phase 4B.1 frontend foundation 已进入 `main` 并成功部署，但生产仍使用 legacy schedule source。没有 canonical production cutover、数据库变更、Phase 4B.2 或 legacy decommission。

## 1. 授权与边界

用户在 Draft PR #149 验证完成后同意继续。执行前按 Issue #148 的既定顺序，将授权解释并记录为：

- 允许把 PR #149 标记 Ready、合并到 `main`；
- 允许 GitHub Pages 使用缺省配置完成 default-legacy build/deploy；
- 不允许设置 `VITE_RESERVATION_SCHEDULE_READ_SOURCE=canonical`；
- 不开始 Phase 4B.2 selected detail/action adoption；
- 不修改 Supabase schema、RLS、grant、RPC、业务数据、Realtime、Stripe 或客户 Auth；
- 不删除任何 legacy read、field、RPC、adapter 或 rollback path。

## 2. 合并与 CI

Fresh preflight 确认 PR 与 `main` 0 behind、mergeable/CLEAN、没有 migration diff，最终 CI 全绿，Actions 中不存在 schedule-source variable，`deploy.yml` 也不注入该变量。缺失值按实现 fail closed 为 legacy。

PR #149 于 2026-08-25 13:13:04 UTC 合并，merge commit 为 `560ecdc2d738b6bc42d03421e781ba73adac249c`。Merge-head CI [run 32851114060](https://github.com/tujiaqi2002/badminton/actions/runs/32851114060) 在固定 Node `v22.23.2`、pnpm `11.16.0` 与 PostgreSQL 16 下通过：

- Reservation migration/concurrency tests：33/33；
- read adapters：19/19；
- lint/build：通过；
- Supabase Preview：因没有 migration 按预期跳过。

## 3. Pages 与线上 artifact

Pages [run 32852015723](https://github.com/tujiaqi2002/badminton/actions/runs/32852015723) 从同一 merge commit 完成 build 与 deploy，结论为 success。线上首页返回 HTTP 200，并加载：

```text
assets/index-B_GCKKvu.js
```

对实际线上 bundle 的精确计数：

- `admin_list_reservation_allocations`：0；
- staging project ref：0；
- `VITE_RESERVATION_SCHEDULE_READ_SOURCE`：0；
- production project ref：1。

这证明新 frontend foundation 已随 `main` 发布，但缺省 legacy 构建把 canonical schedule branch 与 staging 配置裁剪掉。实际线上页面正常渲染，script source 与 HTTP 检查一致，console error/warn 为 0。验证没有触发写入，也没有在记录中保留客户资料。

## 4. 上线后生产数据库核验

上线后重新执行 `phase_4a_manager_read_contract.sql` 的只读事务，结果仍为：

- 48 migrations，latest `20260825091608`；
- 192 legacy bookings / 192 effective memberships；
- 192 canonical allocations / 123 Reservations；
- Phase 3B shadow、Session projection、payment 与 incomplete-operation mismatch 全部为 0；
- Phase 4A read mismatch 为 0；
- writer boundary 为 17 public entries / 0 public direct legacy writers / 17 private delegates / 3 wrappers；
- 7 张 FORCE RLS 表；
- Realtime 仍只有 `public.court_slots`。

本次部署没有 pending migration，Supabase migration history、权限、writer、数据和 publication 均未变化。

## 5. 当前状态与下一门禁

Phase 4B.1 当前状态是：source code 已进入 `main`、canonical staging 已验证、production default 仍是 legacy；当前线上 artifact 按设计不包含 canonical path。这不是生产 canonical cutover。

下一步必须另行定义并取得授权，才能把 production selector 切为 exact `canonical`，并在有限观察窗口验证真实 schedule/capacity、错误边界、回退和 production RPC 证据。Phase 4B.2 detail/actions 与 Phase 5 decommission 仍是更后的独立阶段。

---

# Full English

## Reservation Phase 4B.1: default-legacy production deployment verification

Issue [#148](https://github.com/tujiaqi2002/badminton/issues/148) and PR [#149](https://github.com/tujiaqi2002/badminton/pull/149) delivered the Phase 4B.1 frontend foundation to `main` and GitHub Pages. Production still uses the legacy schedule source. No canonical production cutover, database change, Phase 4B.2 adoption, or legacy decommission occurred.

### Authorization and boundary

After the Draft PR completed validation, the user approved continuing. Under the ordered Issue #148 gate, that approval was explicitly recorded as authorization to mark PR #149 ready, merge it, and allow a default-legacy Pages build/deployment. It did not authorize setting `VITE_RESERVATION_SCHEDULE_READ_SOURCE=canonical`, starting selected detail/action adoption, changing any Supabase schema, permission, RPC, data, Realtime, Stripe, or customer Auth behavior, or removing a legacy read/field/RPC/adapter/rollback path.

### Merge, CI, and Pages

The fresh preflight showed the PR 0 behind `main`, mergeable/CLEAN, with no migration diff and green final CI. GitHub Actions contained no schedule-source variable, and `deploy.yml` did not inject one, so the missing value resolved to legacy.

PR #149 merged at 2026-08-25 13:13:04 UTC as `560ecdc2d738b6bc42d03421e781ba73adac249c`. Merge-head [CI run 32851114060](https://github.com/tujiaqi2002/badminton/actions/runs/32851114060) passed 33/33 Reservation migration/concurrency tests, 19/19 read-adapter tests, lint, and build under Node `v22.23.2`, pnpm `11.16.0`, and PostgreSQL 16. Supabase Preview correctly skipped because the PR contained no migration.

Pages [run 32852015723](https://github.com/tujiaqi2002/badminton/actions/runs/32852015723) successfully built and deployed the same merge commit. The live page returned HTTP 200 and loaded `assets/index-B_GCKKvu.js`. The exact live bundle contained zero `admin_list_reservation_allocations` occurrences, zero staging project-reference occurrences, zero `VITE_RESERVATION_SCHEDULE_READ_SOURCE` occurrences, and one production project-reference occurrence. The real page rendered normally with the same script source and no console errors or warnings. The verification performed no write and retained no customer details in the evidence.

### Post-deployment database verification

A fresh read-only `phase_4a_manager_read_contract.sql` transaction still reported 48 migrations ending at `20260825091608`, 192 legacy bookings and effective memberships, 192 canonical allocations, 123 Reservations, zero Phase 3B shadow/Session/payment/incomplete-operation mismatch, and zero Phase 4A read mismatch. The writer boundary remained 17 public entries, zero public direct legacy writers, 17 private delegates, and three wrappers. Seven tables still used FORCE RLS, and Realtime still published only `public.court_slots`.

No pending migration existed, so the deployment changed no Supabase migration history, permission, writer, business data, or publication.

### Current state and next gate

Phase 4B.1 source code is in `main`, its canonical staging path is verified, and the production default remains legacy. The current live artifact intentionally omits the canonical path; this is not a canonical production cutover.

Changing the production selector to exact `canonical` requires a new explicit gate and a bounded observation of real schedule/capacity behavior, failure handling, rollback, and production RPC evidence. Phase 4B.2 selected detail/actions and Phase 5 decommission remain later independent phases.
