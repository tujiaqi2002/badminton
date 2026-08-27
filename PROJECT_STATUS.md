# Tiger Project Status

> 项目：`project-001-badminton`。核对日期：2026-08-27。当前工作分支：`codex/reservation-phase-4c1-production-verification`。

## 1. 一句话结论

Tiger 已经越过基础 MVP，进入**单馆运营 Beta / 私有馆长试运行**阶段：预订并发、馆长可视化排期和馆务配置已经相当丰富；独立数据库 staging 已建立，但自动 PR 预览、正式在线支付和普通客户开放尚未达到生产成熟度。

换句话说，当前主要问题不是“功能太少”，而是**功能增长快于工程保障**。下一阶段应优先稳定、验证和协作，不宜马上扩张到多商户、AI 或市场平台。

## 2. 当前可验证事实

- 仓库：`tujiaqi2002/badminton`，默认分支 `main`。
- 生产前端：`https://tujiaqi2002.github.io/badminton/`，由 GitHub Actions 从 `main` 发布。
- 后端：Supabase project `ldbtrouofmqmnkyxiewk`，PostgreSQL + Auth + Realtime + RPC/RLS。
- 独立数据库 staging：Supabase project `badminton_stage` / `vcoujmzsgdboidndtzzg`，已应用 Issue #162 的 Phase 4C.1 migrations 50–51，只含确定性合成数据，不复制生产客户或 Auth 数据。
- `main` 已包含 PR #143 的 Phase 4A.1 manager read contract；生产 Supabase 已由受保护分支 integration 原子应用 migration 48。
- Production 与 staging migration history 均为 51 个版本，最新为 `20260827090512_reservation_phase_4c1_party_lineage`。Production 的 manager schedule/capacity、selected detail 与 order/search 三个读取面均为 canonical，但 profile writer selector 保持 legacy；客户读取、其余 action、Stripe 与 legacy decommission 未切换。
- Phase 4A.3 受控生产 shadow observation 已完成：四个馆长排期窗口全部 clean，两个 canonical 只读 RPC 各 4 次 POST / HTTP 200；观察后已删除临时 feature variable 并重新部署默认关闭版本。
- `main` 已包含 PR #149/#151 的 canonical schedule foundation/selector、PR #154/#155 的 selected-detail foundation/evidence、PR #158/#160 的 canonical order-search/evidence，以及 PR #163 的 canonical profile database/frontend capability。Production migrations 50–51 已安装，但 profile UI 尚未切换。
- 构建命令包含 `dev`、`build`、`preview`、`lint` 和 `test`；Reservation Phase 2/3A/3B/4A 已有 migration-chain 与真实 PostgreSQL 并发测试，但仍没有浏览器 E2E test script。
- 当前仅有 `deploy.yml`；没有证据表明仓库已有独立 PR Preview 工作流。
- `App.jsx`、`AdminSchedule.jsx`、`i18n.js` 和 `styles.css` 已成为大型集中模块，后续改动的回归面较大。

## 3. 能力成熟度

| 能力 | 状态 | 判断 |
| --- | --- | --- |
| 五场地可用性与客户预订流程 | 已实现 / 受当前访问策略限制 | UI、Realtime、多场地、电话、备注、时长与价格确认已存在；普通客户生产登录仍未开放 |
| 防超卖与权限 | 较成熟 | PostgreSQL exclusion/约束、RLS、manager RPC 是正确边界；仍需持续回归 migration 与 policy |
| 馆长日排期编辑器 | 高级 Beta | 拖拽、缩放、跨日、快速新增、多场地、循环、关联、置换、历史锁定、日志/撤回均已实现；交互仍在密集打磨 |
| 每周容量监控 | 已实现 | 适合电话查询，当前最小显示刻度为 1 小时 |
| 订单查询与分页 | production canonical 已启用 | 一笔 Reservation 一张聚合卡、所有 Party 可搜索、canonical 状态/付款筛选与 keyset pagination 已在 staging 和受控生产观察验证；聚合卡仍只读，action scope 待 Phase 4C |
| 馆务中心 | 功能完整度较高 | 基础设置、营业时间、定价、活动、会员、管理员和完整日志已接入；需要跨页面一致性回归 |
| 计价 | 已实现但高风险 | 优先级/覆盖区间已重做得更直觉，客户隐藏规则名，馆长可查看和调整；需用边界时段和多场地持续测试 |
| 审计与撤回 | 已实现 | 排期侧栏提供短日志，馆务中心保留完整查询；为快速拖拽提供了重要安全网 |
| 多语言、PWA、主题和显示设置 | 已实现 | 中英、7 套 UI、字体滑杆、订单 palette；视觉配置较多，需防止样式回归 |
| 在线支付 | 骨架 | Stripe Edge Function 代码存在，但当前 UI 可关闭；没有证据表明生产函数和完整 webhook 流程已上线验证 |
| 通知（邮件/SMS/提醒） | 未完成 | 当前没有完整通知/队列体系 |
| 多商户 SaaS、AI 助理、市场平台 | 未开始 / 非当前范围 | 来自早期长期蓝图，不应在单馆核心稳定前启动 |

## 4. 当前进行中工作

### Issue [#161](https://github.com/tujiaqi2002/badminton/issues/161) / [#162](https://github.com/tujiaqi2002/badminton/issues/162) / PR [#163](https://github.com/tujiaqi2002/badminton/pull/163) / evidence PR [#164](https://github.com/tujiaqi2002/badminton/pull/164)：Reservation Phase 4C.1 canonical profile mutation（production capability 已安装；UI default legacy）

- 用户已确认高风险父 Issue #161；实现被收窄到 #162 的 profile-only scope。Reservation 只改 notes，Session 只改 notes / party size，Party 只改显式目标的姓名、邮箱、电话；移动、改时长、取消、付款、计价、merge/split、primary role 和客户 writer 均不在范围。
- Staging append-only migrations `20260827084719` 与 `20260827090512` 安装 authenticated-only manager RPC、PII-free audit 与双向 Party transition lineage。公共入口 manager-auth first、空 `search_path`、optimistic concurrency 与 idempotency；私有 helper 无 client EXECUTE，核心表没有新增 client DML。
- Hosted rollback tests 覆盖三个 scope、幂等重试、stale/invalid/non-manager 拒绝，以及真实 merge 后从无 legacy group ID 的 current Party 反向同步 canonical lineage 与 legacy projection。所有测试 mutation 均回滚，incomplete operation 为 0；Phase 3B/4A 与 Realtime 边界保持 clean。
- Staging 与 production 当前均为 51 migrations。Production security advisor 相对 preflight 只新增一条目标函数的预期 authenticated `SECURITY DEFINER` warning；performance advisor 保持 60 INFO、无新增 finding。
- Frontend 只有 profile 与 selected-detail selectors 同时 exact `canonical` 才显示显式 Reservation/Session/Party editor；staging example canonical，Pages workflow 与 production example 默认 legacy。中英文 desktop / 390×844 mobile Before/After 已保存在 [`docs/screenshots/issue-162`](./docs/screenshots/issue-162)。
- Bundled Node `v24.19.0` / pnpm `11.19.0` 下 read 42/42、Reservation 39 pass / 2 explicit skip / 0 fail，lint/build 通过。PR #163 [CI run 33058546239](https://github.com/tujiaqi2002/badminton/actions/runs/33058546239) 在 Node `v22.23.2` / pnpm `11.16.0` / PostgreSQL `16.15` 下完成 Reservation 41/41、read 42/42、0 skip，并通过 lint/build；唯一 annotation 是 action 内部 Node 20 target 的平台弃用提示。
- 用户从明确的 Ready/merge gate 继续后，PR #163 于 2026-08-27 09:36:33 UTC 合并为 `a387a0a844084eb52a905db2fe92e161c231253b`；protected Supabase check success，将 production 原子推进到 51。Pages [run 33059345777](https://github.com/tujiaqi2002/badminton/actions/runs/33059345777) build/deploy 全绿。
- Production postflight 为 `phase_4c1_profile_mutation_verified`：1 public RPC、5 private helpers、bidirectional Party lineage、0 private client EXECUTE、0 profile operation/audit、0 incomplete operation，Phase 3B/4A 和 `court_slots`-only Realtime 均 clean。Manager 可到达 strict validation，random authenticated non-manager 在参数/目标验证前被拒绝；ACL 为 authenticated=true / anon=false / service_role=false。
- 生产 asset `index-6CF1VAe2.js` 为 HTTP 200、production ref 1 / staging ref 0。真实馆长 future-30 页面仍是 canonical detail read + legacy profile edit：canonical profile editor 0、旧“编辑资料”1、detail error 0；合并后 API logs 的 profile RPC 为 0。没有提交 mutation 或保存生产 PII screenshot。
- Evidence Draft PR [#164](https://github.com/tujiaqi2002/badminton/pull/164) 只记录本次生产验证，没有 migration、应用代码、部署配置、selector 或数据库写入；PR 保持 Draft，合并仍需明确授权。完整设计见 [`docs/reservation-migration/phase-4c1-profile-mutation.md`](./docs/reservation-migration/phase-4c1-profile-mutation.md)，生产发布证据见 [`docs/reservation-migration/phase-4c1-default-legacy-production-verification.md`](./docs/reservation-migration/phase-4c1-default-legacy-production-verification.md)。下一门禁是单独决定 production profile selector 是否设为 exact `canonical`；这不随 migration merge 自动授权。

### Issue [#157](https://github.com/tujiaqi2002/badminton/issues/157) / PR [#158](https://github.com/tujiaqi2002/badminton/pull/158) / evidence PR [#160](https://github.com/tujiaqi2002/badminton/pull/160)：Reservation Phase 4B.3 canonical order/search（production canonical 已启用并验证）

- 用户已明确确认 Issue #157。范围只包括馆长 Reservation 订单查询、聚合卡片、可回退 selector、staging migration/验证和 Draft PR；不授权 production migration/cutover、writer/action scope、客户读取、付款/计价、Stripe、Realtime 或 decommission。
- append-only migration `20260826181644_reservation_phase_4b3_order_search` 保持现有 `admin_search_reservations(...)` signature/version 1 envelope，新增 all-Party 搜索、`party_count`、venue-local date bounds 与 `(matched_start_at, reservation_id)` keyset pagination。函数继续 security invoker、空 `search_path`、authenticated-only，并独立要求 manager；不写业务数据。
- `VITE_RESERVATION_ORDER_READ_SOURCE` 只有 exact `canonical` 启用；staging example canonical，production example/workflow 缺省 legacy。Canonical 请求校验 identity、Party/schedule/Court/payment/cursor contract，abort stale request，任何矛盾 fail closed 且不逐次静默回 legacy。
- 界面以一笔 Reservation 一张卡展示 primary/other Parties、命中场次、完整 Reservation 范围、canonical payment aggregate、Courts 与 recurrence。聚合卡只提供“在排期中查看”，并高亮同一 Reservation 当天的全部 effective allocations；没有把单 booking 的改期/取消动作误挂到整笔 Reservation。
- Staging 阶段的 migration dry-run 只列第 49 个版本，随后只 push 到 `badminton_stage`；当时 stage 为 49、production 为 48，后者已在本次独立授权后推进到 49。123 Reservations / 135 Sessions / 192 memberships / 131 Parties 基线保持不变。Secondary Party 查询精确返回同一笔 `party_count = 2` Reservation，non-manager 被拒绝，ACL 为 authenticated=true / anon=false / service_role=false。
- 浏览器对比：未来 30 天从 10 条 legacy Court rows 收敛为 5 张 Reservation 卡；点击首张卡同时聚焦 2 条 allocation。中英文 desktop、390×844 mobile、primary search、non-manager 门禁和 console 均通过。Before/After 见 [`docs/screenshots/issue-157`](./docs/screenshots/issue-157)。
- bundled Node `v24.19.0` / pnpm `11.19.0` 下 read suite 36/36；Reservation suite 37 total / 36 pass / 1 个 no-local-PostgreSQL skip / 0 fail；lint/build 通过。Draft PR #158 最终 [CI run 33013960452](https://github.com/tujiaqi2002/badminton/actions/runs/33013960452) 在 Node `v22.23.2` / pnpm `11.16.0` / PostgreSQL `16.15` 下完成 Reservation 37/37、read 36/36、0 skip，并通过 lint/build；唯一 annotation 是 `pnpm/action-setup@v4` 的平台 Node 20 target 弃用提示。
- Fresh production read-only preflight 确认远端精确 48 migrations、无 remote-only 漂移，唯一 pending 项是 `20260826181644`。用户在明确说明 merge 会自动应用 production migration 49、order selector 仍保持 legacy 后回复继续；PR #158 于 2026-08-26 21:26:04 UTC 合并为 `58d9d59cab0eebd6f0591834217e744ecb2343f1`。
- Supabase check 于 21:26:47 UTC 成功，production 精确推进到 49；Pages [run 33015339219](https://github.com/tujiaqi2002/badminton/actions/runs/33015339219) build/deploy 全绿。Postflight 在 read-only transaction 中证明 Phase 4B.3 function 已安装、manager v1 RPC clean、non-manager denied、authenticated=true / anon=false / service_role=false；192 bookings / memberships、123 Reservations、135 Sessions、131 Parties、`court_slots`-only Realtime 均未改变。Advisors 保持 48 security（2 INFO / 46 WARN）与 60 performance INFO，0 个 Phase 4B.3-specific finding。
- 线上 asset `index-D2_P4uCy.js` 含 production ref 1、staging ref 0、legacy order RPC 1、canonical order RPC 0。真实馆长 future-30 页面仍显示 2 个 legacy Court rows、2 个改期和 2 个取消入口、0 个 canonical “在排期中查看”，无横向 overflow 或 console error/warn。没有保存 production screenshot，以免把真实客户资料写入仓库。完整发布证据见 [`docs/reservation-migration/phase-4b3-default-legacy-production-verification.md`](./docs/reservation-migration/phase-4b3-default-legacy-production-verification.md)。下一门禁是单独决定是否把 production order selector 设为 exact `canonical`；writer/action scope 与 decommission 仍不在本次范围。
- 用户随后从明确命名的 production order selector 门禁继续。Fresh read-only preflight 确认 production `ACTIVE_HEALTHY`、49 migrations、manager v1 success、non-manager denial、authenticated-only ACL、48 security / 60 performance advisor baseline，以及 192 bookings/memberships、123 Reservations、135 Sessions、131 Parties、全部 mismatch 0、17/0/17/3 writer、7 FORCE RLS 和 `court_slots`-only Realtime。
- 设置 exact `VITE_RESERVATION_ORDER_READ_SOURCE=canonical` 后，[Pages run 33039738583](https://github.com/tujiaqi2002/badminton/actions/runs/33039738583) 从 `main@7eea58d` 成功部署 `index-BPOXxt2y.js`；production ref 1、staging ref 0，三个 manager canonical RPC path 均存在。
- 真实馆长 future-30 页面从 2 条 legacy Court rows / 2 改期 / 2 取消入口切为 2 张 canonical Reservation cards / 2 个“在排期中查看”，旧 inline actions 全部为 0。Schedule focus 命中 1 条当前 Reservation allocation；中英文 1280×720 与 390×844 手机均无 read error、横向 overflow 或 console error/warn，手机为单列且 action 约占 footer 91% 宽度。
- 切换后的 Supabase API logs 只出现 `admin_search_reservations` 的 8 POST + 1 OPTIONS，全部 HTTP 200；没有新的 `admin_search_bookings`。Postflight 与 preflight 完全相同，没有 migration、DB push、grant、writer、数据、Auth、Realtime、付款或计价变化。回退只需把 selector 设为 `legacy`/删除后重跑 Pages。完整记录见 [`docs/reservation-migration/phase-4b3-production-cutover.md`](./docs/reservation-migration/phase-4b3-production-cutover.md)。下一门禁是另建并确认 Phase 4C aggregate writer/action scope；Phase 5 decommission 仍更晚。
- Evidence Draft PR [#160](https://github.com/tujiaqi2002/badminton/pull/160) 已在 initial commit `0df9d85` 创建，merge state CLEAN。[CI run 33040401346](https://github.com/tujiaqi2002/badminton/actions/runs/33040401346) 完整通过 PostgreSQL migration/concurrency、Reservation read、lint 与 build；唯一 annotation 是 `pnpm/action-setup@v4` 内部 Node 20 target 的平台弃用提示。Supabase Preview 因无 migration 正常跳过。PR 保持 Draft；合并会再次触发当前 canonical selectors 的 Pages deployment，需用户明确授权。

### Issue #153 / PR [#154](https://github.com/tujiaqi2002/badminton/pull/154) / evidence PR [#155](https://github.com/tujiaqi2002/badminton/pull/155)：Reservation Phase 4B.2 canonical selected-detail read（production canonical 已启用并验证）

- 用户已明确确认 Issue #153。范围只包括选中排期后的只读 canonical Reservation 详情、可回退 selector、staging 验证和 Draft PR；不改变数据库、writer/action scope、生产 selector 或 legacy decommission。
- 新 `VITE_RESERVATION_SELECTED_DETAIL_READ_SOURCE` 只有 exact `canonical` 才启用，缺失/未知值均回到 `legacy`。生产 workflow 缺省仍为 legacy；`.env.staging.example` 使用 canonical schedule + canonical detail 的成对组合。
- version 1 inspector ViewModel 从 `admin_get_reservation_detail(uuid)` 显式映射 selected allocation、effective Session/Reservation、Parties、Reservation/Session notes、付款汇总/计划和 lineage；identity、count、金额、currency、membership、引用或允许枚举不一致时 fail closed，不查询 legacy detail。
- 同一 Reservation 的场地/场次切换共享进行中请求或内存缓存，跨 Reservation 会 abort 旧请求；writer、undo/revert 与 `court_slots` Realtime 会失效缓存。缓存不进入 storage、日志或数据库。
- `badminton_stage` manager 已完成中英文桌面与 390×844 手机验证：9 月 7 日同一 Reservation 的 Court 1/Court 2 均显示 1 Session / 2 allocations、付款汇总、独立备注与 lineage；同 Reservation 两场地切换只新增一次 detail RPC，console error/warn 为 0，手机无横向 overflow。Before/After 位于 [`docs/screenshots/issue-153`](./docs/screenshots/issue-153)。
- hosted preflight 仍为 48 migrations、192 allocations、123 Reservations、Phase 4A mismatch 0；detail RPC 为 security invoker、空 `search_path`、authenticated 可执行、anon 不可执行，Realtime 仍只发布 `court_slots`。本阶段没有 migration、DB push 或数据 mutation。
- synthetic non-manager 页面门禁已通过：页面只显示未授权状态，没有馆长导航、排期或 canonical 详情卡，console error/warn 为 0；API 日志中本次登录只检查 `staff_members`，没有新增 `admin_get_reservation_detail`。最终本地 lint、production/canonical-staging build、diff check 与 PR PostgreSQL CI 均已通过。完整中英文设计与 staging 证据见 [`docs/reservation-migration/phase-4b2-canonical-selected-detail.md`](./docs/reservation-migration/phase-4b2-canonical-selected-detail.md)。
- 用户在明确的 merge/default-legacy 门禁后授权继续。PR #154 于 2026-08-26 10:19:28 UTC 合并为 `92c892c28bf5458f62f84bc977007b872f3e1014`；Pages [run 32957663853](https://github.com/tujiaqi2002/badminton/actions/runs/32957663853) build/deploy 全绿。生产 selected-detail variable 仍缺失并回退 `legacy`；真实馆长选择生产订单后 canonical detail 卡为 0、legacy notes 为 1，API logs 无 detail RPC，console error/warn 为 0。线上 asset 为 `index-wknub-uV.js`，production ref 1、staging ref 0。
- 部署前后生产 diagnostic 均保持 48 migrations、192/192 bookings/memberships、192 allocations、123 Reservations、所有 Phase 3B/4A mismatch 0、17/0/17/3 writer、7 FORCE RLS 与 `court_slots`-only Realtime。无 DB push、permission、writer、数据或 production detail cutover。完整发布证据见 [`docs/reservation-migration/phase-4b2-default-legacy-production-verification.md`](./docs/reservation-migration/phase-4b2-default-legacy-production-verification.md)。
- PR #155 随后以 `a16e5f6` 合并，default-legacy Pages run 32959334591 全绿。用户在明确的下一门禁后授权 production canonical selected-detail cutover；fresh preflight clean 后设置 exact `canonical`，Pages [run 32961018071](https://github.com/tujiaqi2002/badminton/actions/runs/32961018071) 从同一 `main` 成功部署 `index-DLJKKuT_.js`，production ref 1、staging ref 0、detail RPC 1。
- 真实馆长观察显示 canonical v1 ready 卡 1、error 卡 0、中英文契约对应的 7 个业务区块完整；同一 3 Session / 3 allocation Reservation 的 sibling Court 切换保持同一 reference 且不新增 POST，跨 Reservation 才新增请求。三个 Reservation 共 3 POST + 1 OPTIONS，全部 HTTP 200；console error/warn 0。Authenticated non-manager 在 read-only transaction 被拒绝，anon 无 EXECUTE。切换后 diagnostic 完全不变。生产现保持 canonical schedule/capacity + canonical selected detail；order/search、writer/action、客户路径和 decommission 仍未切换。完整证据见 [`docs/reservation-migration/phase-4b2-production-cutover.md`](./docs/reservation-migration/phase-4b2-production-cutover.md)。

### Issue #148：Reservation Phase 4B.1 canonical schedule/capacity（production canonical 已启用并验证）

- 用户在 default-legacy verification 后明确授权有回退路径的 production canonical schedule/capacity cutover；授权不包含 Phase 4B.2 detail/action、DB 变化或 legacy decommission。
- 已建立 `.env.staging.local` ignored config 与无凭据 `.env.staging.example`。本地 password entry 同时要求 staging flag、staging environment、Supabase project-ref 精确匹配和 loopback hostname；任一不满足都 fail closed 到现有 magic-link 登录。
- exact `canonical` 才启用新 source；缺失/未知值回到 legacy。统一 version 1 schedule view model 分离 physical allocation、effective Reservation/Session 与 legacy source trace；缺失/重复 identity fail closed，不从客户资料或时间猜测归属。
- canonical 请求使用 venue timezone、复合 keyset pagination、AbortController 和 request identity。读取失败时排期/容量显示持久错误并隐藏网格，不静默回落或伪装为全空；order search 仍独立使用 legacy `admin_search_bookings`。
- 中英文桌面和 390×844 手机验证均正确显示 9 月 7 日 Court 1/Court 2 两条 allocation 与剩余 3 片容量。API 日志记录 10 次 canonical schedule RPC / HTTP 200，本轮直接 `/rest/v1/bookings` 排期读取为 0。
- hosted diagnostic 仍为 48 migrations、192 allocations/memberships、123 Reservations、全部 Phase 3B/4A mismatch 为 0；17/0/17/3 writer、7 张 FORCE RLS 与 `court_slots`-only Realtime 未漂移。
- bundled Node `v24.19.0` / pnpm `11.19.0` 下 82 tests 为 81 pass、1 个明确的 no-local-PostgreSQL skip、0 fail；lint 与 production/canonical-staging build 均通过。完整中英文设计与证据见 [`docs/reservation-migration/phase-4b1-canonical-schedule.md`](./docs/reservation-migration/phase-4b1-canonical-schedule.md)。
- PR [#149](https://github.com/tujiaqi2002/badminton/pull/149) 于 13:13:04 UTC 合并为 `560ecdc2d738b6bc42d03421e781ba73adac249c`；Pages [run 32852015723](https://github.com/tujiaqi2002/badminton/actions/runs/32852015723) build/deploy 成功。线上 `index-B_GCKKvu.js` 中 canonical allocation RPC、staging project ref 和 source flag 均为 0；实际页面正常且 console error/warn 为 0。上线后生产 diagnostic 仍 clean。完整发布证据见 [`docs/reservation-migration/phase-4b1-default-legacy-production-verification.md`](./docs/reservation-migration/phase-4b1-default-legacy-production-verification.md)。
- PR [#151](https://github.com/tujiaqi2002/badminton/pull/151) 增加唯一 Pages selector 与 `legacy` fallback regression test，于 14:22:23 UTC 合并为 `6157f7a`。variable 缺失时 [run 32859078691](https://github.com/tujiaqi2002/badminton/actions/runs/32859078691) 仍部署 legacy artifact；随后 exact `canonical` 的 [run 32859184175](https://github.com/tujiaqi2002/badminton/actions/runs/32859184175) 成功部署 `index-CvTu7GmI.js`，包含 1 个 canonical RPC、0 staging ref、1 production ref。
- 真实馆长会话验证三个排期窗口与两个容量周，无读取错误，console error/warn 为 0。切换后 API logs 为 8 次 canonical POST + 1 次 OPTIONS，全部 200；post-cutover diagnostic 仍为 48 migrations、192/192、123、0 mismatch、17/0/17/3、7 FORCE RLS 与 `court_slots`-only Realtime。当前 variable 保持 canonical；回退为设 legacy/删除后重跑 workflow，不需要 DB rollback。完整中英文证据见 [`docs/reservation-migration/phase-4b1-production-cutover.md`](./docs/reservation-migration/phase-4b1-production-cutover.md)。

### Issue #142：Reservation Phase 4A.3 production shadow observation（已完成并恢复默认关闭）

- PR [#146](https://github.com/tujiaqi2002/badminton/pull/146) 于 2026-08-25 10:51:36 UTC 合并为 `a205e4a25e2d71d16c13b1e3dc0e4a02b7a31225`。合并后的默认关闭 Pages [run 32839332729](https://github.com/tujiaqi2002/badminton/actions/runs/32839332729) 成功，GitHub Actions 中没有 shadow variable，线上 `index-ssrRc0gW.js` 不含 shadow event/RPC。
- 用户在明确排除默认 read/UI cutover、写入变化、Phase 4B/4C 和 legacy decommission 后授权短时生产观察。临时设置 `VITE_RESERVATION_READ_SHADOW=true` 后，Pages [run 32839524612](https://github.com/tujiaqi2002/badminton/actions/runs/32839524612) 成功部署同一 `main` commit；线上 `index-Dt7sI6uM.js` 确认包含 feature-on shadow path。
- 已登录馆长会话依次验证当前、前一周、返回当前和后一周四个排期窗口。浏览器产生 4 个 `info` 级别 `reservation_read_shadow_v1` clean event；Supabase API 日志确认 `admin_list_reservation_allocations` 与 `admin_get_reservation_read_shadow_status` 各 4 次 POST，全部 HTTP 200。证据不包含客户资料、备注、ID 或 sample details。
- 观察后 Phase 4A diagnostic 仍为 48 migrations、192 bookings/memberships、192 canonical allocations、123 Reservations，Phase 3B shadow/session/payment/incomplete-operation 和 Phase 4A read mismatch 全部为 0；17/0/17/3 writer boundary、7 张 FORCE RLS 表与 `public.court_slots`-only Realtime 均未漂移。
- 观察完成后立即删除 feature variable。Pages [run 32839948133](https://github.com/tujiaqi2002/badminton/actions/runs/32839948133) 成功恢复默认关闭 artifact；线上重新引用 `index-ssrRc0gW.js`，shadow event/RPC 均为 0 次出现。Legacy bookings 全程是唯一渲染来源，没有 DB push、mutation、付款/计价、Auth 或 Realtime 变化。
- 完整中英文证据见 [`docs/reservation-migration/phase-4a3-production-shadow-observation.md`](./docs/reservation-migration/phase-4a3-production-shadow-observation.md)。下一步是另行起草并确认 Phase 4B 默认排期读取切换；当前没有切换 schedule/order/detail，也没有授权 legacy decommission。

### Issue #142 / PR #145：Reservation Phase 4A.2 frontend adapter / shadow fetch（已合并并部署；shadow 仍默认关闭）

- 用户在 Phase 4A.1 完成后明确确认继续 Phase 4A.2；实现分支为 `codex/reservation-phase-4a2-shadow-adapter`，基于 `origin/main` / `9a296de` 创建。初始实现 commit 为 `69042ce`。用户随后在 fresh merge gate 后明确授权 Ready + merge + 默认关闭的 Pages 部署；PR [#145](https://github.com/tujiaqi2002/badminton/pull/145) 于 2026-08-25 10:36:34 UTC 合并为 `ea3e6a80afcec64736a54b2bba65f0936f7e9ab8`。没有新增或修改 Supabase migration。
- 新增显式 version 1 的 frontend canonical DTO/normalizer，覆盖 allocation schedule、Reservation summary/search/detail 与 PII-free shadow status；legacy booking schedule row 可转换到同一个 allocation DTO。Legacy 无法证明的 effective ownership 保持 `null`，不会从姓名、电话、group/link 或时间猜测。
- 新增默认关闭的 `VITE_RESERVATION_READ_SHADOW`。只有已验证的馆长排期路径且值精确为 `true` 时，旧排期读取成功后才 shadow-fetch canonical allocations 与数据库 shadow status；旧 booking rows 仍是页面唯一渲染来源，loading/toast/mutation/客户读取均不受 shadow 结果影响。
- 实时 client comparison 只覆盖两边同粒度的 Court allocations；旧 booking search 与 canonical Reservation search 粒度不同，不做会产生假告警的逐行比较。Order/detail 默认切换仍属于 Phase 4C。
- Shadow schedule 使用 venue timezone、`(starts_at, allocation_id)` keyset pagination、重复/缺失 cursor 与 page-limit fail-closed 保护；新读取会取消上一轮未完成请求。日志只输出固定事件、count/code/totals，错误只输出安全 code，不记录姓名、邮箱、电话、备注、ID 或数据库 sample details。
- 本地 bundled Node `v24.19.0` / pnpm `11.19.0` 已通过 14/14 adapter/fixture/privacy/pagination tests；既有 Reservation suite 为 33 tests / 32 pass / 1 个无本地 PostgreSQL 的明确 skip；全量 lint 与 production build 通过，build 只有既有 >500 kB chunk warning。Production/staging 远端 history 复核仍精确为 48 个 migrations，最新均为 Phase 4A.1 read contract。
- 浏览器在 default-off / demo manager path 完成桌面和 390×844 手机检查：排期、订单统计/筛选、日期切周和手机底栏正常，console 无 error/warn，`reservation_read_shadow_v1` 日志为 0，证明默认关闭不发送 shadow 请求。因为本阶段没有任何可见 UI 改动，不产生伪造的 Before/After 差异图；实际 desktop/mobile 页面已人工比对。
- 最终 merge-head CI [run 32837678041](https://github.com/tujiaqi2002/badminton/actions/runs/32837678041) 在 Node `v22.23.2` / pnpm `11.16.0` / PostgreSQL 16 下成功：既有 Reservation migration/concurrency 33/33、frontend adapter 14/14、0 skip，lint/build 全绿；Supabase Preview 因无 migration 正常跳过。
- 合并后的 Pages [run 32838082873](https://github.com/tujiaqi2002/badminton/actions/runs/32838082873) build/deploy 全绿。线上首页返回 200，并引用该 run 产出的 `index-ssrRc0gW.js`；线上 bundle 中 `reservation_read_shadow_v1` 与 `VITE_RESERVATION_READ_SHADOW` 字面量均为 0，证明缺省 `false` 已在生产构建中裁剪，不会发送 shadow RPC。GitHub Actions 中没有该变量，workflow fallback 仍为 `false`。
- 完整中英文设计与回退说明见 [`docs/reservation-migration/phase-4a2-frontend-shadow-adapter.md`](./docs/reservation-migration/phase-4a2-frontend-shadow-adapter.md)。合并没有生产 DB push、默认 read/UI cutover、Stripe、Realtime 或 legacy decommission；production 与 `badminton_stage` 均仍为 48 migrations。后续 Phase 4A.3 已在单独授权下完成短时生产观察并恢复默认关闭。

### Issue #142 / PR #143：Reservation Phase 4A.1 manager read contract（已合并并完成生产验证；UI 未切换）

- 用户在 fresh 只读门禁后明确授权合并 PR #143 与生产 migration 48；授权不包含 Phase 4A.2 前端 adapter、默认 read/UI cutover、Stripe 或 legacy decommission。PR 于 2026-08-25 09:41:17 UTC 合并，merge commit `3db78f8d8c2b2eec58e137a57ff2f2ec5bbab61c`；Supabase integration 于 09:41:55 UTC 应用第 48 个 migration。
- `20260825091608_reservation_phase_4a_manager_read_contract` 新增两个 `security_invoker` v1 view、四个 manager-only `SECURITY INVOKER` RPC、PII-free mismatch view、owner-only assertion 和排期窗口索引；没有修改业务数据、client DML 或 Realtime publication。
- 生产 diagnostic 返回 `phase_4a_manager_read_contract_verified`：48 migrations、192 bookings / memberships、192 allocation rows、123 Reservation summaries，Phase 3B shadow/session/payment/incomplete-operation 与 Phase 4A mismatch 均为 0；writer boundary、7 张 FORCE RLS 表和 `court_slots`-only Realtime 均未改变。
- 真实生产角色验证确认馆长排期/搜索/详情/shadow 成功，authenticated 非馆长返回 `Manager access required`，anon permission denied。三个 view 均为 security-invoker；四个 RPC 均为 invoker、空 `search_path`、authenticated-only entry，private assertion 对所有 client role 无 EXECUTE。
- 详情一次返回 Parties/roles、Sessions/allocations、payment shares/ledger 与 lineage，并确认不含 provider reference、idempotency key 或 `auth_user_id`。排期与搜索继续使用复合 keyset cursor，不形成 application N+1。
- 生产 query plan 使用 `reservation_sessions_admin_window_idx`（约 0.134 ms）与 `reservation_allocation_memberships_effective_idx`（约 3.94 ms）。上线后 advisors 为 48 security（2 INFO / 46 WARN）和 60 performance INFO（全部 `unused_index`，0 unindexed FK），没有 Phase 4A 新安全 regression。
- 最终 [Actions run 32832792480](https://github.com/tujiaqi2002/badminton/actions/runs/32832792480) 在 Node `v22.23.2` / pnpm `11.16.0` / PostgreSQL `16.15` 下为 33/33、0 skip；合并后的 [Pages run 32833288305](https://github.com/tujiaqi2002/badminton/actions/runs/32833288305) build/deploy 成功。完整中英文设计与证据见 [`docs/reservation-migration/phase-4a-manager-read-contract.md`](./docs/reservation-migration/phase-4a-manager-read-contract.md)。
- 当前 UI 仍使用 legacy read path；新 API 是已安装但尚未被默认产品消费的 foundation。Phase 4A.3 已完成四窗口 clean observation 并验证回退，开关现已恢复关闭；下一步默认 schedule adoption 仍需另行起草与确认。

### Issue #139 / PR #140：Phase 3B.2 zero-price activation recovery（已合并并完成生产验证）

- 用户在 fresh read-only preflight 后明确授权 PR #140 merge 与生产 migrations 45–47。PR 于 2026-08-25 08:23:38 UTC 合并，merge commit `1499cf4da939e6d0e00b7eec9bb2380c65c3b32e`；Supabase integration 于 08:25:06–08:25:07 UTC 顺序应用 migrations 45、46、47，production history 精确推进到 47。
- 上线后 Phase 2、Phase 3A 与 Phase 3B.2 diagnostics 全部通过：123 Reservations、135 Sessions、192 bookings / 192 memberships、131 Parties、23 Payments、26 allocation entries / CAD 1,642.00；shadow、Session projection、payment 与 incomplete-operation mismatch 均为 0。
- 唯一零价 booking 继续保持 `total_amount=0`、`pay_at_venue`、0 Payment、0 allocation、0 refund；系统没有修改客户事实或伪造 CAD 0 receipt。Recovery assertion 已在生产收敛为修正版，仍是 private security-invoker、空 `search_path`、owner-only EXECUTE。
- Production writer boundary 已切换为 17 public entries / 0 public direct legacy writers / 17 private legacy delegates / 3 wrappers；7 张 Phase 3B 表均 RLS + FORCE RLS，client direct DML/private helper EXECUTE 为 0，Realtime 仍只有 `public.court_slots`，Edge Functions 为 0。
- 显式-primary merge RPC 已存在，anon 无 EXECUTE，authenticated/service_role 入口立即调用 `private.require_manager()`；它是有意保留的 manager-only SECURITY DEFINER API。生产 advisors 为 48 security（2 INFO / 46 WARN）和 67 performance INFO（全部 `unused_index`，0 `unindexed_foreign_keys`）。
- Recovery CI [run 32824013095](https://github.com/tujiaqi2002/badminton/actions/runs/32824013095) 在 Node 22 / pnpm 11.16.0 / PostgreSQL 16 下为 28/28、0 skip；合并后的 [GitHub Pages run 32826377671](https://github.com/tujiaqi2002/badminton/actions/runs/32826377671) build/deploy 成功。该阶段只激活数据库写入路径；read/UI、Stripe 与 legacy decommission 仍未授权。

### Issue #136 / PR #137：Reservation Phase 3B.2 atomic writer activation（已合并；首次回滚，后由 #140 恢复上线）

- #137 最初从 #135 head 叠加；随后整理到最新 `main` 并完成 staging/CI/production read-only preflight。用户后来明确授权合并，PR 于 07:16:55 UTC 进入 `main`，首次自动数据库部署按上述 #139 记录原子回滚；PR #140 修复并于 08:25:07 UTC 成功完成生产 activation。
- 第 45 个 append-only migration 在单一事务中原子激活全部 17 个 direct writer：既有 public signature 保持不变，旧定义冻结到 private legacy delegate，新 public entry 在调用 Phase 3B primitive 前先校验客户/馆长权限。3 个 wrapper 继续只间接委托，不形成旁路。
- activation 新增 append-only `reservation_session_assignments`，显式记录 physical/effective Session 投影变化；merge/split/reverse 继续以 transition、Party lineage 和 versioned membership 表达当前商业归属，不改写 booking origin。
- 新 manager-only `admin_link_booking_groups_with_primary(...)` 支持不同客户显式选主联系人，并选择 `single_payer` / `split_equal` / `split_custom`；旧双参数 link 只在 primary 唯一无歧义时兼容，不从姓名、电话或时间自动猜测。
- legacy “标记已付”现在在同一事务内追加 Payment/allocation ledger；已付改回未付通过追加 refund 表达，不删除或改写原付款历史。排期、资料、取消、关系和撤回都在同一事务中验证 aggregate + legacy projection + audit postconditions。
- 第 46 个 performance-only follow-up 为 8 个 composite FK 补齐与声明列顺序一致的索引；staging performance advisor 的 `unindexed_foreign_keys` 已从 8 降为 0。剩余项均为 INFO `unused_index`，其数量会随实际测试使用统计变化，不根据 fresh synthetic 流量删索引。
- hosted activation 后诊断返回 `phase_3b_atomic_writer_activation_verified`：46 个 migration、192/192 membership、0 shadow/session/payment drift、0 incomplete operation、7 张 Phase 3B public table 全部 FORCE RLS，client DML/private helper EXECUTE 为 0，Realtime 仍只有 `public.court_slots`。writer 边界为 17 public entries / 0 public direct legacy writers / 17 private legacy delegates / 3 wrappers。
- hosted writer matrix 覆盖 17 个 direct writer、显式 primary、权限拒绝、幂等重试与晚回滚；外层事务回滚后 staging 持久数据回到 192 memberships 且诊断仍 clean。多连接 contention 已验证 same-key payment、同 booking 竞争排期与重叠 merge scope；Phase 3B.1 CI 继续覆盖真实 committed-winner 的 Payment/AA/refund races。
- emergency rollback artifact 已在真实激活的 staging 中使用外层 transaction 完整执行：内层恢复 17 public legacy writers，保留所有 append-only history；外层 rollback 后 staging 回到 activated 状态且数据无污染。
- Phase 3A 旧诊断已向前兼容：未激活时仍校验 17 direct writers，激活后则校验 17/17/3 边界；Phase 2 使用相同 synthetic staging fingerprints 专门化后，与 Phase 3A hosted diagnostic 均在激活后通过。原样 Phase 2 diagnostic 会按设计对生产冻结指纹 fail closed，不代表 staging 数据漂移。
- #137 合并前通过非破坏性 merge 提交 `693ca38` 整理到最新 `main`；本地使用 bundled Node `v24.19.0` / pnpm `11.19.0` 得到 25/26 pass（1 个无本地 PostgreSQL 的明确 skip）、lint/build 通过；[Actions run 32819898640](https://github.com/tujiaqi2002/badminton/actions/runs/32819898640) 在固定 Node 22 / pnpm 11.16.0 / PostgreSQL 16 下为 26/26、0 skip，lint/build 全绿。
- 07:04–07:05 UTC fresh revalidation：production 为 44 migrations 且 Phase 3B.1 inactive；staging 为 46 migrations。Production advisors 为 47 security（2 INFO / 45 WARN）和 62 performance INFO（4 unindexed FK + 58 unused）；staging security 为 50（2 INFO / 48 WARN），performance 在 writer matrix 前后由 62 变为 60 个 `unused_index` INFO，`unindexed_foreign_keys` 始终为 0。旧文档的 staging security 49 少计了 activation 新增的显式-primary manager RPC definer warning；现场复核确认该 RPC 固定空 `search_path`、先调用 `private.require_manager()`、匿名无 EXECUTE、仅 `authenticated` / `service_role` 可执行，因此是预期且受控的 manager entry 提示。
- 合并前 production read-only preflight 全部通过；合并后的首次自动部署失败也证明最终 assertion 会 fail closed 并整笔回滚。后续 Issue #139 / PR #140 已完成 recovery 与成功生产 activation。

### Issue #134 / PR #135：Reservation Phase 3B.1 inactive transaction kernel（历史安装记录；现已由 Phase 3B.2 激活）

- 用户在 2026-08-25 fresh preflight 后明确确认只合并 #135。PR 于 06:24:23 UTC 合并，Supabase GitHub integration 于 06:25:04 UTC 成功将 migrations 43–44 应用生产。这一授权不包含 #137 activation、read/UI cutover、Stripe 或 legacy decommission。
- 本地第 43 个 migration 草案新增 append-only merge/split/reverse lineage、当前 effective allocation membership、private idempotency journal、Payment/refund 与 schedule/details/cancel primitives，以及 17 direct writers + 3 wrappers + 2 undeployed Stripe paths 的 fail-closed inventory；第 44 个 append-only follow-up 把 inventory signature 固定为 `C` collation，消除 hosted Supabase 中 catalog signature 与 ICU 默认排序不同造成的误报。
- merge/split 保留 `bookings.reservation_id` 作为不可变物理 Reservation 来源；`booking.session_id` 继续承担该 origin 内的 legacy 排期投影，当前商业归属由 versioned membership 解析。Party lineage 支持 one-to-many 和 many-to-one，reverse 追加新 transition、不删除历史，并把后续 Session 修改带回 restored scope。
- 为支持不同 origin 合并后的一人付清，payment allocation 的 booking FK 草案改为单列 `booking_id`；private payment primitive 仍验证 effective Reservation、currency、payer、余额和完整 scope。一次付清、AA 与退款共用 append-only Payment/allocation ledger。
- migration 安装时不执行 catch-up、不产生 transition/membership/operation rows，不新增 public mutation、booking dual-write trigger、client DML 或 Realtime publication；现有 public function fingerprint 保持不变。
- hosted staging 证明 raw function fingerprint 会受 collation、换行和纯格式化差异影响，不能跨环境直接比较：此前 `a28b...` 来自 ICU/default ordering，生产按 `C` ordering 为 `ac236...`，staging replay 则有本地 raw 值。Phase 3B gate 继续严格比较 17 direct / 3 wrapper 的 canonical signature 集合、函数安全配置和 grants；raw fingerprint 只用于同一数据库内的 fresh drift review。
- 当前新增的 Phase 3B.1 isolated tests 已覆盖 inactive install、幂等接入、schedule/details/cancel 与 rollback、不同客户 merge + 显式 primary、Party lineage、一人/AA/退款、已付款 split、merge/split reverse、permission denial、writer drift fail-closed 和 read-only diagnostic。
- 最终 bundled Node `v24.19.0` / pnpm `11.19.0` 本地验证为 46 tests 通过、0 fail、1 个 real-PostgreSQL concurrency test 因本机无服务明确 skip；lint、build 通过，build 只有既有 >500 kB chunk warning。真实并发仍由 PostgreSQL CI 门禁执行。
- PR #135 merge 前的首轮 `reservation-db-tests` 已在固定 Node 22 / pnpm 11.16.0 与 PostgreSQL 16 service 上通过：22/22 tests、0 fail、0 skip，lint 与 build 同时通过。三个真实连接证明相同 idempotency Payment 只落一笔、两笔重叠 AA 不超额、全额 refund race 只有一个 winner 且失败事务不遗留 `started` journal。证据为 [Actions run 32746853283](https://github.com/tujiaqi2002/badminton/actions/runs/32746853283)。这些证据随后与 hosted staging、fresh production preflight 一起满足 #135 的 merge 门禁；#137 activation 仍需重新执行独立门禁。
- 2026-08-24 15:57 UTC fresh production preflight：PR base 与 `origin/main` 同为 `598556a`，分支 0 behind / 2 ahead 且 mergeable clean；远端仍为 42 migrations、最新 Phase 3A，Phase 2/3A diagnostics 均通过。192/192 bookings owned，123 Reservations、135 Sessions、131 Parties、23 Payments、26 allocations/CAD 1,642.00，shadow mismatch/catch-up 为 0，审计仍为 1,739；Realtime 仍只发布 `court_slots`，现有 payment booking FK 仍为 validated composite baseline。Advisors 保持 47 security（2 INFO / 45 WARN）与 40 performance INFO。
- 用户建立并明确授权初始化独立 `badminton_stage` 后，已从首个 migration 前的 Git schema 恢复历史基线，原样重放 migrations 1–38、使用 192 条/131 group 的纯合成 fixture 专门化 Phase 2 的四个数据指纹，再原样应用 Phase 3A/3B.1 与第 44 个 collation follow-up；staging migration history 已精确对齐仓库 44 个 version/name。
- Hosted PostgreSQL 17.6 上 Phase 2、Phase 3A、Phase 3B.1 diagnostics 全部通过：123 Reservations、135 Sessions、192 Court allocations、131 Parties、23 Payments、26 allocations/CAD 1,642.00、0 shadow mismatch；3B kernel 保持 0 operation / 0 membership / 0 transition，17 direct / 3 wrapper inventory、0 client mutation、0 dual-write trigger、0 新 Realtime 表。27 张 public 表全部 RLS，6 张 3B 表全部 FORCE RLS，client DML/private helper EXECUTE 均为 0。
- staging advisors 当时为 49 security（生产既有 47 + 项目自带 `rls_auto_enable()` 的 2 条已记录 WARN）和 74 performance INFO。4 条 composite-FK 提示均已有等价覆盖索引或唯一 `booking_id` 主键，不新增重复索引；其余 70 条是 fresh synthetic stage 的 `unused_index`。Production-like hosted apply 门禁已完成；follow-up [Actions run 32753722730](https://github.com/tujiaqi2002/badminton/actions/runs/32753722730) 在 PostgreSQL 16.15 上为 22/22、0 fail、0 skip，真实 same-key/AA/refund races、lint、build 均通过。这是 #135 merge 前的历史证据；#137/#140 后续已按独立门禁完成 activation。
- 详细中英文设计见 [`docs/reservation-migration/phase-3b-inactive-transaction-kernel.md`](./docs/reservation-migration/phase-3b-inactive-transaction-kernel.md)，只读验证脚本为 [`supabase/diagnostics/phase_3b_inactive_transaction_kernel.sql`](./supabase/diagnostics/phase_3b_inactive_transaction_kernel.sql)。
- Phase 3B.1 初次上线后的 diagnostics 全部通过：123 Reservations、135 Sessions、192/192 owned Court allocations、131 Parties、23 Payments、26 allocations / CAD 1,642.00，shadow mismatch 为 0。Kernel 当时精确为 `inactive`，operation / membership / transition 均为 0。
- 当时 writer/security boundary 为 17 direct / 3 wrapper，direct fingerprint `ac236997585da13cc6cc0439b8eafcf0`，wrapper fingerprint `d1eb5d63d36f01f1caad2e4e9e516dbf`；0 client mutation function、0 booking dual-write trigger、0 张 Phase 3B 表进入 Realtime。现状以 #139/#140 的 17/0/17/3 activated boundary 为准。
- 当时生产 security advisor 为 47（2 INFO / 45 WARN），performance advisor 为 62 INFO：4 个已知 composite-FK column-order 提示 + 58 `unused_index`。Migrations 45–47 上线后，ordered indexes 已把 `unindexed_foreign_keys` 清零；当前 advisor 结果见 #139/#140 小节。
- GitHub Pages [Actions run 32816825670](https://github.com/tujiaqi2002/badminton/actions/runs/32816825670) 的 build/deploy 全部通过；前端代码与产品行为没有切换。

### Issue #128：Reservation migration Phase 3A compatibility foundation

- Parent design：`https://github.com/tujiaqi2002/badminton/issues/118`；Phase 3 Issue：`https://github.com/tujiaqi2002/badminton/issues/128`，已获得用户确认开始实现。
- PR #129 于 2026-08-24 12:59:02 UTC 合并；Supabase integration 于 12:59:44 UTC 成功应用第 40 个 migration，GitHub Pages build/deploy 也通过。没有执行 catch-up、启用 dual-write、切换读取或修改前端。
- 生产 routine catalog 交叉核对到 17 个直接写 `public.bookings` 的函数，另有 3 个 wrapper 与 2 个未部署 Stripe Edge write path。Phase 3B 必须逐条纳入 writer coverage，不能依赖前端补偿。
- Phase 1 的 Session 时间投影 trigger 会立即拒绝 owned booking 的 legacy-only 排期修改。Phase 3A 不削弱此约束；排期 writer 必须在 Phase 3B 用同一事务、固定锁顺序同步 Session 与 allocation。
- private catch-up 只处理安全、可确定的 legacy group；已拥有不同 Reservation 后再 link/unlink、结构性 merge/split 或账务漂移一律 fail-closed 并进入 mismatch diagnostics，不猜测关系或付款历史。
- manager-only shadow view/RPC 明确使用 security-invoker 与最小 grants；private helper 不向 client roles 开放。ownership-only 更新保持 legacy `updated_at` 和 `court_slots` Realtime projection 不变。
- 上线后 postgres/admin diagnostic 在修正 writer inventory 范围后返回 `phase_3a_reservation_compatibility_verified`：192/192 bookings owned、123 Reservations、135 Sessions、131 Parties、23 Payments、26 allocations/CAD 1,642.00，shadow/session/payment drift 均为 0；catch-up audit events 为 0，legacy booking、court slot 和 payment audit 指纹不变，advisors 仍为既有 47/40。
- authenticated 实际角色测试发现 shadow view/RPC 无法读取 RPC-only `venue_settings.timezone`，返回 `42501`。不能开放整张配置表；第 41 个 follow-up migration 只增加 manager SELECT policy 与 `timezone` 单列 grant，其他配置和操作继续 RPC-only。
- 初始 diagnostic 把新的 private catch-up helper 误计入 17 个 legacy public writers；脚本已限定为 `public` writer inventory，并继续单独验证 private helper 无 client EXECUTE。
- PR #130 于 2026-08-24 13:17:23 UTC 合并；Supabase integration 于 13:18:16 UTC 成功应用第 41 个 migration。未修改的 Phase 2/3A diagnostics、authenticated 馆长/非馆长角色测试和冻结指纹全部通过；数据仍为 192/192 owned bookings、123 Reservations、135 Sessions、131 Parties、23 Payments、26 allocations/CAD 1,642.00，shadow mismatch/catch-up events 均为 0。
- 上线后 security advisor 仍为既有 47 条；performance advisor 从 40 INFO 变成 40 INFO + 1 WARN。新增 `multiple_permissive_policies` 精确来自既有 `venue_settings_rpc_only FOR ALL false` 与 manager SELECT policy 的重叠，功能仍安全，但不接受为新基线。
- Issue #131 的第 42 个最小 migration 在 fail-closed 验证 RLS/FORCE RLS、单列 grant、无 authenticated table/DML grants 和两条既有 policy 后，只删除冗余 `venue_settings_rpc_only`。无适用 DML policy 时 RLS 默认拒绝，且 client 仍无 DML grants；其他配置字段和 writes 继续 RPC-only。
- 14 项 Phase 2/3A 隔离集成测试已通过，包括 policy consolidation、authenticated DML grant drift 在 drop 前失败并回滚、timezone column-only grant、真实 manager/non-manager 权限路径、幂等 catch-up、客户身份冲突、unsafe link 与付款漂移。
- 用户在 fresh production preflight 后明确授权 merge/生产部署；PR #132 于 2026-08-24 13:47:59 UTC 合并，Supabase integration 于 13:48:37 UTC 应用第 42 个 migration，GitHub Pages build/deploy 于 13:48:36 UTC 成功完成。
- 上线后 Phase 2 与 Phase 3A diagnostics 均通过；真实 authenticated 馆长可读 `America/Toronto` 与 clean shadow status，非馆长看到 0 rows 且 summary RPC 返回 `Manager access required`。`venue_settings_rpc_only` 已不存在，manager SELECT 是唯一 policy；authenticated 仍只有 `timezone` 单列 SELECT、无 table/DML grant 或 DML policy。
- 数据与权限边界无漂移：192/192 bookings owned、123 Reservations、135 Sessions、131 Parties、23 Payments、26 allocations/CAD 1,642.00，shadow mismatch/catch-up events 为 0，审计总数 1,739、17 个 legacy public writers、仅 `court_slots` Realtime 和四个冻结指纹全部不变。
- Security advisor 保持既有 47 条；performance advisor 已从 40 INFO + 1 WARN 恢复为 40 INFO，`multiple_permissive_policies` regression 消失。Phase 3B.1 已在独立分支开始未激活内核 authoring，但生产仍没有执行 catch-up、dual-write 或 read cutover；legacy RPC/字段退役仍属于 Phase 5，需 Phase 4 cutover、生产观察和 rollback window 结束后另开高风险 Issue。

### 已完成生产基线：Issue #123 Phase 2 deterministic backfill

- Parent design：`https://github.com/tujiaqi2002/badminton/issues/118`；Phase 2 Issue：`https://github.com/tujiaqi2002/badminton/issues/123`。
- Phase 0 / PR #120、Phase 1 / PR #122 和 Phase 2 / PR #126 均已合并；第 39 个 migration 已进入生产 history。
- Supabase GitHub integration 在 PR #126 合并到 `main` 后自动运行 protected-branch deployment，于 2026-08-24 04:46:10 UTC 应用 Phase 2；不是本地手动 `db push`。
- 权限：9 张新 public 表均 RLS + FORCE RLS；authenticated 只有 manager-only SELECT，anon/service_role 无 direct grants，没有新 public RPC 或 Realtime publication。
- 账务真实性：正常 Payment 必须有真实 `occurred_at`；仅 `legacy_reconciliation` 可为 null，避免为缺少付款审计的历史 paid rows 虚构时间。
- 当前生产行为仍使用 legacy group/link/recurrence/payment 与旧 RPC；Phase 2 只回填已有 snapshot，没有 dual write、read cutover 或前端切换。
- Phase 2 生产诊断结果为 `phase_2_reservation_backfill_verified`：123 Reservations、135 Sessions、131 Parties、192 Court allocations、23 Payments、26 allocations，reconciled total 为 CAD 1,642.00。
- Toronto nonexistent/ambiguous DST、客户冲突、付款证据矛盾、UUID collision、over-allocation 和 late rollback 均已验证 fail-closed；两个独立数据库产生相同完整 mapping fingerprint。
- 上线后 security advisor 仍为 47 条既有 finding（2 INFO / 45 WARN），没有 Phase 2 新 finding；performance advisor 为 40 条 `unused_index` INFO，没有更高等级 finding。
- 当前 GitHub integration 会在 `main` merge 后自动应用 pending production migrations；后续 migration PR 必须把 merge 本身视为生产部署门禁，或先明确关闭自动部署，不能再假设 merge 后还可单独 dry-run/push。

### 最近合并

- PR #140 / Issue #139：Phase 3B.2 zero-price activation recovery，已于 2026-08-25 合并并由 Supabase integration 成功应用 migrations 45–47；生产 writer activation 与只读验收完成，read/UI 未切换。
- PR #138 / Issue #134：Phase 3B.1 production verification docs，已于 2026-08-25 合并；没有 migration 或产品行为变化。
- PR #135 / Issue #134：Phase 3B.1 inactive transaction kernel，已于 2026-08-25 合并并由 Supabase integration 应用 migrations 43–44；上线后 kernel 仍 inactive/zero-row，旧 writer/read/UI 未切换。
- PR #133 / Issue #128：Phase 3A production verification 文档与证据，已于 2026-08-24 合并；没有新增 migration 或改变生产行为。
- PR #132 / Issue #131：Phase 3A venue settings RLS policy consolidation，已于 2026-08-24 合并并由 Supabase integration 自动应用生产；advisor regression 已清除，权限与数据指纹无漂移。
- PR #130 / Issue #128：Phase 3A shadow timezone least-privilege access，已于 2026-08-24 合并并由 Supabase integration 自动应用生产；随后由 PR #132 完成独立门禁的 advisor policy consolidation。
- PR #129 / Issue #128：Reservation Phase 3A inactive compatibility foundation，已于 2026-08-24 合并并由 Supabase integration 自动应用生产。
- PR #127 / Issue #123：Phase 2 production verification 文档与证据，已于 2026-08-24 合并。
- PR #126 / Issue #123：Reservation Phase 2 deterministic backfill，已于 2026-08-24 合并并由 Supabase GitHub integration 自动应用生产；只读诊断和 GitHub Pages deployment 均通过。
- PR #124：Phase 1 production verification，已于 2026-08-23 合并。
- PR #125：My Bookings search/filter，已于 2026-08-23 合并。
- PR #122 / Issue #121：Reservation Phase 1 additive schema，已于 2026-08-23 合并；生产 schema 验证通过。
- PR #120 / Issue #119：Reservation Phase 0 baseline，已于 2026-08-23 合并。
- PR #117 / Issue #116：Drag Feedback / Schedule Side Panels，已于 2026-08-23 合并并成功发布。
- PR #111 / Issue #110：Remove redundant move scope note，已合并/关闭。
- PR #114 / Issue #113：Booking relationship popover outside-click dismissal，已合并/关闭。
- PR #115 / Issue #112：Booking detail payment controls polish，已合并/关闭。
- PR #90 / Issue #88：Drag Lock，已于 2026-08-20 合并/关闭。
- PR #93 / Issue #92：Multi-court Individual Move，已于 2026-08-20 合并/关闭。
- Issue #87：My Booking section redesign，已于 2026-08-21 关闭。

### 其他开放 Issue

| Issue | 目标 | Owner |
| --- | --- | --- |
| #84 | Activity log section refine | Tusu + Kevin |
| #85 | Remove Customer Booking Selection and Redesign Booking UI | Tusu + Kevin |
| #86 | Manager Booking page color design | Kevin |

这些 issue 有明显 UI 重叠，合并前需要指定每个 issue 的页面边界，避免同时修改 `styles.css`、`App.jsx` 或同一组件造成冲突。

### 本地进行中：Issue #87 My Booking section redesign

- 分支：`codex-my-bookings-search-filter`。
- 内容：客户“我的预订”列表改为扫描优先的订单卡片，突出日期、时段、场地、订单状态、支付状态、金额和下单时间；同时间多场地订单合并为一张可识别的多场地卡片；新增 Upcoming/Past/Cancelled tabs、搜索、折叠筛选、已应用筛选 chip 和按月分组，取消入口仍按单条 booking 沿用原有条件与回调。
- Supabase：不需要 schema、migration 或 RPC 变更。

## 5. 早期蓝图完成度

之前分享的预约系统蓝图分为 MVP、并发、日历、支付、通知、多租户、经营面板、CRM、AI 和 marketplace。Tiger 当前对应关系如下：

| 原蓝图阶段 | Tiger 现状 |
| --- | --- |
| MVP / availability / booking | 已完成，并远超最小范围 |
| 防重复预订 / transaction / locking | 已完成在数据库层 |
| Calendar/availability engine | 单馆版本已完成 |
| Payments / reservation hold | 仅骨架，未完成生产闭环 |
| Notifications / background jobs | 未完成 |
| Multi-tenant SaaS | 有意推迟；当前产品明确是单馆 |
| Business dashboard | 馆务中心、容量与订单查询已形成运营工作台 |
| Customer CRM | 会员查询与客户资料是轻量起点，尚非完整 CRM |
| AI scheduling assistant | 未开始 |
| Marketplace | 不在当前产品范围 |

这说明当前路线不是偏离，而是做了正确收敛：先把单馆高频运营打深。后续是否抽象为 SaaS，应等 Tiger 自身流程稳定并出现第二家真实场馆需求。

## 6. 主要风险

### P0：发布与数据安全

- 独立数据库 staging 已建立并完成 Phase 3B.1 hosted apply，但还没有自动 PR Preview 前端或每 PR 自动重建流程；UI reviewer 仍不能直接体验每个分支版本。
- Supabase GitHub integration 会自动部署 `main` 的 pending migrations；2026-08-24 PR #126 合并后约 38 秒即应用生产，越过了原计划的 merge 后 manual dry-run 门禁。未来必须在 merge 前完成 production baseline/dry-run/授权，或先关闭该自动部署集成。
- Phase 4B manager schedule/capacity、selected detail 与 order/search 均已在生产启用 canonical source；Phase 4C aggregate writer/action scope 尚未设计或授权，必须新建 Issue 并在涉及权限、付款、计价或数据库变更前由用户确认。
- 支付代码存在但未形成可证明的生产闭环，不能对客户宣称在线支付可用。
- Reservation 迁移会跨 schema、权限、计价、付款和审计；必须按 #118 的 Phase 0–5 逐步交付，禁止一次性替换 legacy 模型。

### P1：回归风险

- 已有 #93 引入的最小纯逻辑测试，但复杂排期行为仍主要依赖人工浏览器检查，尚缺集成与 E2E 覆盖。
- 关键组件过大且共享 CSS 集中，多人并行修改容易冲突和产生跨页面回归。
- 馆务配置影响多个页面和数据库，任何设置功能都需要跨表面验收。

### P2：产品复杂度

- 馆长排期已具备很多高级动作，继续加模式可能破坏“方便优先”。
- 7 套主题、多个订单 palette 和字体设置增加视觉测试矩阵。
- 客户流程保留在代码中但生产是 manager-only，两种访问策略容易被混淆。

## 7. 推荐的下一阶段

### Milestone A：团队开发基线（现在）

1. 建 PR Preview 或固定 staging URL，PR 附验收路径、截图/录屏。
2. 增加最小自动测试：时间区间、计价匹配、swap/overlap、颜色稳定哈希。
3. 将 `AdminSchedule`、`App` 的纯逻辑逐步抽出，避免大爆炸式重构。

### Milestone B：运营 Beta 稳定

1. 按清晰边界完成 #84–#86。
2. 建立关键回归清单：新增、移动、缩放、置换、关联、循环、取消、支付标记、历史锁定。
3. 对营业时间、活动、定价和开放窗口做跨页面 + 数据库回归。
4. 用真实馆长试用数据判断哪些高级操作应保留、隐藏或简化。

### Milestone C：决定客户公开上线

必须明确完成：普通客户 Auth 策略、支付是否上线、通知渠道、取消规则、隐私/条款、客服与运营流程。未完成这些决定前继续保持私有馆长试运行。

## 8. 当前不应做的事

- 不为了“看起来像平台”提前做多租户或微服务拆分。
- 不在没有第二家真实客户前抽象 marketplace。
- 不把 AI 功能置于排期正确性、预览环境和测试之前。
- 不在没有明确授权和未提交工作核对前清理旧 worktree；PR #90 已合并不等于自动授权清理。

## English update: Phase 4B.3 production canonical order/search active

After the default-legacy deployment was recorded in PR #159, the user continued from the separately named exact-canonical order-selector gate. A fresh read-only production preflight confirmed project health, 49 migrations, a manager v1 result, non-manager denial, authenticated-only ACL, the existing 48-security/60-performance advisor baseline, and unchanged 192 bookings/memberships, 123 Reservations, 135 Sessions, 131 Parties, zero mismatch, 17/0/17/3 writers, seven FORCE RLS tables, and `court_slots`-only Realtime.

Exact `VITE_RESERVATION_ORDER_READ_SOURCE=canonical` produced successful [Pages run 33039738583](https://github.com/tujiaqi2002/badminton/actions/runs/33039738583) from `main@7eea58d` and deployed `index-BPOXxt2y.js`. The authenticated future-30 manager view changed from two legacy Court rows with two reschedule/two cancel actions into two canonical Reservation cards with two schedule-focus actions and zero legacy inline actions. Chinese/English desktop and 390x844 mobile checks had no read error, overflow, or console error/warn; schedule focus selected one current effective allocation.

Post-cutover API logs contained only eight POSTs plus one OPTIONS request to `admin_search_reservations`, all HTTP 200, and no new legacy search call. The database postflight was identical to preflight. No migration, DB push, grant, writer, business data, Auth, Realtime, payment, or pricing behavior changed. Rollback remains selector-to-legacy/delete plus rebuild. Full bilingual evidence is in [`docs/reservation-migration/phase-4b3-production-cutover.md`](./docs/reservation-migration/phase-4b3-production-cutover.md); Phase 4C aggregate action scope and Phase 5 decommission remain separate confirmed gates.

Issue [#157](https://github.com/tujiaqi2002/badminton/issues/157) explicitly authorizes only the manager Reservation order-search implementation, isolated-stage migration/verification, reversible selector, and Draft PR. Production migration/cutover, writer/action scope, customer reads, payment/pricing behavior, Stripe, Realtime, and legacy decommission remain excluded.

Append-only migration `20260826181644_reservation_phase_4b3_order_search` preserves the existing `admin_search_reservations(...)` signature and version 1 envelope while adding all-Party matching, `party_count`, venue-local bounds, and `(matched_start_at, reservation_id)` keyset pagination. It remains security-invoker, empty-search-path, manager-gated, and authenticated-only, and it mutates no business data. The isolated-stage apply and pre-merge production preflight both passed.

Only exact `VITE_RESERVATION_ORDER_READ_SOURCE=canonical` enables the new frontend path. Staging opts in, while the production example and workflow default to legacy. At the isolated-stage gate, future-30-day browser evidence changed ten Court-allocation rows into five Reservation cards; the first schedule action highlighted two allocations belonging to the same Reservation. All-Party search, manager/non-manager roles, Chinese/English desktop, 390×844 mobile, and zero-error console checks passed. Bundled Node `v24.19.0` / pnpm `11.19.0` passed 36/36 read tests, 36/37 Reservation tests with one explicit no-local-PostgreSQL skip, lint, and build. Full bilingual evidence is in [`docs/reservation-migration/phase-4b3-canonical-order-search.md`](./docs/reservation-migration/phase-4b3-canonical-order-search.md). Draft review and the later production gates have since completed as recorded above.

Before merge authorization, Draft PR [#158](https://github.com/tujiaqi2002/badminton/pull/158) was mergeable and remained Draft. Final [CI run 33013960452](https://github.com/tujiaqi2002/badminton/actions/runs/33013960452) passed 37/37 Reservation PostgreSQL tests and 36/36 read tests with zero skips, plus lint/build, under Node `v22.23.2`, pnpm `11.16.0`, and PostgreSQL `16.15`. The sole annotation was the runner-platform deprecation notice for the internal Node 20 target of `pnpm/action-setup@v4`, not a repository or Phase 4B.3 failure.

The fresh production read-only preflight was clean. At the end of that gate, production had exactly 48 applied migrations and no remote-only drift; migration `20260826181644` was the only local-only/pending item, and the dry run listed only migration 49. Phase 3B/4A diagnostics remained clean, the authenticated non-manager gate denied access, and the predecessor production function had the expected security-invoker, empty-search-path, authenticated-only shape. The candidate query plan completed in 9.335 ms with 95 shared hits, zero shared reads or temp blocks, and existing Session/membership indexes in use. Advisors found no Phase 4B.3-specific issue, so no speculative index was justified. No merge, database push, or production mutation occurred during that preflight.

The user then authorized that exact merge/deployment gate. PR #158 merged at 2026-08-26 21:26:04 UTC as `58d9d59cab0eebd6f0591834217e744ecb2343f1`; the Supabase check advanced production exactly to migration 49, and Pages [run 33015339219](https://github.com/tujiaqi2002/badminton/actions/runs/33015339219) passed. Read-only postflight verified the installed definition, manager v1 envelope, non-manager denial, exact ACL, unchanged 192/123/135/192/131 data baseline, and `court_slots`-only Realtime. Advisors remained at 48 security and 60 performance findings with no Phase 4B.3-specific item.

At the default-legacy checkpoint, live asset `index-D2_P4uCy.js` contained one production ref, zero staging refs, one legacy order RPC, and zero canonical order RPCs. The authenticated future-30 manager view retained two legacy Court rows with two change and two cancellation actions, zero canonical schedule-focus actions, no horizontal overflow, and zero console errors/warnings. Exact-canonical production cutover has since completed as recorded at the top of this update; aggregate writer/action scope and legacy decommission remain excluded. Full default-legacy evidence is in [`docs/reservation-migration/phase-4b3-default-legacy-production-verification.md`](./docs/reservation-migration/phase-4b3-default-legacy-production-verification.md).

## English update: Phase 4B.2 production canonical selected detail active

After PR #155 merged the default-legacy evidence as `a16e5f6`, the user explicitly continued into the separately named production detail cutover. A clean preflight was followed by exact `VITE_RESERVATION_SELECTED_DETAIL_READ_SOURCE=canonical`. [Pages run 32961018071](https://github.com/tujiaqi2002/badminton/actions/runs/32961018071) deployed `index-DLJKKuT_.js` from the same verified `main`, with one production ref, zero staging refs, and one detail RPC occurrence.

The live manager path rendered one ready canonical v1 card with all seven business sections and zero error cards. Two sibling Courts inside a three-Session / three-allocation Reservation retained one reference and reused one request; crossing Reservations issued the next request. Three distinct Reservations produced three POST calls plus one OPTIONS, all HTTP 200, and browser error/warn stayed zero. A read-only authenticated non-manager test was denied, `anon` retained no EXECUTE, and the post-cutover database diagnostic was identical to preflight.

Production now keeps canonical schedule/capacity plus canonical selected detail. Manager order/search, customer reads, writer/action scope, and legacy decommission remain unchanged. Rollback is setting/deleting only the selected-detail variable and rebuilding, with no DB rollback. Full bilingual evidence is in [`docs/reservation-migration/phase-4b2-production-cutover.md`](./docs/reservation-migration/phase-4b2-production-cutover.md).

## English update: Phase 4B.1 production canonical schedule/capacity active

After the default-legacy deployment was verified, the user authorized a reversible production canonical cutover limited to manager schedule/capacity. PR [#151](https://github.com/tujiaqi2002/badminton/pull/151) added one Pages selector with a pinned `legacy` fallback and passed PostgreSQL 16 CI. It merged at 14:22:23 UTC as `6157f7a23daeb5d5c9c14d2d8310b41d24b7fd6d`.

Pages [run 32859078691](https://github.com/tujiaqi2002/badminton/actions/runs/32859078691) first deployed with the variable absent and proved that the live artifact remained legacy. The exact `canonical` variable then produced `index-CvTu7GmI.js` in [run 32859184175](https://github.com/tujiaqi2002/badminton/actions/runs/32859184175), with one canonical RPC occurrence, zero staging refs, and one production ref. An authenticated manager loaded three schedule ranges and two capacity weeks without read errors; browser error/warn logs stayed zero. API logs showed eight successful canonical POST calls plus one successful OPTIONS request. The post-cutover diagnostic remained clean at 48 migrations, 192/192 memberships/allocations, 123 Reservations, zero mismatch, 17/0/17/3 writers, seven FORCE RLS tables, and `court_slots`-only Realtime.

Production now keeps canonical for AdminSchedule/AdminCapacity. Order/detail/actions and all writers retain their existing contracts. Rollback is setting/deleting the variable and rebuilding; no DB rollback is needed. Phase 4B.2 and decommission remain separate gates. Full bilingual evidence is in [`docs/reservation-migration/phase-4b1-production-cutover.md`](./docs/reservation-migration/phase-4b1-production-cutover.md).

## English update: Phase 4A.3 production shadow observation completed

After explicit approval of a bounded production observation, PR [#146](https://github.com/tujiaqi2002/badminton/pull/146) merged as `a205e4a25e2d71d16c13b1e3dc0e4a02b7a31225`. The default-off Pages [run 32839332729](https://github.com/tujiaqi2002/badminton/actions/runs/32839332729) was green and the live `index-ssrRc0gW.js` contained no shadow event or RPC code. The observation excluded mutations, default read/UI adoption, Phase 4B/4C, Stripe, Realtime changes, and legacy decommission.

The temporary exact-true feature build deployed successfully in [run 32839524612](https://github.com/tujiaqi2002/badminton/actions/runs/32839524612). Four manager-schedule windows emitted four `info`-level clean events. Supabase API logs confirmed four POST/HTTP 200 calls to each canonical read-only RPC. The post-observation diagnostic still reported 48 migrations, 192 bookings/memberships, 192 canonical allocations, 123 Reservations, the 17/0/17/3 writer boundary, seven FORCE RLS tables, `public.court_slots`-only Realtime, and zero Phase 3B or Phase 4A mismatch.

The temporary variable was then deleted. Rollback Pages [run 32839948133](https://github.com/tujiaqi2002/badminton/actions/runs/32839948133) succeeded, the live site again referenced `index-ssrRc0gW.js`, and the shadow event/RPC code was absent. Legacy bookings remained the sole rendered source throughout that observation. Full bilingual evidence is in [`docs/reservation-migration/phase-4a3-production-shadow-observation.md`](./docs/reservation-migration/phase-4a3-production-shadow-observation.md). Phase 4B.1 later completed the separately authorized production schedule/capacity cutover described above.

## English update: Phase 4A.2 default-off frontend foundation deployed

Phase 4A.2 was implemented on `codex/reservation-phase-4a2-shadow-adapter` after explicit user confirmation. After a fresh merge gate, the user authorized Ready + merge + the default-off Pages deployment. PR [#145](https://github.com/tujiaqi2002/badminton/pull/145) merged at 2026-08-25 10:36:34 UTC as `ea3e6a80afcec64736a54b2bba65f0936f7e9ab8`. It adds versioned canonical frontend normalizers for schedule, Reservation search/detail, and PII-free status, plus a legacy allocation adapter and an exact-`true`, default-off manager shadow flag. Legacy bookings remain the only rendered UI source. Live comparison is schedule-only because legacy and canonical schedule rows share Court-allocation cardinality; the intentionally different booking-row versus Reservation-row order searches are not forced into a misleading comparison.

Shadow reads use venue-timezone boundaries and compound keyset pagination, abort obsolete requests, fail closed on unknown schema/cursor states, and log only counts, codes, and totals. They never control loading, toasts, mutations, customer reads, or rendering. The branch adds no migration or permission change. Bundled Node `v24.19.0` / pnpm `11.19.0` passes 14/14 adapter/privacy/pagination fixtures; the existing Reservation suite reports 32 pass / one expected no-local-PostgreSQL skip across 33 tests; lint and production build pass. Default-off desktop/mobile browser checks show no console errors, no shadow event, and no visible regression. Production and staging remain exactly aligned at 48 migrations. Full bilingual scope and rollback details are in [`docs/reservation-migration/phase-4a2-frontend-shadow-adapter.md`](./docs/reservation-migration/phase-4a2-frontend-shadow-adapter.md).

Final merge-head CI [run 32837678041](https://github.com/tujiaqi2002/badminton/actions/runs/32837678041) passed the 33/33 Reservation PostgreSQL suite and the 14/14 frontend adapter suite with zero skips under Node `v22.23.2`, pnpm `11.16.0`, and PostgreSQL 16; lint/build were also green. Supabase Preview correctly skipped because the PR contains no migration. Post-merge Pages [run 32838082873](https://github.com/tujiaqi2002/badminton/actions/runs/32838082873) built and deployed successfully. The live page returns 200 and references the exact `index-ssrRc0gW.js` produced by that run; both the shadow event and flag literals are absent from the live bundle because the Actions variable is unset and the workflow default is false. Production and `badminton_stage` remain at 48 migrations. A later separately authorized Phase 4A.3 observation completed cleanly and restored this default-off baseline.

After a fresh read-only gate, the user explicitly authorized merging PR #143 and allowing the protected Supabase integration to install migration 48. PR #143 merged at 2026-08-25 09:41:17 UTC as `3db78f8d8c2b2eec58e137a57ff2f2ec5bbab61c`; the integration applied `20260825091608_reservation_phase_4a_manager_read_contract` at 09:41:55 UTC. Production and staging now both have 48 migrations. Phase 4A.2 later deployed the default-off frontend foundation, Phase 4A.3 completed a bounded clean observation, and Phase 4B.1 later adopted canonical schedule/capacity only. Stripe, Phase 4B.2, and legacy decommission remain excluded.

The additive contract introduces two security-invoker v1 views and four manager-only security-invoker RPCs for schedule, Reservation search, one-call detail, and PII-free shadow status. Current effective membership determines ownership, explicit Party roles determine the primary contact, and append-only allocation/payment facts determine money state, including `no_charge` for zero-price Reservations. Legacy group/link IDs remain source trace fields only.

Schedule and search use compound keyset pagination, while schedule, search, and detail each require one database round trip and avoid application-level N+1. Production role tests passed for a real manager and denied authenticated non-managers and anonymous callers. The production diagnostic reconciled 192 allocations/memberships with 123 current Reservation summaries and zero Phase 3B or Phase 4A mismatch. All views are security invoker, all public functions are invoker with empty `search_path`, and explicit grants remain manager-gated.

The final [Actions run 32832792480](https://github.com/tujiaqi2002/badminton/actions/runs/32832792480) passed 33/33 with zero skips under Node `v22.23.2`, pnpm `11.16.0`, and PostgreSQL `16.15`; post-merge [Pages run 32833288305](https://github.com/tujiaqi2002/badminton/actions/runs/32833288305) succeeded. Production plans use the intended schedule and effective-membership indexes. Advisors report the unchanged 48 security findings and 60 performance INFO findings after validation, all unused indexes and zero unindexed foreign keys. Phase 4B.1 now consumes the schedule contract for AdminSchedule/AdminCapacity; order/detail/actions are not yet adopted. Full bilingual evidence is in [`docs/reservation-migration/phase-4a-manager-read-contract.md`](./docs/reservation-migration/phase-4a-manager-read-contract.md).

After a fresh read-only preflight, the user explicitly authorized merging PR #140 and allowing the protected Supabase integration to apply production migrations 45–47. PR #140 merged at 2026-08-25 08:23:38 UTC as `1499cf4da939e6d0e00b7eec9bb2380c65c3b32e`. The integration applied all three migrations in order at 08:25:06–08:25:07 UTC, advancing production exactly from 44 to 47 versions.

Post-deployment Phase 2, Phase 3A, and Phase 3B.2 diagnostics all pass. Production still has 123 Reservations, 135 Sessions, 192 bookings, 131 Parties, 23 Payments, 26 allocation entries, and CAD 1,642.00 reconciled. All 192 bookings have memberships, with zero shadow, Session-projection, payment, or incomplete-operation mismatches. The sole zero-price booking remains `pay_at_venue` with no Payment, allocation, or refund; no CAD 0 receipt was fabricated.

The production writer boundary is now 17 public entries, zero public direct legacy writers, 17 private legacy delegates, and three wrappers. Seven Phase 3B tables use RLS plus FORCE RLS; clients have no direct DML or private-helper EXECUTE. Realtime still publishes only `public.court_slots`, and no Edge Functions are deployed. The corrected activation assertion remains private, security invoker, empty-search-path, and owner-only.

The explicit-primary merge RPC is manager-gated, denies anonymous EXECUTE, and requires `private.require_manager()` before mutation. Production advisors report 48 security findings (2 INFO / 46 WARN) and 67 performance INFO findings, all unused indexes and zero unindexed foreign keys. Recovery CI [run 32824013095](https://github.com/tujiaqi2002/badminton/actions/runs/32824013095) passed 28/28 with no skips, and post-merge [GitHub Pages run 32826377671](https://github.com/tujiaqi2002/badminton/actions/runs/32826377671) built and deployed successfully.

That phase activated the database write boundary only. Phase 4B.1 later switched manager schedule/capacity reads while preserving existing order/detail/action contracts. Stripe and every legacy decommission action remain outside the authorized scope.
