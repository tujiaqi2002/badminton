# Reservation Phase 4B.1 production canonical cutover

> Issue: [#148](https://github.com/tujiaqi2002/badminton/issues/148)  
> Control PR: [#151](https://github.com/tujiaqi2002/badminton/pull/151)  
> 状态：2026-08-25 已完成，production schedule/capacity 保持 canonical

## 结论

生产馆长排期和容量监控现已从 legacy booking-row read source 切换到 Phase 4A canonical Court-allocation RPC。切换只改变这两个只读页面的数据来源；订单搜索、选中详情、操作与全部 writer 仍保持原边界，Phase 4B.2 与 legacy decommission 均未开始。

切换不需要数据库 migration 或 DB push。生产 Supabase 仍是 `ldbtrouofmqmnkyxiewk`，staging project ref 没有进入生产 artifact。回退只需把 GitHub Actions variable `VITE_RESERVATION_SCHEDULE_READ_SOURCE` 设为 `legacy` 或删除，再重新运行 Pages workflow；缺失值始终 fail closed 到 legacy。

## 授权与范围

用户在上一条明确门禁后要求继续，授权 Phase 4B.1 production canonical schedule/capacity cutover，并保留立即回退路径。明确排除：

- Phase 4B.2 订单、详情与 action adoption；
- Supabase migration、数据写入、权限、RLS、RPC 或 Realtime 变化；
- 支付、计价、Stripe 与客户 Auth 变化；
- 删除 legacy field、RPC、adapter 或 rollback path。

授权与 fresh preflight 记录在 [Issue #148 comment](https://github.com/tujiaqi2002/badminton/issues/148#issuecomment-5411785522)。

## 有序切换

### 1. 切换前门禁

完整 production Phase 4A 只读 diagnostic 通过：48 migrations，最新 `20260825091608`；192 legacy bookings、192 memberships/canonical allocations、123 current Reservations；Phase 3B/4A mismatch 全部为 0；writer inventory 为 17 public entries / 0 direct legacy writers / 17 private delegates / 3 wrappers；7 张 FORCE RLS 表，Realtime 只有 `public.court_slots`。

真实 authenticated non-manager subject 调 canonical schedule RPC 得到 `Manager access required`；anon 在 EXECUTE grant 层被拒绝。角色门禁在 read-only transaction 内执行并 rollback。

### 2. 先安装 fail-closed 部署控制

原 `deploy.yml` 没有注入 schedule source，设置 repo variable 不会生效。PR #151 增加唯一 build input：

```yaml
VITE_RESERVATION_SCHEDULE_READ_SOURCE: ${{ vars.VITE_RESERVATION_SCHEDULE_READ_SOURCE || 'legacy' }}
```

同时新增 regression test 固定唯一 selector 与 `legacy` fallback，并让 deployment workflow/test 文件变化触发 Reservation CI。内置 Node `v24.19.0` / pnpm `11.19.0` 的全量本地 suite 为 83 tests、82 pass、1 个既有 no-local-PostgreSQL concurrency skip、0 fail；lint/build 通过。最终 [CI run 32858874797](https://github.com/tujiaqi2002/badminton/actions/runs/32858874797) 在 PostgreSQL 16 下全绿，Supabase Preview 因无 migration 正常跳过。

PR #151 于 2026-08-25 14:22:23 UTC 合并为 `6157f7a23daeb5d5c9c14d2d8310b41d24b7fd6d`。

### 3. 先证明默认仍是 legacy

合并时 variable 仍不存在。[Pages run 32859078691](https://github.com/tujiaqi2002/badminton/actions/runs/32859078691) 成功部署 merge commit。线上 HTTP 200，仍加载 `assets/index-B_GCKKvu.js`：canonical allocation RPC 0 次、staging ref 0 次、production ref 1 次。这证明 workflow 控制本身不会提前切换。

### 4. 激活 canonical

2026-08-25 14:23:26 UTC 将唯一 repo variable 设为 exact `canonical`，并从同一 `main` commit 手动运行 workflow。[Pages run 32859184175](https://github.com/tujiaqi2002/badminton/actions/runs/32859184175) build/deploy 成功。线上改为 `assets/index-CvTu7GmI.js`：canonical allocation RPC 1 次、staging ref 0 次、production ref 1 次。

bundle 继续含 legacy bookings 代码是预期行为：订单搜索、详情、操作和 writer 不属于本阶段；它不再为 AdminSchedule/AdminCapacity 提供排期 rows。

## 真实生产观察

复用已认证馆长会话，只记录日期、数量、状态和错误计数，不保留客户姓名、联系方式、备注或 ID。

| 页面/范围 | 结果 |
| --- | --- |
| 排期 2026-08-17 | 5 court lanes，8 allocation cards，读取完成，无错误 |
| 排期 2026-08-24 | 5 court lanes，2 allocation cards，读取完成，无错误 |
| 排期 2026-08-31 | 5 court lanes，0 allocation cards，读取完成，无错误 |
| 容量 2026-08-24 周 | 7 天 × 14 rows，83 个当前可用 cells，剩余 4–5 courts，无错误 |
| 容量 2026-08-31 周 | 7 天 × 14 rows，98 个可用 cells，剩余 4–5 courts，无错误 |

浏览器 console error/warn 为 0。切换开始时间之后的 Supabase API logs 记录 8 次 `POST /rpc/admin_list_reservation_allocations` 与 1 次 CORS `OPTIONS`，全部 HTTP 200。

观察后的完整 production 只读 diagnostic 再次通过：48 migrations、192 bookings/memberships、192 canonical allocations、123 Reservations、Phase 3B/4A mismatch 全 0、17/0/17/3 writer boundary、7 FORCE RLS tables 与 `public.court_slots`-only Realtime。

## 当前运行与回退契约

- 当前 variable：`VITE_RESERVATION_SCHEDULE_READ_SOURCE=canonical`。
- 当前 canonical consumer：馆长 AdminSchedule 与 AdminCapacity。
- 仍为 legacy/既有 contract：订单搜索、选中详情、移动/取消/付款/关系 action 和全部 writer。
- 应急回退：把 variable 改为 exact `legacy`，或删除 variable，然后重新运行 `deploy.yml`；验证 live bundle 的 canonical RPC 为 0。
- 不需要 DB rollback；canonical 与 legacy projection 继续由 Phase 3B writer 原子维护。
- Phase 4B.2 必须另行设计、确认和验证。Phase 5 decommission 必须等稳定观察窗口、Phase 4B.2 完成和独立授权，不能因本次切换自动开始。

---

# English version

## Outcome

The production manager schedule and capacity monitor now read from the Phase 4A canonical Court-allocation RPC instead of the legacy booking-row schedule source. This cutover changes only those two read-only surfaces. Order search, selected detail, actions, and every writer retain their existing boundaries; Phase 4B.2 and legacy decommission have not started.

No database migration or DB push was required. Production still targets Supabase project `ldbtrouofmqmnkyxiewk`, and the staging project ref is absent from the production artifact. Operational rollback is setting `VITE_RESERVATION_SCHEDULE_READ_SOURCE` to `legacy`, or deleting it, and rebuilding Pages. A missing value always fails closed to legacy.

## Authorization and boundary

After the preceding gate explicitly named the production canonical schedule/capacity cutover, the user asked to continue. The authorization includes a reversible Phase 4B.1 cutover and excludes Phase 4B.2 order/detail/action adoption, every Supabase migration or write, permission/RLS/RPC/Realtime changes, payment/pricing/Stripe/customer-Auth behavior, and deletion of any legacy field, RPC, adapter, or rollback path. The authorization and fresh preflight are recorded in the linked Issue #148 comment.

## Ordered cutover

The fresh Phase 4A read-only diagnostic passed with 48 migrations ending at `20260825091608`, 192 legacy bookings, 192 canonical memberships/allocations, 123 current Reservations, zero Phase 3B/4A mismatch, the activated 17/0/17/3 writer inventory, seven FORCE RLS tables, and `public.court_slots`-only Realtime. A real authenticated non-manager was rejected by the manager check, while anon was denied at the EXECUTE boundary. The role check ran in a read-only transaction and rolled back.

The existing deploy workflow did not inject the schedule selector, so a repository variable alone could neither activate nor roll back the source. PR #151 added exactly one input with a `legacy` fallback, plus a regression test that pins the unique selector and fail-closed default. Local bundled Node `v24.19.0` and pnpm `11.19.0` produced 82 passes, one existing no-local-PostgreSQL concurrency skip, and zero failures across 83 tests; lint and build passed. CI run 32858874797 was green under PostgreSQL 16, and Supabase Preview correctly skipped because there was no migration. PR #151 merged at 2026-08-25 14:22:23 UTC as `6157f7a23daeb5d5c9c14d2d8310b41d24b7fd6d`.

The variable remained absent for the first deployment. Pages run 32859078691 successfully deployed the merge commit, and the HTTP-200 site still loaded `assets/index-B_GCKKvu.js` with zero canonical RPC occurrences, zero staging refs, and one production ref. This proved that installing the control did not switch production early.

At 14:23:26 UTC, the single repository variable was set to exact `canonical`, and Pages run 32859184175 rebuilt the same `main` commit successfully. The live site changed to `assets/index-CvTu7GmI.js`, with one canonical allocation-RPC occurrence, zero staging refs, and one production ref. Legacy bookings code remains in the bundle by design because order search, detail, actions, and writers are outside this phase; it no longer supplies AdminSchedule/AdminCapacity rows.

## Production observation

An authenticated manager session loaded schedule dates August 17, August 24, and August 31. Each rendered five Court lanes with 8, 2, and 0 allocation cards respectively, completed loading, and showed no read error. Capacity loaded seven days by fourteen rows for the August 24 and August 31 weeks, with 83 and 98 currently enabled cells and aggregate availability of four to five Courts. Browser error/warn logs remained zero.

Since cutover, Supabase API logs contain eight HTTP-200 POST calls to `admin_list_reservation_allocations` plus one HTTP-200 CORS OPTIONS request. The post-observation Phase 4A diagnostic again passed with 48 migrations, 192 bookings/memberships and canonical allocations, 123 Reservations, zero mismatch, the 17/0/17/3 writer boundary, seven FORCE RLS tables, and `public.court_slots`-only Realtime. No customer PII or identifiers were retained in the evidence.

## Active contract and rollback

Production currently keeps `VITE_RESERVATION_SCHEDULE_READ_SOURCE=canonical`. Only AdminSchedule and AdminCapacity consume it. Order search, selected detail, move/cancel/payment/relationship actions, and all writers remain on their existing contracts.

Emergency rollback is setting the variable to exact `legacy`, or deleting it, and rerunning `deploy.yml`; the live bundle must then contain zero canonical schedule-RPC occurrences. No DB rollback is needed because Phase 3B writers continue to maintain both canonical facts and the legacy projection atomically. Phase 4B.2 requires a separate design, confirmation, and verification. Phase 5 decommission remains blocked on a stable observation window, Phase 4B.2 completion, and independent authorization.
