# Tiger Project History

> 从项目起点到 2026-08-23 的阶段性开发历史。本文解释“如何走到现在”，当前状态以 [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) 为准。

## 0. 起点：从通用预约系统蓝图收敛到真实球馆

早期讨论给出了一条通用预约 SaaS 路线：从 availability/booking MVP 开始，随后解决并发、日历、支付、通知、多租户、经营面板、CRM、AI 与 marketplace。

Tiger 最重要的产品决定是没有照单全收，而是先服务一家拥有五片场地的真实羽球馆。产品目标从“做一个通用预约平台”收敛为：让客户快速看到空闲，让馆长直接管理每天排期，并由数据库保证不超卖、权限和计价。

这个收敛使短时间内的开发围绕真实操作展开，而不是提前进入微服务和多租户抽象。

## 1. 2026-08-11：项目初始化

- 创建 React + Vite 项目和基础 Tiger 视觉。
- 建立五场地预约模型与最初页面。
- 确定 GitHub Pages 前端 + Supabase 后端架构。

阶段结果：有了可运行项目，但还只是初始骨架。

## 2. 2026-08-12 上午：客户预订与生产基础

- 完成 Tiger 预约 PWA、GitHub Pages 路径和部署修复。
- 建立 Supabase schema、取消规则和数据库约束。
- 修复资源损坏与 Pages base path。
- 强化数据库预订 schema，让防超卖和取消规则不只存在于 UI。
- 接入 Google 登录方向；因邮件 rate limit，生产策略逐步转向 Google Auth。

阶段结果：基本客户预订、数据库持久化、取消与部署链路成立。

## 3. 2026-08-12 中午：安全馆长能力与双语视觉

- 增加安全的管理员订单看板和馆长取消能力。
- 添加中英双语。
- 连续加入 7 套 UI 主题、水墨与 Tiger 视觉资源。
- 修复响应式字体溢出、最后行/列 hover 出现滚动条等 UI 问题。
- 访问策略收紧为私有馆长登录，馆长身份进入数据库授权模型。

阶段结果：从客户 demo 变成具有品牌、双语和权限边界的可用产品。

## 4. 2026-08-12 下午至 8 月 13 日：馆长排期成为核心

- 建立可视化日排期编辑器，支持跨场地、跨时间和跨日拖拽。
- 添加半小时刻度、快速新增、电话/备注/客户资料编辑。
- 支持多场地预订、连续场地选择、循环周订和订单关联。
- 加入 resize、跨日快速改期、过去时段限制、当前时间线和历史查看。
- 处理拖动文本选中、原位成功提示、无效落点卡片消失、自我重叠等大量直接操作细节。
- 分离场地监控与预订管理，建立每周容量网格。

阶段结果：产品重心从“客户点格子预订”转为“馆长高密度运营工具”。这也是 Tiger 与普通 booking demo 的主要区别。

## 5. 2026-08-14：可追溯运营与馆务中心

- 订单查询增加默认今日、搜索、状态/支付筛选和 50 条分页。
- 建立 durable booking audit log、安全 revert 和排期侧栏摘要。
- 重构日期控制、顶部固定栏和大屏空间利用。
- 创建可扩展馆务中心：基础设置、营业时间、定价、活动、会员和操作记录。
- 修复活动日期排期 crash、中文乱码、安全保存和配置跨页面不同步。
- 建立显示设置、字体与客户颜色系统。

阶段结果：从排期工具扩展为单馆运营后台；日志成为快速操作的安全保障。

## 6. 2026-08-15：计价与视觉可扩展性

- 隐藏客户不需要知道的计价规则名，馆长保留解释和调整能力。
- 重做计价匹配与优先级，使最终价格可说明而非隐式权重。
- 支持多星期定价、客户最短预订时长、馆长价格确认。
- 从固定五色迭代到可切换暖色 palette，再到适合大量客户的稳定颜色生成。
- 再次处理 Supabase migration history 对齐。

阶段结果：计价从硬编码进入配置化；颜色从场地装饰变成可扩展信息系统。

## 7. 2026-08-16：高级排期与安全控制

- 连续多场地圈选和馆长多场预订。
- 原子化一对多订单置换，支持总时长相等的组合交换。
- 可拖拽订单 link，支持不同时间段仍保持业务关联。
- 历史订单锁定设置；过去订单可查看，编辑能力可配置。
- 最近 10 条日志、紧凑日志摘要、五场地与日志并列显示。
- 字体大小改为滑杆，订单卡片明度与透明度统一。

阶段结果：排期编辑器已达到高级 Beta，但交互和数据组合的测试矩阵显著扩大。

## 8. 2026-08-17：团队管理与交互收尾

- 加入管理员管理，允许在馆务中心维护馆长权限。
- 扩大排期工作区，改善拖拽时源卡半透明、原位虚影与落点反馈。
- 压缩操作日志，减少信息过载。

阶段结果：开始从单人快速开发转向多工程师协作与运营试用。

## 9. 2026-08-19—20：建立长期上下文和 PR 协作

- 合并 `PRODUCT_CONTEXT.md` 与 `TECHNICAL_CONTEXT.md`，将长期事实从聊天中抽离。
- 创建 Issue #88 与 PR #90，为馆长增加拖拽方向锁定。
- Kevin 作为 reviewer 进入实际 PR 流程；其他 UI 工作拆为 #84–#87。
- 建立 Workspace 全局工作台、复利日志、新项目 SOP 和标准 `project-001-badminton` worktree。

阶段结果：项目治理开始追赶功能复杂度。PR 的目标不再只是“看代码”，而是隔离变更、提供预览证据和控制上线风险。

## 10. 关键转折

1. **从通用 SaaS 转向单馆深耕**：避免过早抽象，换来真实运营密度。
2. **从客户预约页转向馆长排期核心**：真实需求证明馆长效率比功能数量更重要。
3. **从前端校验转向数据库裁决**：RLS、RPC、约束和原子操作让快速 UI 不牺牲数据正确性。
4. **从确认弹窗转向日志/撤回**：保持直接操作，同时提供可追溯安全网。
5. **从长聊天转向版本化上下文**：让 compact、多工程师和长期维护可持续。

## 11. 迄今最重要的经验

- 高频操作不要被层层模式和确认变复杂；优先用预览、无效落点、日志与撤回降低风险。
- 任何馆务配置都必须真正影响所有消费页面和数据库规则。
- 快速产生功能不等于快速交付；没有预览、测试和边界清晰的 PR，评审成本会转移给团队。
- 当前架构足以支撑单馆产品，不需要为了未来故事提前微服务化。
- 下一阶段的增长点不是再堆高级动作，而是让已有动作更稳定、可测、可评审、可运营。

## 12. 2026-08-21：UI 评审开始保留视觉证据

- Issue #112 的局部支付控件改进补充了需求原图和浏览器验证后的对比图。
- 团队确认 UI 或交互变更不能只报告“已浏览器验证”，还要在验证时保存 Before / After 截图并附到对应 Issue 或 PR。
- 桌面与手机布局存在差异时分别保留截图，让 reviewer 能直接判断视觉层级、对齐和响应式结果。

阶段结果：浏览器验收从口头结论升级为可在 Issue / PR 中长期追溯的视觉证据。

## 13. 2026-08-23：统一 Reservation 模型进入分阶段迁移

- Issue #118 确认以 `Reservation → Sessions → Court allocations` 统一旧 `booking_group_id` 与 `booking_link_id` 的业务归属，同时拆分 party roles、付款意向和真实 payment ledger。
- 明确允许馆长强制合并不同客户的预约，但必须选择主要联系人、保留全部来源，并禁止模糊自动合并身份。
- Phase 0 / Issue #119 只读核对生产 migration、schema/RLS/grants/RPC、数据、金额、付款、审计和 advisors，没有执行生产写入。
- 本地与远端 37 个 migration 完全一致；192 个 legacy Court rows 可确定性映射为 123 Reservations、135 Sessions 和 192 Court allocations，139 个有效 slot 没有投影或重叠异常。
- 发现 26 个历史 paid Court rows 中只有 5 个有专门付款审计；后续必须使用明确的 legacy reconciliation 记录，不能虚构付款人、provider 或批次。

阶段结果：Reservation 迁移从概念讨论变成有生产基线、账务限制和安全门禁的 Phase 0 方案；Phase 1 只能只加不删，并继续等待独立评审与授权。

## 14. 2026-08-23：Reservation Phase 1 建立 additive schema

- 用户 review Phase 0 / PR #120 后明确授权 Issue #121 开始 Phase 1。
- 使用 Supabase CLI 创建第 38 个本地 migration，新增 Reservation、Session、Party roles、payment intent、真实 Payments、append-only allocation ledger、recurrence series 与 legacy source mapping。
- 现有 `bookings` 只增加 nullable `reservation_id` / `session_id`，继续承担 Court allocation、GiST overlap 和 Realtime slot 投影；没有 backfill 或切换读写。
- 9 张新 public 表全部显式 RLS/FORCE RLS 和最小 grants，没有增加 public mutation RPC。
- Migration 在隔离 PostgreSQL 环境实际应用；验证发现并补齐两个 FK index，随后 schema、权限、legacy compatibility 与负向 financial invariants 全部通过。

阶段结果：新模型已有可评审、未部署的物理基础，同时生产继续完整运行 legacy 模型。Phase 2 backfill、历史付款 reconciliation、Toronto DST 转换和生产 deployment 仍需分别授权。

## 15. 2026-08-23：Reservation Phase 1 生产物理基础上线

- PR #120 与 PR #122 按顺序合并进入 `main`，本地 22/22 tests、lint、build 和两次 GitHub Pages workflow 均通过。
- 获得明确生产授权后，最终 preflight 发现远端 migration history 已包含 `20260823072016_reservation_aggregate_schema`，因此没有重复执行会冲突的 DDL，而是直接进入上线后验证。
- 只读生产诊断确认 9 张新表、nullable/default-free booking ownership columns、约束、触发器、RLS/FORCE RLS、最小 grants、private integrity functions 与 FK indexes 全部完整。
- 9 张新表保持为空；192 条 legacy booking 没有任何 `reservation_id` / `session_id`，139 条有效 `court_slots` 投影保持一致；旧 RPC、GiST overlap、Realtime 和前端行为均未切换。
- Security advisor 没有 Phase 1 新增 finding；Performance advisor 只对尚未承载数据的新索引报告预期的 `unused_index` INFO。

阶段结果：Phase 1 的 additive schema 已成为生产事实，但业务仍完整运行 legacy 模型。下一阶段是 Issue #123 的 deterministic backfill；在独立 migration、DST/付款 reconciliation 验证和生产授权前，不得开始写入新 ownership 数据。

## 16. 2026-08-23：Reservation Phase 2 deterministic backfill 起草

- 用户 review Phase 1 production verification 后明确授权按 Issue #123 开始 Phase 2，但没有授权生产 `db push` 或 Phase 3。
- 重新执行零 PII 生产基线并冻结 192 bookings、131 groups、123 目标 Reservations、135 Sessions、26 paid rows/CAD 1,642.00 及 booking/slot/payment-audit 指纹。
- 第 39 个 migration 使用 UUIDv5/stable source keys 确定性建立 Reservation、Session、Party/roles、recurrence 与真实 payment/allocation ledger，并只回填 booking ownership columns。
- 旧数据没有 single/split payer intent，因此使用内部 `legacy_unspecified`；5 条有审计 paid rows 重建为 2 笔 audit-backed Payments，21 条无审计 rows 各自独立 reconciliation，不虚构 payer/provider/time/refund。
- 使用实际 Phase 1/2 SQL 在隔离 PostgreSQL-compatible 环境应用，完整诊断通过；两个独立数据库的映射指纹一致，customer/DST/payment evidence/UUID/over-allocation/late rollback 等 8 项测试全部通过。

阶段结果：Phase 2 已成为可评审、未应用的 migration。生产仍运行 38 个 migration 和完整 legacy 行为；必须 fresh baseline、dry-run、单独授权后才可 `db push`，通过生产诊断后也要停在 Phase 3 前。
