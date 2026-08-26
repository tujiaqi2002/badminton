# Reservation Phase 4B.2：production canonical selected-detail cutover

> 日期：2026-08-26
>
> Issue：[GitHub #153](https://github.com/tujiaqi2002/badminton/issues/153)
>
> 分支：`codex/reservation-phase-4b2-production-cutover`
>
> 结论：生产馆长 selected detail 已保持 canonical；数据库、writer/action scope 与客户访问策略未改变。

## 1. 授权与范围

PR #154 的代码和 PR #155 的 default-legacy 证据合并后，用户在明确说明下一步是生产 canonical selected-detail 切换后回复继续。本次授权只包含：

- fresh production read-only preflight；
- 设置 `VITE_RESERVATION_SELECTED_DETAIL_READ_SOURCE=canonical`；
- 从已验证的 `main` 重新构建并部署 GitHub Pages；
- 有限的真实馆长、非馆长、API logs 与数据库无漂移验证；
- 保留 selector rollback。

本次不包含 migration/DB push、数据 mutation、RLS/RPC grant、writer/action scope、付款/计价、Auth、Realtime、客户 `My Bookings`、Phase 4C 或 legacy decommission。

## 2. Fresh preflight

- `main` 为合并 PR #155 后的 `a16e5f68eba635924c02b0a7b192093f4747f23c`；新证据分支从该 commit 创建，worktree clean。
- Supabase production project `ldbtrouofmqmnkyxiewk` 为 `ACTIVE_HEALTHY`，PostgreSQL `17.6.1.155`。
- migration history 为 48 个版本，latest `20260825091608_reservation_phase_4a_manager_read_contract`。
- Phase 4A diagnostic 为 192 bookings / 192 memberships、192 allocations、123 Reservations，所有 Phase 3B/4A mismatch 为 0。
- writer boundary 为 17 public entries / 0 public direct legacy writers / 17 private delegates / 3 wrappers；7 张表 FORCE RLS；Realtime 只有 `public.court_slots`。
- schedule variable 已为 exact `canonical`；selected-detail variable 在切换前不存在，因此原部署严格回退 `legacy`。
- 当前 Supabase changelog 没有影响本次 hosted read-only selector cutover 的 breaking change。

## 3. Cutover 与 artifact

10:59 UTC 设置 `VITE_RESERVATION_SELECTED_DETAIL_READ_SOURCE=canonical`，随后从 `main@a16e5f6` 手工触发 Pages。

- [Pages run 32961018071](https://github.com/tujiaqi2002/badminton/actions/runs/32961018071) build/deploy 全绿；
- 线上首页 HTTP 200 并加载 `assets/index-DLJKKuT_.js`；
- bundle 中 production project ref 为 1、staging project ref 为 0、`admin_get_reservation_detail` 为 1；
- Actions variable 读取值为 exact `canonical`。

唯一 annotation 是 GitHub runner 对部分 action 内部 Node 20 target 的平台提示；workflow 实际使用 Node 22，runner 强制这些 action 运行在 Node 24，本次 build/deploy 没有失败。

## 4. 真实馆长观察

验证只记录结构、数量、RPC 和状态码，不保存客户姓名、联系方式、备注、Reservation/booking UUID 或生产截图。

- 选择一笔生产 allocation 后出现且只出现 1 张 `data-reservation-detail-source=canonical` 卡；状态 `ready`、ViewModel version `1`、error 卡为 0。
- 中文卡完整显示 7 个业务区块：主要联系人、其他参与人、整笔预约备注、当前场次备注、预约范围、整笔预约付款、合并与拆分记录；只读兼容边界文案存在。
- 一个 3 Session / 3 allocation 的 Reservation 中切换两个 sibling Court allocations，reference 保持相同、始终只有 1 张 ready 卡和 1 张选中场地卡；第二次 sibling 选择没有新增 detail POST。
- 切换到另一个 Reservation 后 reference 改变，并新增一次 detail POST。
- 本观察覆盖 3 个不同 Reservations；API logs 共记录 3 次 detail POST + 1 次首次 CORS OPTIONS，全部 HTTP 200。Sibling allocation 切换没有产生第 4 次 POST。
- 全程 browser error/warn 为 0，没有 canonical error panel。

现有编辑、付款、关联、移动和取消控件仍与只读 canonical 卡并存，并继续使用既有 booking writer/action contract；这不是 legacy fallback，而是 Phase 4B.2 明确保留的写操作兼容边界。

## 5. 权限与数据库无漂移

生产中以随机、无 `staff_members` 行的 `authenticated` subject 在 read-only transaction 调用 detail RPC，结果严格为 `Manager access required`。函数继续为 `SECURITY INVOKER`；`anon` 无 EXECUTE。

切换后的完整 Phase 4A diagnostic 与切换前一致：48 migrations、192/192 bookings/memberships、192 allocations、123 Reservations、全部 mismatch 0、17/0/17/3 writer、7 FORCE RLS 与 `court_slots`-only Realtime。没有 migration、DB push、permission、writer、数据、Auth 或 publication 变化。

## 6. 本地验证

Codex Desktop bundled Node `v24.19.0` / pnpm `11.19.0`：

- `pnpm run test`：93 tests，92 pass、1 个明确的 no-local-PostgreSQL skip、0 fail；
- `pnpm run lint`：通过；
- exact canonical schedule + canonical detail 的 `pnpm run build`：通过；
- 只有既有的 Vite >500 kB chunk warning。

## 7. 回退与下一门禁

回退不需要 DB rollback：把 `VITE_RESERVATION_SELECTED_DETAIL_READ_SOURCE` 设为 `legacy` 或删除 variable，再从相同 `main` 重新运行 Pages。Schedule selector 可独立保持 canonical。

生产当前保持 canonical schedule/capacity + canonical selected detail。Manager order/search、客户 `My Bookings`、所有 writer/action scope 与 legacy decommission 仍未切换；下一步应先单独起草并确认 manager Reservation list/search，而不是直接删除旧 contract。

---

# Reservation Phase 4B.2: production canonical selected-detail cutover

> Date: 2026-08-26
>
> Issue: [GitHub #153](https://github.com/tujiaqi2002/badminton/issues/153)
>
> Branch: `codex/reservation-phase-4b2-production-cutover`
>
> Result: production manager selected detail now remains canonical; the database, writer/action scopes, and customer access policy did not change.

## 1. Authorization and scope

After PR #154 delivered the code and PR #155 merged the default-legacy evidence, the user continued from a gate that explicitly named the production canonical selected-detail cutover. Authorization covered a fresh read-only preflight, the exact canonical repository variable, a Pages rebuild from verified `main`, bounded manager/non-manager/API/database observation, and preservation of selector rollback.

It excluded migrations or DB push, data mutation, RLS/RPC grants, writer/action scopes, payment/pricing, Auth, Realtime, customer `My Bookings`, Phase 4C, and legacy decommission.

## 2. Fresh preflight

- The cutover used `main@a16e5f68eba635924c02b0a7b192093f4747f23c`, after PR #155; the evidence branch was clean and based on that commit.
- Production `ldbtrouofmqmnkyxiewk` was `ACTIVE_HEALTHY` on PostgreSQL `17.6.1.155`.
- History contained 48 migrations ending at `20260825091608_reservation_phase_4a_manager_read_contract`.
- The diagnostic returned 192 bookings/memberships, 192 allocations, 123 Reservations, zero Phase 3B/4A mismatch, the 17/0/17/3 writer boundary, seven FORCE RLS tables, and `public.court_slots`-only Realtime.
- Schedule was already exact canonical. The selected-detail variable was absent before this gate and therefore resolved strictly to legacy.
- No current Supabase breaking change applied to this hosted read-only selector cutover.

## 3. Cutover and artifact

At 10:59 UTC, `VITE_RESERVATION_SELECTED_DETAIL_READ_SOURCE` was set to exact `canonical`, then Pages was dispatched from `main@a16e5f6`.

- [Pages run 32961018071](https://github.com/tujiaqi2002/badminton/actions/runs/32961018071) completed build and deploy successfully.
- The HTTP-200 page loaded `assets/index-DLJKKuT_.js`.
- The bundle contained one production project ref, zero staging refs, and one `admin_get_reservation_detail` occurrence.
- The repository variable read back as exact `canonical`.

The only annotation was the GitHub runner platform notice for the internal Node 20 target in several actions. The workflow itself used Node 22, those actions were forced onto Node 24, and build/deploy succeeded.

## 4. Live manager observation

Evidence retained only structure, counts, RPC names, and status codes. No customer name, contact, note, Reservation/booking UUID, or production screenshot was saved.

- Selecting one live allocation rendered exactly one canonical detail card in `ready` state, ViewModel version `1`, with zero error cards.
- All seven Chinese business sections and the read-only compatibility boundary were present.
- Switching two sibling Court allocations in a three-Session / three-allocation Reservation retained the same reference, one ready card, and one selected Court card. The second sibling selection issued no additional detail POST.
- Moving to another Reservation changed the reference and issued the next POST.
- Three distinct Reservations produced three detail POST calls plus one initial CORS OPTIONS request; all were HTTP 200. The sibling switch did not produce a fourth POST.
- Browser error/warn remained zero and no canonical error panel appeared.

Existing edit, payment, relationship, move, and cancellation controls intentionally coexist with the new read-only card and retain the previous booking writer/action contracts. That compatibility boundary is not a silent read fallback.

## 5. Permission and post-cutover integrity

An authenticated subject with no `staff_members` row was tested inside a production read-only transaction and received `Manager access required`. The RPC remains `SECURITY INVOKER`, and `anon` has no EXECUTE.

The post-cutover diagnostic was identical to preflight: 48 migrations, 192/192 bookings/memberships, 192 allocations, 123 Reservations, zero mismatch, 17/0/17/3 writers, seven FORCE RLS tables, and `court_slots`-only Realtime. No migration, DB push, permission, writer, business data, Auth, or publication changed.

## 6. Local verification

With bundled Node `v24.19.0` and pnpm `11.19.0`, 93 tests produced 92 passes, one explicit no-local-PostgreSQL skip, and zero failures. Lint and the exact canonical schedule + canonical detail production build passed. Only the existing Vite >500 kB chunk warning remained.

## 7. Rollback and next gate

Rollback requires no database rollback: set the selected-detail variable to `legacy` or delete it, then rebuild the same `main`. Schedule can remain canonical independently.

Production now keeps canonical schedule/capacity plus canonical selected detail. Manager order/search, customer `My Bookings`, every writer/action scope, and legacy decommission remain unchanged. The next independently drafted and confirmed gate should address the manager Reservation list/search before any legacy removal.
