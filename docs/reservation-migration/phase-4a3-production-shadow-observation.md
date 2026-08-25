# Reservation Phase 4A.3：生产只读影子观察

> Issue：[#142](https://github.com/tujiaqi2002/badminton/issues/142)。本阶段只验证已部署的馆长排期 shadow path；legacy bookings 始终是唯一渲染来源。

## 1. 结论

2026-08-25 的受控生产观察已完成并安全回退。四个馆长排期日期窗口都产生 `info` 级别的 `reservation_read_shadow_v1` clean 事件；两个 canonical 只读 RPC 各完成 4 次 POST，全部返回 HTTP 200。观察后的数据库 diagnostic 仍为 clean，随后 feature flag 被删除并重新部署，线上 bundle 再次裁剪掉全部 shadow 代码。

这次结果证明 Phase 4A.2 的生产 shadow 链路可用、当前观察范围内 legacy allocation 与 canonical allocation 一致，并且回退路径有效。它不等于默认 read/UI cutover，也不授权订单搜索/详情切换或 legacy decommission。

## 2. 授权与边界

用户在 PR #146 的文档门禁后明确同意继续。执行前再次声明并保持以下边界：

- 只在已登录、已验证的生产馆长排期页面运行；
- 只增加 canonical schedule 与 PII-free status 的并行读取；
- 不让 shadow 结果控制 loading、toast、渲染、mutation 或客户读取；
- 不修改 migration、schema、RLS、grant、writer、Realtime、Stripe 或客户 Auth；
- 不切换默认 schedule/order/detail read path；
- 观察结束后立即恢复原有的变量缺失 / workflow fallback `false` 基线。

## 3. 开启前基线

- PR [#146](https://github.com/tujiaqi2002/badminton/pull/146) 于 2026-08-25 10:51:36 UTC 合并为 `a205e4a25e2d71d16c13b1e3dc0e4a02b7a31225`；它只记录 PR #145 的生产发布证据。
- 合并后的默认关闭 Pages [run 32839332729](https://github.com/tujiaqi2002/badminton/actions/runs/32839332729) 成功。
- `VITE_RESERVATION_READ_SHADOW` 不存在；线上 `index-ssrRc0gW.js` 中 shadow event 和 RPC 字面量均为 0。
- Production 与 `badminton_stage` 各有 48 个 migrations，最新均为 `20260825091608_reservation_phase_4a_manager_read_contract`。

## 4. 受控观察

`VITE_RESERVATION_READ_SHADOW=true` 只在本次短时窗口内设置。Pages [run 32839524612](https://github.com/tujiaqi2002/badminton/actions/runs/32839524612) 从同一个 `main` commit 成功 build/deploy；线上 `index-Dt7sI6uM.js` 包含 shadow event 与两个只读 RPC，证明 feature-on artifact 已生效。

使用既有已登录馆长会话加载唯一观察 URL 后，依次触发当前、前一周、返回当前和后一周四个排期范围。结果如下：

- 浏览器开发日志：4 个 `reservation_read_shadow_v1`，全部为 `info`；实现只有 client comparison 与 server status 同时 clean 时才使用该级别。
- Supabase API 日志：`admin_list_reservation_allocations` 4 次 POST / 4 次 HTTP 200；`admin_get_reservation_read_shadow_status` 4 次 POST / 4 次 HTTP 200。
- 日志只核对固定事件、级别、RPC 名、状态码、时间和聚合诊断；没有记录客户姓名、邮箱、电话、备注、ID 或数据库 sample。
- 页面继续由 legacy booking rows 渲染；观察期间没有执行任何预订、付款、排期或资料写入。

观察后再次执行 `phase_4a_manager_read_contract.sql`：

- 48 migrations，latest `20260825091608`；
- Phase 3B clean：192 bookings / 192 memberships，17 public entries、0 public direct legacy writers、17 private delegates、3 wrappers；
- 7 张 FORCE RLS 表，Realtime 仍只有 `public.court_slots`；
- Phase 3B shadow/session/payment/incomplete-operation mismatch 全部为 0；
- Phase 4A verified：192 allocations、123 Reservations、read mismatch 为 0。

## 5. 回退验证

观察完成后删除 `VITE_RESERVATION_READ_SHADOW`，而不是把临时 true 留在生产。Pages [run 32839948133](https://github.com/tujiaqi2002/badminton/actions/runs/32839948133) 从相同 commit 重新 build/deploy 并成功。

最终线上基线：

- Actions 变量列表中没有 `VITE_RESERVATION_READ_SHADOW`；
- workflow 继续以 fallback `false` 构建；
- 线上重新引用 `index-ssrRc0gW.js`；
- bundle 中 `reservation_read_shadow_v1` 与 `admin_list_reservation_allocations` 均为 0 次出现；
- 没有数据库回滚，因为本次观察没有数据库写入。

## 6. 后续门禁

本次短时多窗口观察是 Phase 4B schedule adoption 的必要证据，但不是充分授权。下一步应先单独起草默认排期读取切换的范围、fallback、监控和验收标准，并按 Supabase/权限高风险流程由用户确认。

本阶段没有授权：

- 默认 schedule read/UI cutover；
- Reservation-level order search/detail cutover；
- 付款、计价或 mutation 行为变化；
- 删除 `booking_group_id`、`booking_link_id`、legacy RPC 或兼容投影；
- Phase 5 decommission。

---

# English version

## Reservation Phase 4A.3: controlled production shadow observation

The controlled production observation completed successfully on 2026-08-25 and was then rolled back to the original default-off baseline. Four manager-schedule date windows emitted `info`-level `reservation_read_shadow_v1` clean events. Each canonical read-only RPC completed four POST requests with HTTP 200 responses. The post-observation database diagnostic remained clean, after which the temporary feature variable was deleted and the site was rebuilt without the shadow code.

This proves that the deployed Phase 4A.2 shadow path works in production for the observed windows, that the compared legacy and canonical allocations were aligned, and that the rollback path works. It is not a default read/UI cutover and does not authorize order search/detail adoption or legacy decommission.

## Authorization and boundaries

After the PR #146 documentation gate, the user explicitly approved continuing. The observation remained within these declared boundaries:

- use only an authenticated, verified production manager schedule session;
- add only parallel canonical schedule and PII-free status reads;
- never let shadow results control loading, toasts, rendering, mutations, or customer reads;
- change no migration, schema, RLS, grant, writer, Realtime, Stripe, or customer Auth behavior;
- switch no default schedule, order, or detail read path;
- restore the original unset-variable / workflow-fallback-false baseline immediately after observation.

## Baseline and feature-on deployment

PR [#146](https://github.com/tujiaqi2002/badminton/pull/146) merged at 2026-08-25 10:51:36 UTC as `a205e4a25e2d71d16c13b1e3dc0e4a02b7a31225`. The default-off Pages [run 32839332729](https://github.com/tujiaqi2002/badminton/actions/runs/32839332729) succeeded. `VITE_RESERVATION_READ_SHADOW` was unset, and the live `index-ssrRc0gW.js` contained neither the shadow event nor shadow RPC code. Production and `badminton_stage` both remained at 48 migrations, latest `20260825091608_reservation_phase_4a_manager_read_contract`.

The variable was temporarily set to exact `true`. Pages [run 32839524612](https://github.com/tujiaqi2002/badminton/actions/runs/32839524612) successfully built and deployed the same `main` commit. The live `index-Dt7sI6uM.js` contained the shadow event and both read-only RPC paths, confirming that the feature-on artifact was active.

## Observation evidence

An existing authenticated manager session loaded a unique observation URL and exercised four schedule ranges: current, previous week, return to current, and next week.

- Browser development logs contained four `reservation_read_shadow_v1` events, all at `info` level. The implementation uses that level only when both the client comparison and server status are clean.
- Supabase API logs showed four POST/HTTP 200 calls to `admin_list_reservation_allocations` and four POST/HTTP 200 calls to `admin_get_reservation_read_shadow_status`.
- Evidence collection used only fixed events, levels, RPC names, status codes, timestamps, and aggregate diagnostics. No customer name, email, phone, note, identifier, or database sample was recorded.
- Legacy booking rows remained the sole rendered source. No booking, payment, schedule, or customer-data mutation was performed.

The post-observation Phase 4A diagnostic still reported 48 migrations; 192 bookings/memberships; 192 canonical allocations; 123 Reservations; the activated 17/0/17/3 writer boundary; seven FORCE RLS tables; `public.court_slots` as the only Realtime publication; and zero Phase 3B shadow/session/payment/incomplete-operation or Phase 4A read mismatch.

## Rollback evidence and next gate

The temporary variable was deleted after observation. Pages [run 32839948133](https://github.com/tujiaqi2002/badminton/actions/runs/32839948133) rebuilt and redeployed the same commit successfully. The final GitHub Actions variable list does not contain `VITE_RESERVATION_READ_SHADOW`; the workflow again falls back to false; the site again references `index-ssrRc0gW.js`; and the live bundle contains zero shadow-event and shadow-RPC literals. No database rollback was necessary because the observation performed no database write.

This bounded clean observation is necessary evidence for Phase 4B schedule adoption, but it is not sufficient authorization. The next step is a separately drafted and confirmed default-schedule-read cutover plan with explicit fallback, monitoring, and acceptance criteria.

This phase does not authorize a default schedule read/UI cutover, Reservation-level order search/detail adoption, payment/pricing/mutation changes, deletion of legacy group/link fields or RPCs, or any Phase 5 decommission action.
