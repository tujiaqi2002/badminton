# Reservation Phase 4B.3：default-legacy 生产发布验证

> Issue：[#157](https://github.com/tujiaqi2002/badminton/issues/157)
> PR：[#158](https://github.com/tujiaqi2002/badminton/pull/158)
> Merge commit：`58d9d59cab0eebd6f0591834217e744ecb2343f1`
> 结论：canonical Reservation order-search RPC 已安全进入 production；生产订单 UI 仍使用 legacy source，未执行 canonical selector cutover。

## 1. 授权与边界

Fresh production preflight 完成后，门禁明确说明：继续会把 PR #158 转为 Ready 并合并，Supabase integration 会自动应用 migration 49；production order selector 仍保持 `legacy`。用户随后回复继续，因此授权范围精确包含：

- 合并 PR #158；
- 允许 protected Supabase integration 应用 `20260826181644_reservation_phase_4b3_order_search`；
- 允许 Pages 使用当前变量 build/deploy；
- 执行只读数据库 postflight 与真实馆长 default-legacy 页面验证。

授权不包含设置 `VITE_RESERVATION_ORDER_READ_SOURCE=canonical`、聚合订单的移动/取消/付款/关联 writer scope、客户读取、计价/Stripe、Auth、Realtime 或 legacy decommission。

## 2. 合并前门禁

- PR head `3284bc5b7ea915b86de74e19fef3a20b2f103af6`，相对 `main` 为 0 behind / 3 ahead，CLEAN / MERGEABLE；
- latest [CI run 33015037676](https://github.com/tujiaqi2002/badminton/actions/runs/33015037676) 全绿；
- production remote history 为 48、remote-only 0、local-only 仅 `20260826181644`；
- `db push --dry-run --skip-vault` 只列 migration 49；
- Phase 3B/4A diagnostic、non-manager gate、ACL、Realtime 与 17/0/17/3 writer boundary clean；
- candidate `EXPLAIN (ANALYZE, BUFFERS)` 为 9.335 ms、95 shared hits、0 shared read/temp，并使用现有 Session/membership indexes；
- repo variable `VITE_RESERVATION_ORDER_READ_SOURCE` 缺失，workflow 明确 fallback 为 `legacy`。

## 3. 合并、数据库与 Pages

PR #158 于 2026-08-26 21:26:04 UTC 合并。Supabase check 从 21:26:40 到 21:26:47 UTC 成功完成；remote migration history 随后精确为 49，最新 `20260826181644`，没有 local-only 项。

Pages [run 33015339219](https://github.com/tujiaqi2002/badminton/actions/runs/33015339219) 从相同 merge commit 完成 build 与 deploy：build 于 21:26:31 UTC 成功，deploy 于 21:26:43 UTC 成功。线上页面加载 `assets/index-D2_P4uCy.js`：

- production project ref：1；
- staging project ref：0；
- `admin_search_bookings`：1；
- `admin_search_reservations`：0。

这证明本次 bundle 仍编译为 legacy order source，而不是仅依赖变量读取结果推断。

## 4. 上线后数据库 postflight

Postflight 全部在 read-only transaction 中执行并 rollback：

- migration count 49，latest `20260826181644`；
- Phase 4B.3 function definition 包含 all-Party、`party_count` 与 compound cursor contract；
- `SECURITY INVOKER`、空 `search_path`；authenticated=true、anon=false、service_role=false；
- production manager RPC 返回合法 schema version 1 envelope；authenticated non-manager 被 `Manager access required` 拒绝；
- 192 bookings、192 memberships、123 Reservations、135 Sessions、131 Parties，Phase 3B/4A predecessor assertions clean；
- Realtime 仍只有 `public.court_slots`；
- advisors 为 48 security（2 INFO / 46 WARN）与 60 performance INFO，均为既有 baseline，Phase 4B.3-specific finding 为 0。

Migration 只替换函数定义与重申精确 ACL，没有修改业务数据、RLS、writer、Auth、付款/计价事实或 Realtime publication。

## 5. 真实 production default-legacy 验证

已登录馆长打开 production future-30 订单范围：

- legacy Court rows：2；
- “更改预订”入口：2；
- “取消预订”入口：2；
- canonical “在排期中查看”入口：0；
- horizontal overflow：false；
- browser console error/warn：0。

这些运行时事实与 asset 中 legacy RPC 1 / canonical RPC 0 一致，证明 migration 49 提供数据库能力但没有偷偷切换生产 UI。

本次不保存 production screenshot，以避免把真实客户资料写入仓库或 Issue。Phase 4B.3 的 Before/After 视觉证据继续使用 [`docs/screenshots/issue-157`](../screenshots/issue-157) 中的 `badminton_stage` 合成数据。

## 6. 当前状态与下一门禁

Production 现在具有 canonical Reservation order-search RPC，但 order UI 仍为 legacy。下一步必须单独完成 selector cutover preflight，并取得明确授权后，才可设置 `VITE_RESERVATION_ORDER_READ_SOURCE=canonical` 和执行有限观察。

聚合订单上的付款、移动、取消、关联 action scope 以及 legacy decommission 仍是后续独立阶段。

---

# Full English

## Reservation Phase 4B.3: default-legacy production deployment verification

Issue [#157](https://github.com/tujiaqi2002/badminton/issues/157) and PR [#158](https://github.com/tujiaqi2002/badminton/pull/158) delivered the canonical Reservation order-search RPC to production as merge commit `58d9d59cab0eebd6f0591834217e744ecb2343f1`. The production order UI remains on the legacy source; no canonical selector cutover occurred.

### Authorization and boundary

After the fresh production preflight, the gate explicitly stated that continuing would mark PR #158 ready and merge it, causing the Supabase integration to apply migration 49 while the production order selector remained `legacy`. The user then authorized continuing.

The authorization covered merging PR #158, allowing the protected integration to apply `20260826181644_reservation_phase_4b3_order_search`, allowing Pages to build/deploy with current variables, and running read-only database and authenticated-manager default-legacy verification. It excluded setting `VITE_RESERVATION_ORDER_READ_SOURCE=canonical`, aggregate move/cancel/payment/relationship writers, customer reads, pricing/Stripe, Auth, Realtime changes, and legacy decommission.

### Pre-merge gate

The PR ended at `3284bc5b7ea915b86de74e19fef3a20b2f103af6`, zero commits behind and three ahead of `main`, CLEAN/MERGEABLE, with [CI run 33015037676](https://github.com/tujiaqi2002/badminton/actions/runs/33015037676) green. Production had 48 remote migrations, zero remote-only drift, and only `20260826181644` local-only; the dry run listed only migration 49. Phase 3B/4A diagnostics, non-manager denial, ACL, Realtime, and the 17/0/17/3 writer boundary were clean. The candidate plan completed in 9.335 ms with 95 shared hits, zero shared reads/temp blocks, and existing Session/membership indexes in use. The order-source repository variable was absent and therefore resolved through the workflow's explicit legacy fallback.

### Merge, database, and Pages

PR #158 merged at 2026-08-26 21:26:04 UTC. The Supabase check succeeded from 21:26:40 to 21:26:47 UTC, after which production had exactly 49 migrations with `20260826181644` latest and no local-only item.

Pages [run 33015339219](https://github.com/tujiaqi2002/badminton/actions/runs/33015339219) built and deployed the same commit successfully. The live page loaded `assets/index-D2_P4uCy.js`, containing one production project ref, zero staging refs, one `admin_search_bookings` occurrence, and zero `admin_search_reservations` occurrences. The shipped artifact itself therefore confirms the legacy order source.

### Post-deployment database verification

The postflight ran entirely in a read-only transaction and rolled back. It confirmed migration 49, the all-Party/`party_count`/compound-cursor function definition, security-invoker empty-search-path shape, authenticated-only ACL, a valid manager schema-version-1 envelope, and authenticated non-manager denial. The 192 bookings, 192 memberships, 123 Reservations, 135 Sessions, 131 Parties, clean Phase 3B/4A assertions, and `public.court_slots`-only Realtime boundary were unchanged. Advisors remained at 48 security items and 60 performance INFO items, with zero Phase 4B.3-specific finding.

The migration replaced only the function definition and reasserted its exact ACL. It changed no business row, RLS, writer, Auth, payment/pricing fact, or Realtime publication.

### Live default-legacy proof

An authenticated production manager opened the future-30 order range. It rendered two legacy Court rows, two change actions, two cancellation actions, zero canonical “View in schedule” actions, no horizontal overflow, and zero browser console errors/warnings. These runtime facts match the artifact's one legacy RPC and zero canonical RPC occurrences.

No production screenshot was retained because it could persist real customer information. Phase 4B.3 Before/After evidence uses only synthetic `badminton_stage` data in [`docs/screenshots/issue-157`](../screenshots/issue-157).

### Current state and next gate

Production now has the canonical Reservation order-search RPC while the order UI remains legacy. Switching `VITE_RESERVATION_ORDER_READ_SOURCE` to exact `canonical` requires a separate production preflight, explicit authorization, and bounded observation. Aggregate payment/move/cancel/relationship action scopes and legacy decommission remain later independent phases.
