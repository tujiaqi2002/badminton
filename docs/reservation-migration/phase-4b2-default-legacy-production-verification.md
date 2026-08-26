# Reservation Phase 4B.2：default-legacy 生产发布验证

> Issue：[#153](https://github.com/tujiaqi2002/badminton/issues/153)
> PR：[#154](https://github.com/tujiaqi2002/badminton/pull/154)
> Merge commit：`92c892c28bf5458f62f84bc977007b872f3e1014`
> 结论：Phase 4B.2 只读 canonical selected-detail foundation 已进入 `main` 并成功部署；生产详情仍为 legacy，未执行 canonical detail cutover。

## 1. 授权与边界

用户在 PR #154 完成 staging、non-manager、自动测试与 CI 后，先要求继续评审；fresh review 证明 0 behind、mergeable/CLEAN、没有 migration diff、没有秘密或 staging 配置进入提交。随后在明确说明“合并 #154 并验证 default-legacy Pages deployment，不包含 production canonical detail 切换”后，用户再次回复继续。

本次授权只包含：

- 将 PR #154 标记 Ready 并合并到 `main`；
- 允许 GitHub Pages 使用当前 Actions variables build/deploy；
- 验证 production selected-detail selector 仍 fail closed 为 legacy；
- 执行只读 production browser、API log 与数据库 diagnostic。

授权不包含设置 `VITE_RESERVATION_SELECTED_DETAIL_READ_SOURCE=canonical`、任何 migration/DB push、writer/action scope、付款/计价、Auth、Realtime、Phase 4C 或 legacy decommission。

## 2. 合并前门禁

合并前核对结果：

- PR 与 `main`：0 behind，CLEAN / MERGEABLE；
- 最终 PR head `eec76e9978db1b06c42fd3c1a0613e0d05bf997b`；
- [CI run 32955008627](https://github.com/tujiaqi2002/badminton/actions/runs/32955008627)：PostgreSQL integration、Reservation migration/concurrency、30/30 read adapters、lint 与 build 全绿；
- `supabase/migrations` diff：0；
- tracked staging env / secret pattern：0；
- Actions variable：schedule 为 exact `canonical`，selected detail 缺失并按 workflow fallback 为 `legacy`。

生产只读 preflight 返回：48 migrations，latest `20260825091608`；192 bookings / 192 memberships；192 canonical allocations / 123 Reservations；Phase 3B shadow、projection、payment、incomplete-operation mismatch 与 Phase 4A mismatch 全部为 0；17 public entries / 0 direct legacy writers / 17 private delegates / 3 wrappers；7 张 FORCE RLS 表；Realtime 只有 `public.court_slots`。

## 3. 合并与 Pages

PR #154 于 2026-08-26 10:19:28 UTC 合并，merge commit 为 `92c892c28bf5458f62f84bc977007b872f3e1014`。

Pages [run 32957663853](https://github.com/tujiaqi2002/badminton/actions/runs/32957663853) 从该 commit 完成 build 与 deploy，所有 job 成功。唯一 annotation 是 GitHub runner 对若干 action 内部 Node 20 target 的平台弃用提示，不是应用或测试失败。

线上首页返回 HTTP 200，并加载：

```text
assets/index-wknub-uV.js
```

实际 asset 中 production project ref 为 1、staging project ref 为 0。Selected-detail RPC 与 canonical panel 代码随 foundation 存在于 bundle，但运行时 selector 仍由缺失 variable 解析为 legacy；是否启用不能仅靠字符串存在性判断，因此使用真实馆长选择和 API logs 完成运行时证明。

## 4. 真实 production default-legacy 验证

已登录馆长页面成功加载 production canonical schedule。选择 2026-08-24 的两条 allocation 后，页面事实为：

- schedule booking cards：2；
- selected card：1；
- canonical detail panel：0；
- legacy notes panel：1；
- schedule region：1；
- document width / scroll width：1265 / 1265；
- browser error/warn：0。

选择前后的 Supabase API logs 中 `admin_get_reservation_detail` 均为 0；同一窗口的 `admin_list_reservation_allocations` POST 返回 HTTP 200。这证明 production schedule 继续 canonical，而 selected detail 仍严格保持 legacy，没有因合并代码而自动切换。

本次不保存 production screenshot，以避免把真实馆务客户资料写入仓库或 Issue。Phase 4B.2 的 Before/After 视觉证据已使用 `badminton_stage` 合成数据保存于 [`docs/screenshots/issue-153`](../screenshots/issue-153)。

## 5. 上线后数据库核验

部署后再次执行相同只读事务，结果与 preflight 完全一致：

- 48 migrations，latest `20260825091608`；
- 192 bookings / 192 memberships / 192 allocations / 123 Reservations；
- Phase 3B 与 Phase 4A mismatch 全部为 0；
- writer boundary 17 / 0 / 17 / 3；
- 7 张 FORCE RLS 表；
- Realtime 只有 `public.court_slots`。

本次没有 DB push、migration history、RLS/RPC grant、writer、业务数据、Auth 或 publication 变化。

## 6. 当前状态与下一门禁

Phase 4B.2 foundation 已进入 `main`，staging canonical detail 已验证，生产当前继续 legacy detail。下一步 production selected-detail cutover 必须另行明确授权，并在有限观察窗口验证真实 manager/non-manager 行为、detail RPC、错误边界与 selector rollback。

Phase 4C writer/action scope 与 legacy decommission 仍是后续独立门禁。

---

# Full English

## Reservation Phase 4B.2: default-legacy production deployment verification

Issue [#153](https://github.com/tujiaqi2002/badminton/issues/153) and PR [#154](https://github.com/tujiaqi2002/badminton/pull/154) delivered the read-only canonical selected-detail foundation to `main`. Production detail remains legacy; no canonical-detail cutover occurred.

### Authorization and boundary

After staging, non-manager, automated, and CI checks completed, the user first authorized the PR review. The fresh review showed zero commits behind `main`, a CLEAN/MERGEABLE PR, no migration diff, and no tracked secret or staging configuration. The next gate explicitly stated that continuing would merge PR #154 and verify a default-legacy Pages deployment without switching production canonical detail. The user then authorized continuing.

The authorization covered marking PR #154 ready, merging it, allowing the current Actions variables to build/deploy Pages, proving that the selected-detail selector remained fail-closed to legacy, and performing read-only production browser, API-log, and database diagnostics. It excluded setting `VITE_RESERVATION_SELECTED_DETAIL_READ_SOURCE=canonical`, any migration or DB push, writer/action scope, payment/pricing, Auth, Realtime, Phase 4C, or legacy decommission.

### Pre-merge gate

The PR was zero behind, CLEAN/MERGEABLE, and ended at `eec76e9978db1b06c42fd3c1a0613e0d05bf997b`. [CI run 32955008627](https://github.com/tujiaqi2002/badminton/actions/runs/32955008627) passed PostgreSQL integration, Reservation migration/concurrency tests, 30/30 read adapters, lint, and build. The migration diff, tracked staging environment, and secret-pattern scan were all empty. The schedule variable remained exact canonical, while the selected-detail variable was absent and therefore resolved through the workflow's legacy fallback.

The production read-only preflight reported 48 migrations ending at `20260825091608`, 192 bookings and effective memberships, 192 canonical allocations, 123 Reservations, zero Phase 3B shadow/projection/payment/incomplete-operation mismatch, zero Phase 4A mismatch, the 17/0/17/3 writer boundary, seven FORCE RLS tables, and only `public.court_slots` in Realtime.

### Merge and Pages

PR #154 merged at 2026-08-26 10:19:28 UTC as `92c892c28bf5458f62f84bc977007b872f3e1014`. Pages [run 32957663853](https://github.com/tujiaqi2002/badminton/actions/runs/32957663853) successfully built and deployed the same commit. Its only annotations were GitHub runner platform notices about internal Node 20 targets in upstream actions, not application or test failures.

The live page returned HTTP 200 and loaded `assets/index-wknub-uV.js`, with one production project reference and zero staging project references. The selected-detail RPC and panel implementation are present as the shipped foundation, so string presence alone cannot prove runtime enablement; the live manager selection and API logs below provide that proof.

### Live default-legacy proof

An authenticated production manager loaded the canonical schedule and selected two allocations from 2026-08-24. The visible runtime contained two booking cards, one selected card, zero canonical-detail panels, one legacy-notes panel, one schedule region, equal document and scroll widths of 1265, and zero browser errors or warnings.

Supabase API logs before and after selection contained zero `admin_get_reservation_detail` calls, while `admin_list_reservation_allocations` returned HTTP 200. Production schedule therefore remains canonical while selected detail remains strictly legacy.

No production screenshot was retained because doing so could persist real customer information in the repository or Issue. Phase 4B.2 Before/After evidence uses only synthetic `badminton_stage` data in [`docs/screenshots/issue-153`](../screenshots/issue-153).

### Post-deployment database verification

The same read-only transaction after deployment returned an identical 48-migration, 192/192, 192-allocation, 123-Reservation, zero-mismatch, 17/0/17/3, seven-FORCE-RLS, `court_slots`-only result. This deployment changed no migration history, DB state, RLS/RPC grant, writer, business data, Auth rule, or Realtime publication.

### Current state and next gate

The Phase 4B.2 foundation is in `main`, its canonical detail path is verified in staging, and production detail remains legacy. A production selected-detail cutover requires separate explicit authorization and a bounded observation of real manager/non-manager behavior, detail RPCs, failure handling, and selector rollback.

Phase 4C writer/action adoption and legacy decommission remain later independent gates.
