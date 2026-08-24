# Tiger Project Status

> 项目：`project-001-badminton`。核对日期：2026-08-24。当前工作分支：`codex/phase-3a-rls-policy-consolidation`。

## 1. 一句话结论

Tiger 已经越过基础 MVP，进入**单馆运营 Beta / 私有馆长试运行**阶段：预订并发、馆长可视化排期和馆务配置已经相当丰富，但自动化测试、PR 预览、独立 staging、正式在线支付和普通客户开放尚未达到生产成熟度。

换句话说，当前主要问题不是“功能太少”，而是**功能增长快于工程保障**。下一阶段应优先稳定、验证和协作，不宜马上扩张到多商户、AI 或市场平台。

## 2. 当前可验证事实

- 仓库：`tujiaqi2002/badminton`，默认分支 `main`。
- 生产前端：`https://tujiaqi2002.github.io/badminton/`，由 GitHub Actions 从 `main` 发布。
- 后端：Supabase project `ldbtrouofmqmnkyxiewk`，PostgreSQL + Auth + Realtime + RPC/RLS。
- `main` 当前已包含 PR #129（Phase 3A compatibility foundation）和 PR #130（shadow timezone access），以及此前的 Phase 0/1/2 与产品 PR。
- 生产 migration history 与 `main` 均为 41 个版本，最新为 `20260824130514_reservation_phase_3a_shadow_timezone_access`；当前 Issue #131 分支本地新增第 42 个 migration，尚未合并或部署。
- 构建命令包含 `dev`、`build`、`preview`、`lint` 和 `test`；Reservation Phase 2/3A 已有实际应用 migration 的 PGlite 集成测试，但仍没有浏览器 E2E test script。
- 当前仅有 `deploy.yml`；没有证据表明仓库已有独立 PR Preview 工作流。
- `App.jsx`、`AdminSchedule.jsx`、`i18n.js` 和 `styles.css` 已成为大型集中模块，后续改动的回归面较大。

## 3. 能力成熟度

| 能力 | 状态 | 判断 |
| --- | --- | --- |
| 五场地可用性与客户预订流程 | 已实现 / 受当前访问策略限制 | UI、Realtime、多场地、电话、备注、时长与价格确认已存在；普通客户生产登录仍未开放 |
| 防超卖与权限 | 较成熟 | PostgreSQL exclusion/约束、RLS、manager RPC 是正确边界；仍需持续回归 migration 与 policy |
| 馆长日排期编辑器 | 高级 Beta | 拖拽、缩放、跨日、快速新增、多场地、循环、关联、置换、历史锁定、日志/撤回均已实现；交互仍在密集打磨 |
| 每周容量监控 | 已实现 | 适合电话查询，当前最小显示刻度为 1 小时 |
| 订单查询与分页 | 已实现 | 默认今日、状态/支付筛选、搜索、每页最多 50 条 |
| 馆务中心 | 功能完整度较高 | 基础设置、营业时间、定价、活动、会员、管理员和完整日志已接入；需要跨页面一致性回归 |
| 计价 | 已实现但高风险 | 优先级/覆盖区间已重做得更直觉，客户隐藏规则名，馆长可查看和调整；需用边界时段和多场地持续测试 |
| 审计与撤回 | 已实现 | 排期侧栏提供短日志，馆务中心保留完整查询；为快速拖拽提供了重要安全网 |
| 多语言、PWA、主题和显示设置 | 已实现 | 中英、7 套 UI、字体滑杆、订单 palette；视觉配置较多，需防止样式回归 |
| 在线支付 | 骨架 | Stripe Edge Function 代码存在，但当前 UI 可关闭；没有证据表明生产函数和完整 webhook 流程已上线验证 |
| 通知（邮件/SMS/提醒） | 未完成 | 当前没有完整通知/队列体系 |
| 多商户 SaaS、AI 助理、市场平台 | 未开始 / 非当前范围 | 来自早期长期蓝图，不应在单馆核心稳定前启动 |

## 4. 当前进行中工作

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
- Issue #131 已获用户确认起草第 42 个最小 migration：在 fail-closed 验证 RLS/FORCE RLS、单列 grant、无 authenticated table/DML grants 和两条既有 policy 后，只删除冗余 `venue_settings_rpc_only`。无适用 DML policy 时 RLS 默认拒绝，且 client 仍无 DML grants；其他配置字段和 writes 继续 RPC-only。
- 14 项 Phase 2/3A 隔离集成测试已通过，包括 policy consolidation、authenticated DML grant drift 在 drop 前失败并回滚、timezone column-only grant、真实 manager/non-manager 权限路径、幂等 catch-up、客户身份冲突、unsafe link 与付款漂移。
- PR #132 已创建为 Draft，只供 migration/test/documentation review；不得 merge，因为合并会自动部署第 42 个 migration。
- 第 42 个 migration 只获 authoring/review 授权，没有 merge 或生产部署授权；Phase 3B 仍未开始。

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

- PR #130 / Issue #128：Phase 3A shadow timezone least-privilege access，已于 2026-08-24 合并并由 Supabase integration 自动应用生产；advisor policy consolidation 由 Issue #131 独立门禁。
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

- 尚未建立可靠的 PR Preview/staging，reviewer 很难在合并前直接体验。
- Supabase GitHub integration 会自动部署 `main` 的 pending migrations；2026-08-24 PR #126 合并后约 38 秒即应用生产，越过了原计划的 merge 后 manual dry-run 门禁。未来必须在 merge 前完成 production baseline/dry-run/授权，或先关闭该自动部署集成。
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
