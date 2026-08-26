# Reservation Phase 4B.2：Canonical selected-detail read

> Issue：[#153](https://github.com/tujiaqi2002/badminton/issues/153)
> Draft PR：[#154](https://github.com/tujiaqi2002/badminton/pull/154)
> 分支：`codex/reservation-phase-4b2-selected-detail`
> 状态：实现、自动验证、manager/non-manager staging 浏览器证据与 Draft PR CI 已完成；等待评审。
> 数据库：无 migration、无 DB push、无数据写入。

## 1. 本阶段解决什么

Phase 4B.1 已让馆长排期与容量使用 canonical allocation read，但选择一条排期后，详情和操作仍停留在旧 booking/group/link 心智模型。Phase 4B.2 只补齐其中的**只读详情基础**：

1. 馆长选中一条 physical Court allocation；
2. 前端使用该行的 `effective_reservation_id` 调用一次 `admin_get_reservation_detail(uuid)`；
3. RPC 返回的 Reservation、Parties、Sessions/allocations、payment aggregate/ledger 和 lineage 被映射成显式 version 1 的 `AdminReservationInspectorViewModel`；
4. UI 显示一张只读 canonical Reservation 卡；现有编辑、付款、关联、移动和取消按钮继续使用原来的 writer contract。

这一步没有假装 writer 已经支持 Party、Session 或 Reservation scope。Phase 4C 才会分别设计和确认资料、AA/自定义分摊、跨客户 primary Party、Session/Reservation 取消与 action-scope UI/RPC。

## 2. 身份模型与 fail-closed contract

| 层级 | 事实来源 | 本阶段用途 |
| --- | --- | --- |
| physical allocation | selected schedule row `id` | writer compatibility 入口与当前场地事实 |
| effective Session | `effective_session_id` | 当前场次、时间、场次备注和同场 allocation |
| effective Reservation | `effective_reservation_id` | Parties、整笔备注、总价、付款、来源和 transition |
| legacy source trace | group/link/source IDs | 只保留兼容与审计，不再充当业务主身份 |

ViewModel 在渲染前必须同时证明：

- RPC Reservation ID 与 selected effective Reservation 完全相同；
- selected allocation 在详情内只出现一次；
- 它属于 selected effective Session；
- court、venue-local start/end、status、amount、currency 一致；
- membership version 与 last transition 没有漂移；
- summary 的 Session/allocation count 与实际数组一致；
- 恰好一个 Party 具有 `primary_contact` role；
- payment share 引用当前 Party，payment allocation entry 引用当前 allocation。

任一事实缺失、重复或矛盾都会产生固定的 `reservation_selected_detail_*` 错误码。错误只影响详情卡；排期继续显示，且不会为该请求查询 legacy bookings。

## 3. ViewModel v1

`AdminReservationInspectorViewModel` 只保留管理界面需要的白名单字段：

- `selection`：allocation / Reservation / Session / court 与时间身份；
- `reservation`：reference、status、source、整笔备注、时间与数量；
- `primaryContact`、`parties`、`otherParties`：Party 与 roles；
- `sessions`、`selectedSession`：场次、场次备注与 allocations；
- `payment`：plan、status、aggregate amounts、shares、安全 payment facts 与 allocation entries；
- `lineage`：legacy source counts/facts、transitions 和 Session assignment summary。

它不会把 RPC 未承诺的字段透传到浏览器。数据库 detail RPC 原本已排除 provider reference、idempotency key、raw provider payload、payment notes 和 Party `auth_user_id`；frontend normalizer 和 ViewModel 再做一次显式白名单。

## 4. 请求、缓存与失效

- 只有选中 allocation 时才发起详情请求；排期列表没有 N+1。
- 同一 effective Reservation 内切换不同 allocation/Session 时，复用同一个进行中请求或内存缓存，再针对新 selection 重新验证和映射。
- 切换到不同 Reservation 时，旧请求通过 Supabase/PostgREST `abortSignal` 取消；React request identity 同时阻止迟到结果写回。
- 缓存只存在于当前 JS 内存，不进入 local/session storage，也不写 console。
- 成功 writer、undo/revert 与 `court_slots` Realtime 更新都会清空缓存；进行中的旧请求同时取消。
- detail 失败不会清空 schedule，不会触发 legacy fallback，也不会向 UI 显示数据库 message、hint 或 PII。

当前锁定的 `@supabase/supabase-js` 为 `2.112.2`，支持 PostgREST query modifier `abortSignal`。当前 Supabase changelog 中与本阶段相关的自动重试和未来 TypeScript 5 要求不改变此只读 contract；本仓库 Node/CI 已处于 Node 22+ 路径。

## 5. Feature selector 与生产边界

新增独立 selector：

```text
VITE_RESERVATION_SELECTED_DETAIL_READ_SOURCE=legacy|canonical
```

只有小写 exact `canonical` 启用新详情。缺失、大小写错误和未知值全部回到 `legacy`。它与 `VITE_RESERVATION_SCHEDULE_READ_SOURCE` 相互独立：

- `.env.staging.example`：schedule `canonical` + selected detail `canonical`；
- `.env.example`：selected detail `legacy`；
- GitHub Pages workflow：repo variable 缺失时固定 fallback `legacy`；
- 本 Draft PR 即使未来合并，也不会自动切换 production detail；production cutover 仍需单独确认并设置 variable。

回退只需把 selected-detail selector 设为 `legacy` 或删除 variable 后重新构建，不需要 DB rollback。

## 6. 操作兼容边界

Canonical 卡明确标为只读。以下语义没有在本阶段改变：

- 编辑资料仍调用 `admin_update_booking_details(p_booking_id, ...)`；
- 快速付款与关联付款仍使用现有 group/linked scope；
- link/unlink 仍使用现有 relationship RPC；
- move/resize/swap/cancel 仍以 physical booking ID 和既有 scope 工作；
- production order search 和 order list 仍保持现状。

在 canonical detail 模式下，旧 inspector 的重复备注展示被隐藏，以免 schedule summary 的 `has_notes` 与旧 `customer_notes=null` 产生误导；编辑表单及其 writer 没有被悄悄改造成 Reservation/Party mutation。

## 7. 数据库与安全 preflight

对 `badminton_stage` 执行只读事务得到：

- 48 migrations，最新 `20260825091608_reservation_phase_4a_manager_read_contract`；
- 192 canonical allocations、123 Reservation summaries；
- Phase 4A mismatch 为 0；
- `admin_get_reservation_detail(uuid)` 为 security invoker、空 `search_path`、authenticated 可执行、anon 不可执行；
- Realtime publication 仍只有 `public.court_slots`。

本阶段没有 DDL、migration、RLS/RPC grant、Realtime publication、Auth、付款或客户数据变化。

## 8. 自动验证

本地显式使用 Codex bundled Node `v24.19.0` / pnpm `11.19.0`：

- selected-detail contract：9/9；
- Reservation read adapters：30/30；
- 全仓本地测试：93 tests / 92 pass / 1 个既有 no-local-PostgreSQL skip / 0 fail；
- `pnpm run lint`：通过；
- production build 与 canonical staging build：通过，仅保留既有 >500 kB chunk warning。

测试覆盖 fail-closed selector、完整 multi-Party/multi-Session/payment/lineage ViewModel、三层 identity mismatch、duplicate allocation、失效 payment reference、RPC 白名单、同 Reservation dedupe/cache、跨 Reservation abort、writer invalidation 与安全错误码。

CI 仍固定 Node 22、pnpm 11.16.0、PostgreSQL 16；本地 bundled runtime 通过不替代 merge-head CI。

Draft PR #154 首轮 [CI run 32954788755](https://github.com/tujiaqi2002/badminton/actions/runs/32954788755) 已通过 PostgreSQL integration、Reservation migration/concurrency tests、Reservation read adapters、lint 与 build。唯一 annotation 是 GitHub runner 对 `pnpm/action-setup@v4` 内部 Node 20 target 的平台弃用提示，不是仓库代码或本阶段测试失败。

## 9. 浏览器证据

本地 staging 使用 exact canonical schedule + exact canonical selected detail，连接 `badminton_stage` 合成数据。馆长在 2026-09-07 选择同一 Reservation 的 Court 1 / Court 2 allocations，结果如下：

- canonical 卡为 `ready` / ViewModel version 1；显示主要联系人、其他参与人、整笔备注、当前 Session 备注、1 个 Session / 2 个 allocations、付款计划与金额、来源和 transition 数量；
- 首次选择只新增 1 次 `admin_get_reservation_detail` POST / HTTP 200；切换到同一 Reservation 的第二个 allocation、切换语言并重新选择都没有新增请求；
- 新详情没有查询 `/rest/v1/bookings` 作为 fallback；排期始终可见，既有 action 仍显示但卡片明确标为只读；
- 刻意用 canonical detail + legacy schedule 的错误组合启动时，详情因缺少 effective Reservation identity 显示固定 fail-closed 错误，排期仍可用且没有 silent fallback；
- 中文与英文桌面、390×844 手机均通过，手机 document width / scroll width 同为 375，无横向 overflow；console error 0、warning 0；
- staging fixture 的 `legacy_unspecified` 付款计划最初暴露了翻译 key；本轮已补成“历史付款方式（未指定）”/“Legacy payment plan (not specified)”，并将 payment plan/status 枚举纳入 fail-closed contract 与单元测试。

| 证据 | Before | After |
| --- | --- | --- |
| 英文桌面 | [legacy inspector](../screenshots/issue-153/before-selected-detail-legacy-desktop-en.jpg) | [canonical Reservation](../screenshots/issue-153/after-selected-detail-canonical-desktop-en.jpg) |
| 中文桌面 | — | [canonical Reservation](../screenshots/issue-153/after-selected-detail-canonical-desktop-zh.jpg) |
| 英文手机 | [legacy inspector](../screenshots/issue-153/before-selected-detail-legacy-mobile-en.jpg) | [canonical Reservation](../screenshots/issue-153/after-selected-detail-canonical-mobile-en.jpg) |
| 中文手机 | — | [canonical Reservation](../screenshots/issue-153/after-selected-detail-canonical-mobile-zh.jpg) |
| Non-manager 门禁 | — | [未授权页面](../screenshots/issue-153/after-selected-detail-non-manager-denied-desktop-en.jpg) |

Synthetic non-manager 登录后的页面只显示“未授权”，馆长导航、排期区域和 canonical 详情卡数量均为 0，console error/warn 为 0。登录时间附近的 API 日志只有 `staff_members` 权限检查；`admin_get_reservation_detail` 的最后一次成功调用仍停留在之前的 manager 验证，因此 non-manager 没有触发详情 RPC。数据库层 non-manager / anon 拒绝继续由 Phase 4A/4B.0 契约与本轮 ACL preflight 保持成立。

## 10. 后续门禁

1. 评审 Draft PR #154；
2. 另行确认 Ready/merge，合并后 production selector 仍保持 legacy；
3. 另行确认 production selected-detail cutover；
4. Phase 4C 重新起草并确认所有 writer/action scope；
5. legacy decommission 仍必须等 read/write/rollback observation 全部结束后单独授权。

---

# Reservation Phase 4B.2: Canonical selected-detail read

> Issue: [#153](https://github.com/tujiaqi2002/badminton/issues/153)
> Draft PR: [#154](https://github.com/tujiaqi2002/badminton/pull/154)
> Branch: `codex/reservation-phase-4b2-selected-detail`
> Status: implementation, automated verification, manager/non-manager staging browser evidence, and Draft PR CI are complete; review is pending.
> Database: no migration, DB push, or data mutation.

## 1. Purpose

Phase 4B.1 moved the manager schedule and capacity monitor to canonical allocation reads, while the inspector and all actions retained the legacy booking/group/link mental model. Phase 4B.2 adds only the missing **read-only detail foundation**:

1. the manager selects one physical Court allocation;
2. the frontend calls `admin_get_reservation_detail(uuid)` once with its `effective_reservation_id`;
3. Reservation, Parties, Sessions/allocations, payment aggregate/ledger, and lineage facts are adapted into an explicit version 1 `AdminReservationInspectorViewModel`;
4. the UI renders a read-only canonical Reservation card while existing edit, payment, relationship, move, and cancellation controls keep their current writer contracts.

This phase does not pretend that writers already support Party, Session, or Reservation scopes. Phase 4C must separately design and confirm profile changes, equal/custom payment shares, cross-customer primary Party selection, Session/Reservation cancellation, and action-scope UI/RPC adoption.

## 2. Identity and fail-closed contract

| Layer | Fact source | Phase 4B.2 purpose |
| --- | --- | --- |
| physical allocation | selected schedule row `id` | writer compatibility entry and current Court fact |
| effective Session | `effective_session_id` | selected occurrence, time, Session notes, and sibling allocations |
| effective Reservation | `effective_reservation_id` | Parties, Reservation notes, total, payments, sources, and transitions |
| legacy source trace | group/link/source IDs | compatibility and audit only, never the primary business identity |

Before rendering, the ViewModel proves that the RPC Reservation matches the selected effective Reservation; the physical allocation appears exactly once; its parent is the selected effective Session; Court, venue-local start/end, status, amount, currency, membership version, and transition identity agree; summary counts equal the actual Session/allocation arrays; exactly one Party has the `primary_contact` role; payment shares reference current Parties; and payment allocation entries reference current allocations.

Any missing, duplicate, or contradictory fact produces a stable `reservation_selected_detail_*` code. Only the detail card fails; the schedule remains visible, and the request never falls back to legacy bookings.

## 3. ViewModel v1

The manager ViewModel contains only explicitly whitelisted fields:

- `selection`: allocation, Reservation, Session, Court, and time identity;
- `reservation`: reference, status, source, Reservation notes, timestamps, and counts;
- `primaryContact`, `parties`, and `otherParties`: Parties and roles;
- `sessions` and `selectedSession`: occurrences, Session notes, and allocations;
- `payment`: plan, status, aggregate amounts, shares, safe Payment facts, and allocation entries;
- `lineage`: legacy source counts/facts, transitions, and Session assignment summary.

Unknown RPC fields are never forwarded. The database RPC already excludes provider references, idempotency keys, raw provider payloads, payment notes, and Party `auth_user_id`; the frontend normalizer and ViewModel add a second explicit whitelist.

## 4. Request lifecycle, cache, and invalidation

- Detail is requested only after allocation selection, so the schedule list has no N+1.
- Selections inside one effective Reservation share the in-flight request or memory cache, then re-run identity validation for the new selection.
- Moving to another Reservation aborts the old Supabase/PostgREST request with `abortSignal`; React request identity also rejects late UI writes.
- Cache is memory-only and never enters local/session storage or console output.
- Successful writers, undo/revert, and `court_slots` Realtime updates invalidate the cache and cancel stale in-flight work.
- A detail failure never clears the schedule, triggers legacy fallback, or exposes a database message, hint, or PII in the UI.

The lockfile currently resolves `@supabase/supabase-js` `2.112.2`, which supports the PostgREST `abortSignal` modifier. Current automatic-retry and future TypeScript 5 notices in the Supabase changelog do not change this stable read-only contract; this repository is already on the Node 22+ CI path.

## 5. Feature selector and production boundary

The new independent selector is:

```text
VITE_RESERVATION_SELECTED_DETAIL_READ_SOURCE=legacy|canonical
```

Only the exact lowercase value `canonical` enables the new read. Missing, differently cased, or unknown values all resolve to `legacy`. It is independent from `VITE_RESERVATION_SCHEDULE_READ_SOURCE`:

- `.env.staging.example`: canonical schedule and canonical selected detail;
- `.env.example`: legacy selected detail;
- GitHub Pages workflow: hard `legacy` fallback when the repository variable is absent;
- merging this Draft PR later cannot automatically cut over production detail; production cutover still needs separate confirmation and a variable change.

Rollback is a rebuild after setting the selector to `legacy` or deleting the variable. No database rollback is needed.

## 6. Action compatibility boundary

The canonical card is visibly read-only. Phase 4B.2 does not change:

- `admin_update_booking_details(p_booking_id, ...)` for profile edits;
- current group/linked scopes for quick payment actions;
- existing relationship RPCs for link/unlink;
- physical booking ID and current scopes for move/resize/swap/cancel;
- production order search or order list behavior.

When canonical detail is enabled, the duplicate legacy notes display is hidden so `has_notes` plus `customer_notes=null` cannot mislead the manager. The edit form and its writer are not silently reinterpreted as a Reservation or Party mutation.

## 7. Database and security preflight

A read-only transaction against `badminton_stage` confirmed 48 migrations with `20260825091608_reservation_phase_4a_manager_read_contract` latest, 192 canonical allocations, 123 Reservation summaries, zero Phase 4A mismatches, a security-invoker `admin_get_reservation_detail(uuid)` with empty `search_path`, authenticated-only execution, no anonymous execution, and `public.court_slots` as the only Realtime publication table.

Phase 4B.2 changes no DDL, migration, RLS/RPC grant, Realtime publication, Auth rule, payment fact, or customer data.

## 8. Automated verification

The explicit local runtime was Codex bundled Node `v24.19.0` and pnpm `11.19.0`:

- selected-detail contract: 9/9;
- Reservation read adapters: 30/30;
- full local repository suite: 93 tests / 92 pass / one existing no-local-PostgreSQL skip / zero failures;
- `pnpm run lint`: passed;
- production and canonical-staging builds: passed with only the existing >500 kB chunk warning.

Coverage includes the fail-closed selector, a complete multi-Party/multi-Session/payment/lineage ViewModel, three-layer identity mismatches, duplicate allocation membership, broken payment references, RPC whitelist, same-Reservation dedupe/cache, cross-Reservation abort, writer invalidation, and safe UI error codes.

CI remains pinned to Node 22, pnpm 11.16.0, and PostgreSQL 16. Local bundled-runtime success does not replace merge-head CI.

Draft PR #154 [CI run 32954788755](https://github.com/tujiaqi2002/badminton/actions/runs/32954788755) passed PostgreSQL integration, Reservation migration/concurrency tests, Reservation read adapters, lint, and build. Its only annotation is the GitHub runner platform notice about the internal Node 20 target in `pnpm/action-setup@v4`; it is not a repository-code or Phase 4B.2 test failure.

## 9. Browser evidence

Local staging used exact canonical schedule plus exact canonical selected detail against the synthetic `badminton_stage` data. A manager selected the Court 1 and Court 2 allocations of one Reservation on 2026-09-07:

- the canonical card reached `ready` with ViewModel version 1 and showed the primary contact, other Parties, Reservation notes, selected-Session notes, one Session/two allocations, payment plan and amounts, source count, and transition count;
- the first selection added exactly one successful `admin_get_reservation_detail` POST. Selecting the sibling allocation, switching language, and reselecting did not add another request;
- the new detail path never queried `/rest/v1/bookings` as a fallback. The schedule stayed visible, and existing actions remained available while the card was explicitly read-only;
- an intentional unsupported pairing of canonical detail with legacy schedule failed closed on the missing effective Reservation identity, kept the schedule available, and did not silently fall back;
- Chinese/English desktop and 390×844 mobile checks passed. Mobile document and scroll widths were both 375, with no horizontal overflow. Console errors and warnings were both zero;
- the staging fixture exposed `legacy_unspecified`, which initially rendered as an untranslated key. The run added the bilingual “历史付款方式（未指定）” / “Legacy payment plan (not specified)” copy and placed payment-plan/status enums inside the fail-closed contract and unit suite.

| Evidence | Before | After |
| --- | --- | --- |
| English desktop | [legacy inspector](../screenshots/issue-153/before-selected-detail-legacy-desktop-en.jpg) | [canonical Reservation](../screenshots/issue-153/after-selected-detail-canonical-desktop-en.jpg) |
| Chinese desktop | — | [canonical Reservation](../screenshots/issue-153/after-selected-detail-canonical-desktop-zh.jpg) |
| English mobile | [legacy inspector](../screenshots/issue-153/before-selected-detail-legacy-mobile-en.jpg) | [canonical Reservation](../screenshots/issue-153/after-selected-detail-canonical-mobile-en.jpg) |
| Chinese mobile | — | [canonical Reservation](../screenshots/issue-153/after-selected-detail-canonical-mobile-zh.jpg) |
| Non-manager gate | — | [unauthorized page](../screenshots/issue-153/after-selected-detail-non-manager-denied-desktop-en.jpg) |

After the synthetic non-manager login, the page showed only the unauthorized state. Manager navigation, schedule regions, and canonical detail cards all had a count of zero, with no console errors or warnings. API logs around the login contained only the `staff_members` authorization check; the most recent successful `admin_get_reservation_detail` call remained the earlier manager test, so the non-manager never triggered the detail RPC. Database-level non-manager/anonymous denial remains established by the Phase 4A/4B.0 contract and this run's ACL preflight.

## 10. Next gates

1. Review Draft PR #154.
2. Separately confirm Ready/merge; production selected detail remains legacy after merge.
3. Separately confirm the production selected-detail cutover.
4. Re-draft and confirm every Phase 4C writer/action scope.
5. Legacy decommission remains separately gated until read/write/rollback observation is complete.
