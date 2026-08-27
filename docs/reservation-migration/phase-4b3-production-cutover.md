# Reservation Phase 4B.3：Production canonical order/search cutover

> 关联 Issue：[#157](https://github.com/tujiaqi2002/badminton/issues/157)
> 生产切换：2026-08-27
> Pages run：[33039738583](https://github.com/tujiaqi2002/badminton/actions/runs/33039738583)
> 部署 commit：`7eea58d5e0ce9c3caf796d05236a3bf2102b020f`

## 1. 范围与结果

本门禁只把 production repository variable `VITE_RESERVATION_ORDER_READ_SOURCE` 设为 exact `canonical`，并从已经验证的 `main` 重新构建 GitHub Pages。

包含：

- fresh production read-only preflight；
- exact-canonical 本地 build；
- Pages selector 切换与部署；
- 真实馆长中英文桌面、390×844 手机和排期定位观察；
- Supabase API logs 与数据库 postflight；
- 明确 rollback。

不包含：

- migration、DB push、DDL、grant、RLS 或 Realtime 变化；
- 任何 writer/action scope；
- 客户读取或普通客户登录；
- 付款/计价、Stripe、refund 或通知；
- legacy field/RPC decommission。

结果：production manager schedule/capacity、selected detail 与 order/search 三个读取面现均通过各自 selector 使用 canonical contract。订单聚合卡继续只读；付款、移动、取消和关系动作留给另行确认的 Phase 4C。

## 2. 切换前门禁

Supabase project `ldbtrouofmqmnkyxiewk`：

- project status：`ACTIVE_HEALTHY`；
- PostgreSQL：`17.6.1`；
- migration count：49；
- latest：`20260826181644_reservation_phase_4b3_order_search`；
- counts：192 bookings / 192 memberships / 123 Reservations / 135 Sessions / 131 Parties；
- Phase 3B activation：`clean`；
- Phase 4A read contract：`phase_4a_manager_read_contract_verified`；
- shadow / projection / payment / incomplete-operation / read mismatch：全部 0；
- writer boundary：17 public entries / 0 public direct legacy / 17 private delegates / 3 wrappers；
- FORCE RLS：7；
- Realtime：只有 `public.court_slots`。

`admin_search_reservations(...)`：

- `STABLE`、`SECURITY INVOKER`、空 `search_path`；
- authenticated EXECUTE=true；
- anon=false；
- service_role=false；
- all-Party search、`party_count` 与 compound keyset markers 存在；
- 真实 manager read-only 调用返回 schema version 1；
- 随机 authenticated non-manager 在 read-only transaction 中返回 `Manager access required`。

Advisors 保持既有 baseline：48 security（2 INFO / 46 WARN）与 60 performance INFO，`admin_search_reservations` 无目标 finding。

切换前 Actions 中 schedule 与 selected-detail selector 已为 canonical，order selector 缺失。真实馆长 future-30 页面使用 `index-D2_P4uCy.js`，显示：

- 2 条 legacy Court rows；
- 2 个改期入口；
- 2 个取消入口；
- 0 张 canonical Reservation card；
- 0 个 canonical schedule-focus action；
- 0 horizontal overflow；
- 0 console error/warn。

## 3. 本地验证

显式使用 Codex Desktop bundled runtime：

- Node `v24.19.0`；
- pnpm `11.19.0`。

结果：

- `pnpm run test:reservation-read`：36/36 pass；
- `pnpm run test:reservation`：37 total / 36 pass / 1 个既有 no-local-PostgreSQL contention skip / 0 fail；
- `pnpm run lint`：pass；
- schedule/order/selected-detail 三个 selector 均 exact canonical 的 `pnpm run build`：pass；
- 只有既有 >500 kB chunk warning。

Pages workflow 仍固定 Node 22 与 pnpm 11.16.0。本地 runtime 与 CI/部署声明不同，因此本地通过不替代 workflow gate。

## 4. Production 切换与 artifact

执行：

1. 设置 `VITE_RESERVATION_ORDER_READ_SOURCE=canonical`；
2. 回读确认值精确等于 `canonical`；
3. 对 `main` dispatch `deploy.yml`；
4. 等待 build/deploy 两个 job 成功。

[Pages run 33039738583](https://github.com/tujiaqi2002/badminton/actions/runs/33039738583) 成功：

- source：`main@7eea58d5e0ce9c3caf796d05236a3bf2102b020f`；
- build：success；
- deploy：success；
- live HTTP：200；
- asset：`index-BPOXxt2y.js`；
- production project ref occurrence：1；
- staging project ref occurrence：0；
- canonical schedule/order/detail RPC paths 均存在。

Workflow 的唯一 annotation 是 GitHub runner 对部分 action 内部 Node 20 target 的平台弃用提示；不是代码、build 或 Phase 4B.3 失败。

## 5. 真实馆长浏览器观察

Production future-30：

- canonical Reservation cards：2；
- “在排期中查看”：2；
- legacy Court rows：0；
- legacy reschedule actions：0；
- legacy cancel actions：0；
- order read error：0；
- horizontal overflow：0；
- console error/warn：0。

点击第一张卡的 schedule-focus action 后：

- 当前日期有效 allocation focus：1；
- schedule read error：0；
- canonical cards 仍为 2；
- horizontal overflow：0；
- console error/warn：0。

英文桌面：

- `lang=en-CA`；
- 2 张 canonical cards；
- 2 个 `View in schedule`；
- untranslated `admin.*` key：0；
- read error / overflow / console error-warn：全部 0。

390×844 手机：

- 2 张 canonical cards；
- 0 legacy rows；
- card grid：1 column；
- action/footer width ratio：0.91；
- read error / horizontal overflow / console error-warn：全部 0。

验证后语言恢复中文、viewport 恢复 1280×720。生产页面包含真实客户资料，因此没有保存或提交 production screenshot；Issue #157 的 synthetic staging Before/After 继续作为 UI 视觉证据：[`docs/screenshots/issue-157`](../screenshots/issue-157)。

## 6. API logs 与 postflight

从 selector timestamp `2026-08-27T04:32:50Z` 起，目标 API logs 为：

- `POST /rest/v1/rpc/admin_search_reservations`：8，全部 HTTP 200；
- `OPTIONS /rest/v1/rpc/admin_search_reservations`：1，HTTP 200；
- 新 `admin_search_bookings`：0。

Postflight 与 preflight 完全相同：

- 49 migrations / latest `20260826181644`；
- 192 / 192 / 123 / 135 / 131 counts 不变；
- Phase 3B/4A status clean；
- 所有 mismatch 0；
- 17/0/17/3 writer boundary；
- 7 FORCE RLS；
- search function stable/security-invoker/empty-search-path/authenticated-only；
- Realtime 仍只有 `public.court_slots`。

Selector 切换没有执行任何数据库写入。

## 7. 回退与下一门禁

前端回退：

1. 把 `VITE_RESERVATION_ORDER_READ_SOURCE` 设为 `legacy`，或删除该 variable；
2. 重新 dispatch Pages workflow；
3. 验证 live asset 和真实馆长 future-30 页面回到 legacy rows；
4. 再运行 read-only database diagnostic。

Migration 49 保持向后兼容，因此 selector rollback 不需要数据库 rollback。若 RPC 本身出现缺陷，只能用 append-only follow-up migration 修复，不改写已应用历史。

下一步不是直接给聚合卡接旧 booking actions。Phase 4C 必须先创建 Issue，明确付款、移动、取消、关系、merge/split 的 allocation/session/reservation scope；一旦涉及 Supabase、权限、付款或计价，按仓库门禁等待用户明确确认。Phase 5 legacy decommission 继续独立后置。

---

# Reservation Phase 4B.3: Production canonical order/search cutover

The production repository variable now sets `VITE_RESERVATION_ORDER_READ_SOURCE=canonical`. Successful Pages run 33039738583 deployed `index-BPOXxt2y.js` from `main@7eea58d` without a database change.

Fresh preflight verified a healthy 49-migration project, a valid manager version-1 response, non-manager denial, stable/security-invoker/empty-search-path/authenticated-only function shape, unchanged 192/192/123/135/131 counts, zero mismatch, 17/0/17/3 writers, seven FORCE RLS tables, `court_slots`-only Realtime, and the existing 48-security/60-performance advisor baseline.

The authenticated future-30 manager view changed from two legacy Court rows with two reschedule and two cancel actions into two canonical Reservation cards with two schedule-focus actions and zero legacy inline actions. Chinese/English 1280x720 and 390x844 mobile checks had no read error, horizontal overflow, or console error/warn. The first focus action selected one effective allocation for the matched date.

API logs after the selector timestamp contained eight POSTs plus one OPTIONS request to `admin_search_reservations`, all HTTP 200, and no new legacy search call. Database postflight was identical to preflight. No migration, DB push, DDL/grant, writer, business data, Auth, Realtime, payment, or pricing behavior changed.

Rollback is setting/deleting the order selector and rebuilding Pages; migration 49 remains installed. Phase 4C aggregate action scope and Phase 5 decommission require separate confirmed gates.
