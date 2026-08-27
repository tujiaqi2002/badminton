# Reservation Phase 4C.1：Production migration 与 default-legacy 验证

> 关联 Issue：[#161](https://github.com/tujiaqi2002/badminton/issues/161)、[#162](https://github.com/tujiaqi2002/badminton/issues/162)
> 实现 PR：[#163](https://github.com/tujiaqi2002/badminton/pull/163)
> 生产证据 Draft PR：[#164](https://github.com/tujiaqi2002/badminton/pull/164)
> Merge commit：`a387a0a844084eb52a905db2fe92e161c231253b`
> 当前状态：production migrations 50–51 已安装并通过 postflight；production profile selector 仍为 `legacy`。

## 1. 本次授权边界

用户从明确说明“Ready/merge 会触发 production migrations 50–51，后续 canonical profile selector 是独立门禁”的状态回复继续。本次授权因此只包含：

- fresh production read-only preflight；
- PR #163 Ready / merge；
- protected Supabase integration 安装 migrations 50–51；
- default-legacy Pages deployment；
- production read-only database、ACL、advisor、API-log 与 browser smoke postflight。

本次不包含 production canonical profile selector、真实资料写入、移动、改时长、取消、付款、计价、merge/split、客户写入、Realtime 变化或 legacy decommission。

## 2. Fresh production preflight

合并前 production project `ldbtrouofmqmnkyxiewk` 为 `ACTIVE_HEALTHY` / PostgreSQL 17.6.1。Migration history 精确为 49，最新 `20260826181644_reservation_phase_4b3_order_search`；staging 为 51，唯一 production-pending 文件是：

- `20260827084719_reservation_phase_4c1_profile_mutation.sql`
- `20260827090512_reservation_phase_4c1_party_lineage.sql`

分支相对 `origin/main` 为 0 behind / 3 ahead，PR merge state CLEAN，最终-head CI green。Read-only SQL 验证：

- Phase 3B `clean`，17 public writer entries、0 direct public booking writer、7 FORCE RLS tables；
- Phase 4A contract verified，192 bookings / memberships、123 Reservations、135 Sessions、131 Parties，全部 mismatch 为 0；
- Phase 4C.1 public/private functions 均为 0，证明尚未提前安装；
- incomplete operations 与 profile operations 均为 0；
- Realtime publication 只有 `public.court_slots`；
- advisors 为 48 security（2 INFO / 46 WARN）与 60 performance INFO。

GitHub variables 中 schedule、selected-detail 与 order selectors 均为 exact canonical；`VITE_RESERVATION_PROFILE_WRITE_SOURCE` 不存在，因此 workflow 会把 profile writer 固定回退到 `legacy`。

## 3. Merge 与自动部署

PR #163 于 2026-08-27 09:36:33 UTC 合并为 `a387a0a844084eb52a905db2fe92e161c231253b`。Protected Supabase check 于 09:37:20 UTC success，并把 production 从 49 原子推进到 51；migration list 与 staging 精确对齐。

GitHub Pages [run 33059345777](https://github.com/tujiaqi2002/badminton/actions/runs/33059345777) build/deploy 全绿。唯一 annotations 是若干 GitHub actions 内部 Node 20 target 被平台强制运行在 Node 24 的弃用提示，与应用 build 结果无关。

## 4. Production database postflight

`phase_4c1_profile_mutation.sql` diagnostic 在 read-only transaction 中返回：

- status `phase_4c1_profile_mutation_verified`；
- migration count 51，latest `20260827090512`；
- 1 个 public RPC、5 个 private helpers；
- Party lineage mode `bidirectional_transition_graph`；
- private client EXECUTE count 0；
- Phase 3B / Phase 4A contracts clean；
- profile operation count 0、profile audit count 0；
- incomplete operation count 0；
- Realtime 仍只有 `public.court_slots`。

真实 manager identity 在 read-only transaction 中通过 authorization 后到达 strict patch validation；随机 authenticated non-manager 在 argument/target validation 前收到安全的 `reservation_profile_manager_required` / SQLSTATE 42501。ACL 为 authenticated EXECUTE true、anon false、service_role false。

辅助 manager gate 的第一次查询引用了实际 schema 不存在的 `staff_members.is_active`，因此在调用 RPC 前停止；第二次断言把空 patch 的准确错误误写为 `patch_required`，而冻结 contract 实际返回 `reservation_profile_patch_scope_mismatch`。第三次按真实 schema 与 contract 重跑通过。三次均为 read-only transaction，没有业务写入或残留 operation/audit。

## 5. Advisor 变化

Postflight security advisor 为 49（2 INFO / 47 WARN），相对 preflight 只增加一条预期 finding：authenticated 可调用新的 public `SECURITY DEFINER` RPC。该入口有意使用 manager-auth-first、空 `search_path`、authenticated-only EXECUTE，且 private helpers 与核心表没有 client mutation grant。Remediation 规则见 [Supabase lint 0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)。

Performance advisor 保持 60 个 `unused_index` INFO，没有 Phase 4C.1-specific finding。没有为了消除 warning 而扩大 table grants、降低 manager authorization 或增加无证据索引。

## 6. Default-legacy frontend 证明

生产入口与新 asset `./assets/index-6CF1VAe2.js` 均 HTTP 200；asset 含 1 个 production project ref、0 个 staging ref 和 1 个新 profile RPC path。RPC path 存在只证明 capability 已发布，selector 仍由 build-time variable 决定。

真实馆长浏览器只读检查 future-30 canonical order 列表并定位一笔 Reservation：

- canonical selected-detail card 1；
- detail error 0；
- canonical “资料可编辑” label 0；
- canonical profile editor DOM 0；
- legacy “编辑资料”按钮 1。

因此 merge 没有意外切换 profile writer。没有点击保存、没有提交资料 mutation，也没有保存生产截图，避免将真实客户 PII 写入仓库。

合并后 API logs 共观察到 30 条 Auth/Data API/Realtime 请求；canonical schedule/order/detail RPC 全部 HTTP 200，`admin_update_reservation_profile` 请求为 0。数据库 profile operation/audit 计数也继续为 0。

## 7. 下一门禁与回退

Production 现在具备 canonical profile database capability，但 UI 仍使用 legacy editor。下一门禁是单独决定是否设置 exact `VITE_RESERVATION_PROFILE_WRITE_SOURCE=canonical` 并重新部署、观察真实馆长界面和 API logs。

在 selector cutover 前不需要数据库回退。若未来 canonical UI 出现问题，回退方式是删除该 variable 或设为 `legacy` 后重新运行 Pages；已应用的 additive migrations 50–51 保留，不覆盖或删除生产 migration history。
