# Tiger Project Status

> 项目：`project-001-badminton`。核对日期：2026-08-21。Canonical worktree 分支：`codex/project-context-system`。

## 1. 一句话结论

Tiger 已经越过基础 MVP，进入**单馆运营 Beta / 私有馆长试运行**阶段：预订并发、馆长可视化排期和馆务配置已经相当丰富，但自动化测试、PR 预览、独立 staging、正式在线支付和普通客户开放尚未达到生产成熟度。

换句话说，当前主要问题不是“功能太少”，而是**功能增长快于工程保障**。下一阶段应优先稳定、验证和协作，不宜马上扩张到多商户、AI 或市场平台。

## 2. 当前可验证事实

- 仓库：`tujiaqi2002/badminton`，默认分支 `main`。
- 生产前端：`https://tujiaqi2002.github.io/badminton/`，由 GitHub Actions 从 `main` 发布。
- 后端：Supabase project `ldbtrouofmqmnkyxiewk`，PostgreSQL + Auth + Realtime + RPC/RLS。
- `main` 当前包含截至 2026-08-19 的产品/技术上下文；#88 分支加上新提交后全历史共 99 个提交。
- 数据库目录包含 36 个有序 migration。
- 构建命令包含 `dev`、`build`、`preview`、`lint` 和 `test`；#93 增加了首组 6 个纯逻辑单元测试，但仍没有集成或 E2E test script。
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

### PR #114 / Issue #113：Booking relationship popover outside-click dismissal

- 分支：`codex/issue-113-close-relationship-popover`。
- PR：`https://github.com/tujiaqi2002/badminton/pull/114`，等待 `KevinLiTian` 评审。
- 内容：馆长打开订单关系菜单后，点击触发按钮和菜单以外的任意位置即可关闭；菜单内操作、按钮切换和拖拽连接行为保持可用。
- Supabase：不需要 schema、migration 或 RPC 变更。
- 已记录验证：22 个单元测试、lint、build、桌面与 390×844 手机尺寸；菜单内点击、外部关闭、按钮重开/关闭，以及连接选择和断开确认入口均通过。
- 风险：局部管理端交互调整；未改动数据库或现有连接/断开操作本身。

### PR #111 / Issue #110：Remove redundant move scope note

- 分支：`codex/issue-110-remove-move-scope-note`。
- PR：`https://github.com/tujiaqi2002/badminton/pull/111`，Draft，等待检查与评审。
- 内容：从馆长选中预订详情中移除重复的“移动范围 / Linked move”说明；馆务中心里的多场订单拖拽设置、拖动预览和整组/单场移动逻辑保持不变。
- Supabase：不需要 schema、migration、RLS 或 RPC 变更。
- 已记录验证：lint、build、22 个单元测试、桌面与 390px 手机浏览器检查，以及中英文详情和馆务设置保留检查。

### PR #93 / Issue #92：Multi-court Individual Move

- 分支：`codex/issue-92-individual-booking-move`。
- PR：`https://github.com/tujiaqi2002/badminton/pull/93`，等待评审。
- 内容：多场地订单默认保持连锁移动；馆长可在选中详情中临时切换到“单独移动”，让下一次拖动到空位或缩放只修改当前 booking，操作后自动恢复连锁模式。
- 同组 booking 分开后，详情按每条记录的真实场地和时间展示；`booking_group_id` 与 `booking_link_id` 保持不变。
- Supabase：不需要 schema、migration 或新 RPC；复用现有单条和整组 reschedule/move RPC。
- 已记录验证：6 个单元测试、lint、build、桌面与 390px 响应式浏览器检查，以及连锁/单条拖动与缩放演示验证。

### PR #90 / Issue #88：Drag Lock

- 分支：`codex/88-drag-lock`。
- 工作树：`tmp/badminton-deploy`（旧路径，暂时保留）。
- PR：`https://github.com/tujiaqi2002/badminton/pull/90`，等待 `KevinLiTian` 评审。
- 内容：馆长可选择 Free、Court only、Time only 拖拽模式，设备本地持久化。
- 已记录验证：lint、build、浏览器水平/垂直锁定、中英标签、响应式与刷新持久化。
- Supabase Preview check 为 skipped；该功能不需要 migration。
- 本文档分支不能向 #90 夹带修改；#90 是否合并由用户和 reviewer 决定。

### 其他开放 Issue

| Issue | 目标 | Owner |
| --- | --- | --- |
| #84 | Activity log section refine | Tusu + Kevin |
| #85 | Remove Customer Booking Selection and Redesign Booking UI | Tusu + Kevin |
| #86 | Manager Booking page color design | Kevin |
| #87 | My Booking section redesign | Kevin |

这些 issue 有明显 UI 重叠，合并前需要指定每个 issue 的页面边界，避免同时修改 `styles.css`、`App.jsx` 或同一组件造成冲突。

### 本地进行中：Issue #87 My Booking section redesign

- 分支：`codex-87-my-bookings-redesign`。
- 内容：客户“我的预订”列表改为扫描优先的订单卡片，突出日期、时段、场地、订单状态、支付状态、金额和下单时间；同时间多场地订单合并为一张可识别的多场地卡片，但取消入口仍按单条 booking 沿用原有条件与回调。
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
- Supabase migration history 曾两次出现远端/本地不一致，后续必须先对齐再推送。
- 支付代码存在但未形成可证明的生产闭环，不能对客户宣称在线支付可用。

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

1. 合并或关闭 #90 前先完成 reviewer 行为验收。
2. 建 PR Preview 或固定 staging URL，PR 附验收路径、截图/录屏。
3. 增加最小自动测试：时间区间、计价匹配、swap/overlap、颜色稳定哈希。
4. 将 `AdminSchedule`、`App` 的纯逻辑逐步抽出，避免大爆炸式重构。

### Milestone B：运营 Beta 稳定

1. 按清晰边界完成 #84–#87。
2. 建立关键回归清单：新增、移动、缩放、置换、关联、循环、取消、支付标记、历史锁定。
3. 对营业时间、活动、定价和开放窗口做跨页面 + 数据库回归。
4. 用真实馆长试用数据判断哪些高级操作应保留、隐藏或简化。

### Milestone C：决定客户公开上线

必须明确完成：普通客户 Auth 策略、支付是否上线、通知渠道、取消规则、隐私/条款、客服与运营流程。未完成这些决定前继续保持私有馆长试运行。

## 8. 当前不应做的事

- 不为了“看起来像平台”提前做多租户或微服务拆分。
- 不在没有第二家真实客户前抽象 marketplace。
- 不把 AI 功能置于排期正确性、预览环境和测试之前。
- 不移动或删除 `tmp/badminton-deploy`，直到 PR #90 处理完且确认无未提交工作。
