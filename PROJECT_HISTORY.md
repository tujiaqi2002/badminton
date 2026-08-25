# Tiger Project History

> 从项目起点到 2026-08-25 的阶段性开发历史。本文解释“如何走到现在”，当前状态以 [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) 为准。

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

## 17. 2026-08-24：Reservation Phase 2 被 GitHub integration 自动部署

- 用户确认继续后合并 PR #126；Supabase GitHub integration 自动克隆 `main`，并于 04:46:10 UTC 对 protected production branch 应用 `20260824015013_reservation_deterministic_backfill`。
- 自动部署没有应用 seed、没有部署 Edge Functions；migration 产生 192 条同一时刻、明确 operation/source 的 ownership audit events。
- 上线后只读诊断返回 `phase_2_reservation_backfill_verified`：123 Reservations、135 Sessions、192 Court allocations、131 Parties、23 Payments、26 allocations 和 CAD 1,642.00 全部一致。
- booking 非 ownership payload、139 条 `court_slots`、dedicated payment audit 指纹均与冻结基线相同；customer/session/relationship/DST/pricing/payment evidence 异常为 0。
- Security advisor 仍为既有 47 条（2 INFO / 45 WARN），没有 Phase 2 新 finding；Performance advisor 为 40 条 `unused_index` INFO，没有更高等级 finding。
- 此次确认当前 GitHub integration 会把包含 pending migration 的 `main` merge 直接变成生产部署，原先“先 merge、再单独 dry-run/push”的门禁与实际配置不符。

阶段结果：Phase 2 已成为生产事实，但 legacy RPC/前端仍未 dual-write/read cutover。未来数据库 PR 必须在 merge 前完成生产 preflight 与授权，或先关闭 GitHub 自动部署；Phase 3 仍需独立 Issue 与用户确认。

## 18. 2026-08-24：Reservation Phase 3A compatibility foundation 起草

- 用户 review 并明确确认 Issue #128 后，开始第 40 个 additive migration；当前只允许开发与评审，没有 merge 或生产部署授权。
- 生产 routine catalog 与 migration code 交叉核对出 17 个直接 booking writer、3 个 wrapper 和 2 个未部署 Stripe Edge write path，形成 Phase 3B 的 writer coverage 边界。
- 新增 deterministic private catch-up、zero-PII shadow mismatch view/RPC、最小 grants 和诊断；migration 不执行 catch-up、不替换 writer、不启用 dual-write/read cutover。
- 发现 Phase 1 Session projection trigger 会拒绝 owned booking 的 legacy-only 排期更新；保留该安全约束，并把事务内 Session/allocation 同步列为 Phase 3B 前置条件。
- 已验证安全的新 legacy group 可以幂等补齐；同一 group 的客户身份冲突、跨既有 Reservation link/unlink 与 payment drift 均 fail-closed，不自动创造身份、关系、付款或退款事实。Phase 2/3A 共 13 项隔离测试通过。

阶段结果：Phase 3A 已成为可评审、未部署的兼容基础草案。生产仍为 39 个 migration 和 legacy write/read path；merge 会触发 Supabase 自动部署，因此必须在 fresh production preflight、独立评审和明确生产授权后进行，Phase 3B activation 仍需单独 PR。

## 19. 2026-08-24：Reservation Phase 3A foundation 上线并发现最小权限缺口

- 用户在明确获知 merge 会自动部署后确认继续；PR #129 于 12:59:02 UTC 合并，Supabase integration 于 12:59:44 UTC 成功应用第 40 个 migration，GitHub Pages build/deploy 同时通过。
- migration 没有调用 catch-up；上线后仍为 192/192 owned bookings、123 Reservations、135 Sessions、131 Parties、23 Payments、26 allocations/CAD 1,642.00，shadow/session/payment drift 为 0，audit 总数和冻结 legacy/slot/payment-audit 指纹未改变。
- 初始只读 diagnostic 把新的 private reconcile helper 计入 legacy writer inventory；将范围限定为 `public` 后返回 `phase_3a_reservation_compatibility_verified`。这是验证脚本问题，不是数据写入失败。
- 真实 authenticated 测试随后发现 shadow view 依赖的 `venue_settings.timezone` 仍受 RPC-only RLS/privilege 保护，因此 manager/non-manager 均先收到 `42501`。现有隔离测试曾用过宽的 venue_settings grant，现已改为 production-like RLS 形状。
- 最小修复只允许 authenticated 读取 `timezone` 单列，并用额外 SELECT policy 限定馆长；不开放其他配置字段或写操作。第 41 个 migration 已在独立分支起草和隔离验证，尚未获得 merge/生产授权。

阶段结果：Phase 3A 数据基础已安全上线但 manager shadow access 仍待第 41 个 migration 修复；legacy 产品行为未变，Phase 3B 继续被门禁阻止。

## 20. 2026-08-24：Shadow access 上线并起草 RLS policy consolidation

- 用户在 fresh production preflight 后明确授权 PR #130 merge/生产部署；PR 于 13:17:23 UTC 合并，Supabase integration 于 13:18:16 UTC 成功应用第 41 个 migration，GitHub Pages build/deploy 同时通过。
- 未修改的 Phase 2/Phase 3A diagnostics、真实 authenticated 馆长/非馆长测试和冻结指纹全部通过：192/192 bookings owned、123 Reservations、135 Sessions、131 Parties、23 Payments、26 allocations/CAD 1,642.00，shadow mismatch 与 catch-up events 均为 0；authenticated 只有 `timezone` 单列 SELECT，其他配置和 writes 仍受 RLS/grants 保护。
- 上线后 security advisor 保持既有 47 条；performance advisor 从 40 INFO 增加一条 `multiple_permissive_policies` WARN。根因是旧 `venue_settings_rpc_only FOR ALL false` 与新 manager SELECT policy 都是 permissive，并在 SELECT 上重叠，而不是权限泄漏或数据错误。
- 按高风险门禁创建 Issue #131 并获得用户确认 authoring。第 42 个 migration 先 fail-closed 核对 RLS/FORCE RLS、精确 policies、timezone-only grant 和无 authenticated table/DML grants，再只删除冗余 false policy；DML 继续由 RLS 无适用 policy 默认拒绝和缺失 client grants 双重阻止。
- PGlite 实际应用 Phase 1/2/3A/41/42 migrations；新增 authenticated DML grant drift 负向用例证明 migration 会在 drop 前失败并只回滚自身。当前 14 项测试全部通过，生产 diagnostic 也新增唯一 permissive SELECT policy、无 DML policy 和最小 grants 断言。

阶段结果：Migration 41 已成为生产事实并修复真实 manager shadow access；migration 42 是可评审、未部署的 advisor regression 修复。它不改变业务数据、catch-up、dual-write、read path 或前端；merge/生产部署仍需独立明确授权，Phase 3B 未开始。

## 21. 2026-08-24：Phase 3A RLS policy consolidation 上线

- 用户在 fresh production preflight 后明确授权 PR #132 merge 与 Supabase 自动生产部署；preflight 确认远端仍为 41 个 migration、只有 migration 42 pending，Phase 2 diagnostic、RLS/grants、角色路径、四个冻结指纹、17-writer inventory 和 47/41 advisor 基线均符合预期。
- PR #132 于 13:47:59 UTC 合并；Supabase integration 于 13:48:37 UTC 应用 `20260824132704_phase_3a_venue_settings_policy_consolidation`，GitHub Pages 于 13:48:36 UTC 完成 build/deploy。
- migration 只删除 `venue_settings_rpc_only FOR ALL false`。上线后 manager SELECT 是 `venue_settings` 唯一 policy；authenticated 仍只有 `timezone` 单列 SELECT、没有 table/DML grant 或 DML policy，currency 不可读、timezone 不可更新。
- Phase 2 与 Phase 3A production diagnostics 均通过；真实 authenticated 馆长读到 `America/Toronto` 和 clean shadow status，非馆长看到 0 rows，summary RPC 明确拒绝。
- 192/192 bookings owned、123 Reservations、135 Sessions、131 Parties、23 Payments、26 allocations/CAD 1,642.00 保持不变；shadow mismatch/catch-up events 为 0，审计总数仍为 1,739，四个冻结指纹、17 个 public writers、private helper grants 和 Realtime boundary 均无漂移。
- Security advisor 保持既有 47 条；performance advisor 从 40 INFO + 1 个目标 WARN 恢复为 40 INFO。没有执行 catch-up、启用 dual-write、切换读取、修改前端或开始 Phase 3B。

阶段结果：Phase 3A 的 foundation、最小 timezone access 与 policy consolidation 均已成为生产事实，shadow 验证链路 clean，advisor regression 已关闭。旧 booking writers、group/link 语义和前端仍在运行；Phase 3B activation 继续需要独立 Issue、migration/PR、完整 writer coverage 与明确生产授权。

## 22. 2026-08-24：Reservation Phase 3B.1 inactive transaction kernel 起草

- 用户 review Issue #134 后明确确认只开始 Phase 3B.1 authoring；不授权 3B.2 activation、migration PR merge、生产自动部署/catch-up、read/UI cutover、Stripe 部署或 legacy decommission。
- 从最新 `origin/main` 建立 `codex/phase-3b-inactive-transaction-kernel`，用 Supabase CLI 2.115.0 追加本地第 43 个 migration 草案；生产与 `main` 仍为 42 个 migration，没有执行 `db push`。
- 新 schema 用 immutable transition/source/target/allocation/Party lineage 表记录 merge、split 与 reverse，并以 versioned membership 解析 current effective Reservation/Session；physical booking ownership 外键保持历史 origin，不因关系变化改写。
- 隔离 reverse-split 测试发现 Party lineage 必须支持多个 split Party 汇回同一 original Party；将 lineage identity 修正为 transition + source Party + target Party，正式表达 one-to-many 与 many-to-one，而不是丢弃重复关系。
- 付款 primitive 证明一人付清与 AA 可共用同一 append-only Payment/allocation ledger；跨 origin 合并使用 effective Reservation 作为收款 scope，refund 追加负数 entries。原 booking 价格、Payment、allocation 与 origin 均保持不变。
- private primitives 覆盖 attach、reschedule、cancel/restore、details + explicit Party lineage、payment/refund、merge/split/reverse；reverse 从当前 effective Session 生成新的 restored/projection Session，使合并后的排期或资料修改不会被旧值覆盖，分化 Session 也不会被错误合并。stable operation key、request fingerprint、固定锁顺序与事务超时保证重试和失败整体回滚。
- writer inventory 使用 schema-qualified canonical signatures 固定 17 direct writers、3 wrappers 与 2 undeployed Stripe paths；真实 `search_path` 差异不再造成误判，新增 rogue writer、client direct execute 或权限漂移均 fail closed。
- 新 read-only diagnostic 验证 inactive zero-row 状态、RLS/FORCE RLS、最小 grants、private function security、writer inventory、payment FK、无 public mutation/dual-write trigger/Realtime publication。PGlite 隔离测试覆盖 merge/split、付款、回滚、权限与诊断；真实 session contention 由下一条独立 CI 补充。
- 为把并发从静态设计变成可重复证据，新增 PR-only PostgreSQL 16 CI：完整应用 Phase 1/2/3A/3B.1 migration chain，以三个真实连接并发执行 same-key Payment retry、两笔 overlapping AA 与 competing full refund；本机无 Docker/Postgres 时用环境变量明确 skip，PR CI 不允许 skip。
- commit `ddda6a1` 已推送并建立 Draft PR #135。首轮 [Actions run 32746853283](https://github.com/tujiaqi2002/badminton/actions/runs/32746853283) 在 PostgreSQL 16.15、Node 22 与 pnpm 11.16.0 下得到 22/22 tests、0 fail、0 skip；真实并发、lint、build 全部通过。Supabase Preview 因未配置付费 preview branch 而按设计 skip，不代表 production-like Supabase apply 已完成。
- 2026-08-24 15:57 UTC 执行 merge 前只读 preflight：Git branch 0 behind / 2 ahead、PR mergeable clean；production 仍为 42 migrations。Phase 2/3A diagnostics、192/192 ownership、123/135/131/23/26 aggregate counts、CAD 1,642.00 ledger、0 shadow/catch-up、1,739 audit events、仅 `court_slots` Realtime、47/40 advisors 全部保持基线。
- fresh writer inventory 确认 17 direct、3 wrappers、0 missing/unsafe，236 个 public functions 总指纹仍为 `a0ec014bfec41a70762ce5c95122e774`。使用 3B.1 migration 内正式 canonical 算法得到 direct `a28b88496f1ed14e5cceed2a6cbc9b99`、wrapper `d1eb5d63d36f01f1caad2e4e9e516dbf`；旧 direct 值 `ac236997585da13cc6cc0439b8eafcf0` 无法按该算法复现，因此作为记录口径错误废止，而不是生产函数漂移。
- Supabase organization 是 Free plan，只有 production `main`；隔离 branch 报价为 USD 0.01344/小时。尚未取得付费 branch 创建授权，所以 production-like Supabase apply 仍未完成，production 未发生任何写入。

阶段结果：Phase 3B.1 已形成未激活、可评审的事务内核与中英文契约，Draft PR #135 的真实 PostgreSQL CI 与 fresh production read-only preflight 已通过，但尚未合并或部署。现有 public writer/read/UI 与生产数据完全未切换；下一步是经成本确认创建短时 Supabase branch 并完成 production-like apply，之后必须在独立授权下才可 merge/自动部署，再另行确认 Phase 3B.2 activation。

## 23. 2026-08-24：独立 Supabase staging 完成 Phase 3B.1 hosted apply

- 用户另建 `badminton_stage`（project ref `vcoujmzsgdboidndtzzg`）并明确授权按推荐顺序初始化；生产 `ldbtrouofmqmnkyxiewk` 始终排除在所有写操作之外。
- 独立项目为空库，而仓库第一个 migration 依赖更早的基础 schema。初始化因此从首个 migration 前的 Git schema 恢复基线，原样重放 migrations 1–37，再写入 192 条/131 group 的确定性 synthetic legacy fixture。所有客户邮箱均为 `example.invalid`，Auth 只有一个 synthetic manager，未复制生产 PII。
- Phase 1 原样应用后，新 aggregate 表为空且 192 个 legacy allocation 未拥有；插入 6 条 synthetic payment audit evidence 后，从 staging 读取四个数据指纹，只替换 Phase 2 中冻结的生产指纹。Phase 2 DDL/回填逻辑未改，并通过正式 diagnostic：123 Reservations、135 Sessions、192 allocations、131 Parties、23 Payments、26 allocation entries、CAD 1,642.00。
- Phase 3A 三个 migrations 原样应用并通过 diagnostic：192/192 owned、0 shadow mismatch。Phase 3B.1 migration 也成功安装，但首次 hosted diagnostic 抓到 writer inventory expected/candidate 使用不同 collation 导致相同集合排序不同。
- 按 append-only 规则新增 `20260824164530_phase_3b_writer_inventory_c_collation`，把 exact regprocedure signature 固定为 `C` collation；不回改 migration 43。修复后 hosted 3B diagnostic 通过：kernel 0 operation / 0 membership / 0 transition、17 direct / 3 wrapper、0 client mutation、0 dual-write trigger、0 新 Realtime publication。
- 这个发现同时纠正了旧 fingerprint 解释：`a28b...` 是 ICU/default ordering，生产按 `C` ordering 的 raw direct fingerprint 是 `ac236...`。Raw function definition 还受 LF/CRLF 与纯格式化影响，不再作为跨项目 equality gate；canonical signature set、security config、grants 和 wrapper indirectness 仍 fail closed，raw fingerprint 只做同库 before/after review。
- staging migration history 已移除一次性 bootstrap marker，并精确对齐仓库 44 个 version/name。27 张 public 表全部 RLS，6 张 3B 表全部 FORCE RLS；Phase 3B client DML 和 private helper client EXECUTE 均为 0，Realtime 仍只有 `court_slots`。
- Advisors 为 49 security（生产既有 47 + staging 项目自带 `public.rls_auto_enable()` 的 2 条已记录 WARN）和 74 performance INFO。4 个 composite-FK 提示逐项确认已有完整反向等值索引或唯一 `booking_id` 主键覆盖，不新增重复索引；其余 70 个 unused-index 提示来自 fresh synthetic 数据库无业务流量。
- 回滚型 payment probe 得到相同确定性 Payment ID 且未留下 Payment/operation；但连接器串行化请求，因此不把它算作并发锁证据。真实并发继续由 PostgreSQL CI 的 same-key、AA 与 refund race 用例负责。
- 最终 bundled Node `v24.19.0` / pnpm `11.19.0` 本地结果为 46 pass、0 fail、1 个无本地 PostgreSQL 时的明确 skip；lint/build 通过。推送 commit `699d11d` 后，[Actions run 32753722730](https://github.com/tujiaqi2002/badminton/actions/runs/32753722730) 在 PostgreSQL 16.15 上重新得到 22/22、0 fail、0 skip，真实 same-key Payment、AA 与 refund race 均通过。合并、生产自动部署、Phase 3B.2 activation、read/UI cutover、Stripe 与 legacy decommission 仍未授权。

阶段结果：production-like hosted Supabase apply 与 follow-up PostgreSQL CI 门禁均已完成，且在真正 merge 前发现并修复了一个 collation portability bug。生产仍是 42 migrations 和 legacy write/read path；下一步只能在 fresh production preflight 后由用户单独确认是否 merge/自动部署。

## 24. 2026-08-24：Reservation Phase 3B.2 在独立 staging 原子激活

- 按高风险门禁创建 Issue #136，并在用户确认后从 Draft PR #135 head 建立 `codex/phase-3b-atomic-writer-activation`。提交后建立 Draft PR #137，base 精确指向 `codex/phase-3b-inactive-transaction-kernel`，保持 3B.1 / 3B.2 一目标一分支。授权只包含 staging activation/validation；PR merge、production writes、read/UI cutover、Stripe 和 legacy decommission 仍被明确排除。
- 第 45 个 append-only migration 在一个 transaction 中冻结旧定义、移入 17 个 private legacy delegates，并以相同 public signatures 重建授权优先的 Phase 3B entries。3 个 wrappers 保持 indirect，最终边界为 17 public entries / 0 public direct legacy writers / 17 private delegates / 3 wrappers。
- 为表达移动、merge/split/reverse 后 physical/effective Session 的演进，新增 append-only `reservation_session_assignments` 和 membership pointer；controlled activation context 允许 legacy delegate 的事务中间态，deferred constraint 保证提交前 aggregate、legacy projection、payment 与 audit 一致。
- 新的 manager-only explicit-primary link RPC 支持不同客户 merge 与 single/equal/custom payment intent。旧 link 仅在 primary 无歧义时兼容；mark-paid 追加 Payment/allocation，paid 改为 unpaid 追加 refund，不删除旧账本事实。
- 多次 hosted `BEGIN`/`ROLLBACK` dry-run 在真实 PostgreSQL 17.6 中发现并修复六类只靠静态 review 难以发现的兼容问题：operation type 闭集限制、Session-assignment deterministic UUID 缺口、schedule-only membership transition shape、PostgreSQL 不支持 `min(uuid)`、legacy split 的 `legacy_unspecified` intent，以及 Phase 3A raw shadow 对新 effective relationship 的预期 mismatch。修复都进入同一 activation migration 并在真实应用前完成。
- activation 只应用到 `badminton_stage`，并将远端历史精确对齐 repo version `20260824172041`。该项目随后有 192 memberships、0 shadow/session/payment drift、0 incomplete operation、7 张 FORCE RLS Phase 3B 表、zero client DML/private EXECUTE，Realtime 仍只有 `court_slots`。
- synthetic hosted writer matrix 在一个外层 transaction 内覆盖 17 个 direct writers、explicit primary、permission rejection、idempotent retry 和 late rollback；运行中临时新建 8 条 booking，回滚后持久 stage 恢复 192 memberships 和 clean diagnostic。
- 多个真实 hosted connection 验证 same-key payment、same-booking competing schedules 和 overlapping merge scopes 无 drift；Phase 3B.1 的 PostgreSQL 16 CI 继续提供 same-key Payment、overlapping AA 与 competing refund 的 committed-winner 证据。
- emergency rollback artifact 在已激活 stage 上以外层 transaction 完整演练：内部成功恢复 17 public legacy writers 且不删除历史，外层 rollback 后持久 stage 恢复 activated 并无数据污染。
- performance advisor 在 activation 后报告 8 个 composite FK 列顺序缺口；第 46 个 performance-only follow-up 补全 8 个索引，`unindexed_foreign_keys` 降为 0。剩余 62 条全部为 INFO，主要是 fresh synthetic stage 的 unused indexes，不删除。
- Phase 2 diagnostic 在 staging synthetic fingerprints 下仍返回 123 Reservations、135 Sessions、192 allocations、131 Parties、23 Payments、26 allocations / CAD 1,642.00；Phase 3A diagnostic 已向前兼容 activated catalog 并保持 0 mismatch。Stage migration history 最终与 repo 46 个 version/name 完全一致。
- Codex bundled Node `v24.19.0` / pnpm `11.19.0` 的最终本地门禁为 26 tests 中 25 pass / 0 fail / 1 个无本地 PostgreSQL URL 的明确 skip，lint/build 通过，仅有既有 large-chunk warning。固定 Node 22 / pnpm 11.16.0 / PostgreSQL 16 PR CI 继续作为最终环境兼容门禁。
- Draft PR #137 实现提交的 [Actions run 32761921315](https://github.com/tujiaqi2002/badminton/actions/runs/32761921315) 在固定 Node 22 / pnpm 11.16.0 / PostgreSQL 16-alpine 中得到 26/26 pass、0 fail、0 skip，真实 Payment/AA/refund races、lint 与 build 均通过。Supabase Preview 仍因未配置付费 branch 而预期 skip，独立 stage 的 hosted apply/matrix/rollback 已另行完成。
- staging 验收后于 18:26 UTC 执行 fresh production read-only preflight：生产仍是 healthy PostgreSQL 17.6 / 42 migrations / Phase 3A，Phase 2/3A diagnostics 及 123/135/192/131/23/26 / CAD 1,642.00 对账通过，192/192 owned、0 shadow mismatch、17 direct + 3 safe wrapper、236 public functions、1,739 audits、composite payment FK、仅 `court_slots` Realtime、0 Edge Functions 和 47/40 advisor 基线全部无漂移。Phase 3B kernel/activation/Session assignment 明确尚未存在于生产。
- Git 同期为 `main` / #135 / #137 = 42 / 44 / 46 migrations，#135 相对 main 0 behind / 5 ahead，#137 相对 #135 0 behind / 3 ahead，两个 Draft PR 均 mergeable 且 CI green。因此生产顺序继续拆分：先只授权 #135 安装 inactive kernel 并验证，再独立决定 #137 activation；本次 preflight 不自动授权任何 merge。

阶段结果：Phase 3B.2 的 staging-only activation、writer matrix、hosted contention、diagnostics、advisors、emergency rollback rehearsal 和当时的 fresh production read-only preflight 已完成。生产在该时点仍为 42 migrations 且继续使用 legacy write/read path；#137 activation 仍需等 #135 inactive kernel 单独上线验证后重新授权。Legacy 下线仍属于 Phase 5。

## 25. 2026-08-25：Phase 3B.1 以未激活状态安装到生产

- 用户明确授权的边界只有合并 PR #135 并由 Supabase integration 自动安装 inactive kernel；不授权 PR #137 activation、read/UI cutover、Stripe 或 legacy decommission。
- 06:22 UTC fresh production preflight 确认远端仍为 42 个 migrations、PR 0 behind / 5 ahead 且 CI 全绿；Phase 2/3A diagnostics、17 direct writers / 3 wrappers、Realtime 与 47/40 advisor 基线均符合预期。
- PR #135 于 06:24:23 UTC 合并，merge commit 为 `e777071712ab47dea5739e718ab2a855037fb1c5`；Supabase integration 于 06:25:04 UTC 应用 migrations 43–44，[GitHub Pages run 32816825670](https://github.com/tujiaqi2002/badminton/actions/runs/32816825670) 通过。
- 上线后 Phase 2 / Phase 3A diagnostics 继续通过：123 Reservations、135 Sessions、192 Court allocations、131 Parties、23 Payments、26 allocation entries、CAD 1,642.00，192/192 owned、0 shadow mismatch。
- Phase 3B diagnostic 返回 `phase_3b_inactive_transaction_kernel_verified`；operation、membership、transition 均为 0，public mutation、booking dual-write trigger、Phase 3B Realtime publication 也均为 0。writer inventory 仍是 17 direct / 3 wrappers。
- Security advisor 保持 47（2 INFO / 45 WARN）；performance advisor 为 62 个 INFO，其中 4 个是已记录 composite-FK index 提示、58 个是 unused-index 提示，没有 WARN 或 ERROR。
- PR #137 继续保持 Draft 和 staging-only。生产没有启用新 writer、运行 catch-up、切换读取或退役任何 legacy 能力。

阶段结果：生产 migration history 已精确推进到 44，Phase 3B.1 的事务能力已安装但完全未激活。下一步若要进入 Phase 3B.2，必须单独 review PR #137、重新执行 fresh production preflight，并获得明确的 merge/生产激活授权。

## 26. 2026-08-25：Phase 3B.2 整理到最新 main 并完成重新验证

- 用户明确授权只把 Draft PR #137 整理到最新 `main`、把 base 改为 `main`，并重跑 staging、CI 与 production read-only preflight；不授权 merge、生产 migration/write/catch-up、read/UI、Stripe 或 legacy decommission。
- 为避免改写历史和 force-push，以非破坏性 merge commit `693ca38` 合入 `main` 的 #135/#138 内容；PR #137 随后改为 `main` base，保持 Draft / MERGEABLE / CLEAN。
- Staging 46-version history 与 migration 文件完全一致。Phase 2 diagnostic 使用同一 synthetic fingerprints 专门化后通过；Phase 3A 和 3B.2 diagnostics 也通过。17-writer matrix 在外层 transaction 内通过并回滚，持久 baseline 回到 192/192，所有 shadow/session/payment drift 与 incomplete operation 为 0。
- Fresh catalog security audit 确认新 explicit-primary RPC 是受控 manager entry：空 `search_path`、先调用 `private.require_manager()`、anon/public 无 EXECUTE，仅 authenticated/service_role 有入口。因此 staging security 正确基线是 50，不是旧记录的 49。
- Staging 的 unindexed-FK advisor 保持 0；writer matrix 前后 unused-index INFO 从 62 变为 60，证明这是会随访问统计变化的运行指标，不能当固定 schema fingerprint。
- Fresh production read-only preflight 于 07:05 UTC 通过：healthy PostgreSQL 17.6 / 44 migrations，123/135/192/131/23/26 / CAD 1,642.00、1,739 audits、236 public functions、17 direct / 3 wrappers，kernel 0/0/0。Activation/Session-assignment/explicit-primary objects 不存在，Realtime 仅 `court_slots`，Edge Functions 为 0，advisors 保持 47 security / 62 performance INFO。
- Bundled Node `v24.19.0` / pnpm `11.19.0` 本地为 25/26 pass、0 fail、1 个无本地 PostgreSQL 的明确 skip，lint/build 通过；fresh [Actions run 32819898640](https://github.com/tujiaqi2002/badminton/actions/runs/32819898640) 在 Node 22 / pnpm 11.16.0 / PostgreSQL 16 为 26/26、0 skip，lint/build 全绿。

阶段结果：#137 的准备与重新验证门禁全部 clean，但仍停留在 Draft。生产继续是 44 migrations 和 inactive 3B.1；只有新的明确授权才能合并 #137 并由 integration 激活 migrations 45–46。

## 27. 2026-08-25：Phase 3B.2 首次生产 activation 回滚并完成零价恢复验证

- 用户在独立 review 后明确授权合并 PR #137。PR 于 07:16:55 UTC 合并到 `main`，但 Supabase protected-branch deployment 在 migration 45 的最终 fail-closed assertion 返回 `payment=1` / SQLSTATE `55000`。整个 activation transaction 回滚；生产继续是 44 migrations、inactive 3B.1、17 direct writers + 3 wrappers、0 operation/membership/transition，且没有 activation objects 或 private legacy delegates。
- PII-free 只读诊断定位到唯一一条合法零价预约：total 和 allocation 都为 0、`pay_at_venue`、无 Payment/refund。旧 predicate 的 `0 >= 0` 误要求 paid，与 schema/manager override/Phase 3A projection/payment primitive 的既有零价语义冲突；没有修改该预约或伪造零金额 Payment。
- 创建 Issue #139 并在用户明确确认后开始 recovery。Migration 45 因从未进入生产 history，只修正最终 payment predicate；已应用旧 45 的 staging 通过 append-only migration `20260825074102` 收敛。Migration 47 要求精确 46-version baseline，以 `pg_get_functiondef` 唯一匹配旧/新 source shape，未知形状 fail closed，并保留 private security-invoker/empty-search-path/owner-only EXECUTE 边界。
- Staging 正式推进到 47 migrations。旧形状替换演练、新形状 no-op 演练、Phase 2/3A/3B diagnostics 和含 CAD 0 manager override 的 17-writer matrix 全部通过；持久数据回到 192/192，shadow/session/payment/incomplete-operation 全为 0。Advisors 保持 50 security 与 60 performance INFO（全部 unused index，0 unindexed FK）。
- Bundled Node `v24.19.0` / pnpm `11.19.0` 本地得到 27/28 pass、0 fail、1 个无本地 PostgreSQL 的明确 skip，lint/build 通过。新增 SQL truth table 覆盖零价、正价 unpaid/partial/paid、refund、paid-without-ledger 与 over-allocation。[Actions run 32823781076](https://github.com/tujiaqi2002/badminton/actions/runs/32823781076) 在 Node 22 / pnpm 11.16.0 / PostgreSQL 16 下为 28/28、0 skip，真实并发、lint/build 全绿。
- 07:43–07:44 UTC fresh production read-only preflight 再次确认 44 migrations、Phase 2/3A/3B.1 diagnostics clean、123/135/192/131/23/26 / CAD 1,642.00、kernel 0/0/0、17 direct + 3 wrappers；activation/Session-assignment/explicit-primary/private-legacy objects 不存在，Edge Functions 为 0，advisors 仍为 47 security / 62 performance INFO。

阶段结果：零价恢复已经在独立 staging 和 pinned CI 完成并建立 Draft PR #140，生产继续安全停在 44 migrations。PR merge 和再次触发 production migrations 45–47 仍需后续独立授权；read/UI、Stripe 与 legacy decommission 未进入本阶段。

---

## English record

### 24. 2026-08-24: Phase 3B.2 atomic staging activation

After Issue #136 received explicit confirmation, a separate branch was stacked on Draft PR #135, preserving one objective per branch. The scope remained staging activation and validation only; merge, production writes, read/UI cutover, Stripe, and legacy decommission were excluded.

Migration 45 atomically freezes and moves all 17 legacy direct writers to private delegates, recreates the same public signatures as authorization-first Phase 3B entries, and keeps the three wrappers indirect. It adds append-only Session assignment history, explicit-primary different-customer merge, stable idempotency, append-only Payment/refund behavior, and commit-time projection checks. Repeated hosted rollback dry-runs exposed and resolved operation-type, deterministic-ID, membership-shape, PostgreSQL UUID aggregate, legacy payment-plan, and Phase 3A shadow-compatibility issues before the real stage apply.

The activation was applied only to `badminton_stage`. The full synthetic 17-writer matrix, permission and retry paths, multi-connection payment/schedule/relationship contention, all Phase 2/3A/3B diagnostics, and an emergency rollback rehearsal passed. Migration 46 added eight ordered composite-FK indexes and reduced the unindexed-FK advisor count to zero. The stage history exactly matched 46 repository migrations and returned to a clean persistent 192-membership baseline after every rollback test. Bundled Node `v24.19.0` / pnpm `11.19.0` produced 25 passes, zero failures, and one explicit local-PostgreSQL skip across 26 tests; lint and build passed. [Actions run 32761921315](https://github.com/tujiaqi2002/badminton/actions/runs/32761921315) then passed 26/26 tests with zero skips plus lint/build under pinned Node 22 / pnpm 11.16.0 / PostgreSQL 16.

A read-only production preflight at that time passed with production healthy at 42 Phase 3A migrations. Phase 2/3A diagnostics, aggregate and ledger counts, 192/192 ownership, zero shadow drift, 17 direct writers plus three safe wrappers, 1,739 audit events, the composite payment FK, `court_slots`-only Realtime, zero deployed Edge Functions, and the 47/40 advisor baseline were unchanged. No production activation was authorized.

### 25. 2026-08-25: Phase 3B.1 installed in production while inactive

- The user explicitly authorized only merging PR #135 and allowing the Supabase integration to install the inactive kernel. PR #137 activation, read/UI cutover, Stripe, and legacy decommission were not authorized.
- The 06:22 UTC fresh production preflight confirmed 42 remote migrations, a 0-behind/5-ahead mergeable PR with green CI, clean Phase 2/3A diagnostics, 17 direct writers and 3 wrappers, unchanged Realtime, and the expected 47/40 advisor baseline.
- PR #135 merged at 06:24:23 UTC with merge commit `e777071712ab47dea5739e718ab2a855037fb1c5`. Supabase integration applied migrations 43–44 at 06:25:04 UTC, and [GitHub Pages run 32816825670](https://github.com/tujiaqi2002/badminton/actions/runs/32816825670) passed.
- Post-deployment Phase 2 and Phase 3A diagnostics still pass: 123 Reservations, 135 Sessions, 192 Court allocations, 131 Parties, 23 Payments, 26 allocation entries, CAD 1,642.00, 192/192 owned, and zero shadow mismatch.
- The Phase 3B diagnostic returns `phase_3b_inactive_transaction_kernel_verified`; operation, membership, and transition counts are zero, as are public mutations, booking dual-write triggers, and Phase 3B Realtime publications. Writer inventory remains 17 direct writers and 3 wrappers.
- Security advisories remain 47 (2 INFO / 45 WARN). Performance advisories are 62 INFO items: 4 recorded composite-FK index notices and 58 unused-index notices, with no WARN or ERROR.
- PR #137 remains Draft and staging-only. Production did not activate new writers, run catch-up, switch reads, or retire any legacy capability.

Stage result: production migration history now stops exactly at 44, with Phase 3B.1 transaction capabilities installed but entirely inactive. Entering Phase 3B.2 requires a separate review of PR #137, another fresh production preflight, and explicit authorization to merge and activate it in production.

### 26. 2026-08-25: Phase 3B.2 reorganized onto latest main and revalidated

The user authorized only reorganizing Draft PR #137 onto the latest `main`, changing its base to `main`, and repeating staging, CI, and production read-only preflight. Merge, production migration/write/catch-up, read/UI, Stripe, and legacy decommission remained unauthorized.

Non-destructive merge commit `693ca38` incorporated the merged #135/#138 history without rewriting or force-pushing. PR #137 now targets `main` and remains Draft, mergeable, and clean. Staging still matches all 46 repository migrations. The Phase 2 diagnostic passed after applying the same synthetic staging fingerprints, the Phase 3A and 3B.2 diagnostics passed, and the rolled-back 17-writer matrix returned the persistent database to 192/192 with zero drift or incomplete operations.

A live security audit confirmed that the new explicit-primary RPC has an empty `search_path`, immediately requires a manager, denies anonymous/public EXECUTE, and grants entry only to authenticated/service_role. The correct staging security count is therefore 50 rather than the previously recorded 49. Unindexed-FK notices remain zero; unused-index INFO moved from 62 to 60 after the matrix exercised two indexes, confirming that it is runtime usage data rather than a fixed schema fingerprint.

The 07:05 UTC production read-only preflight passed on healthy PostgreSQL 17.6 with 44 migrations, the 123/135/192/131/23/26 / CAD 1,642.00 reconciliation, 1,739 audits, 236 public functions, 17 direct writers and three wrappers, and an inactive 0/0/0 kernel. Activation, Session-assignment, and explicit-primary objects are absent; Realtime still publishes only `court_slots`, no Edge Functions exist, and advisors remain at 47 security / 62 performance INFO. Bundled Node `v24.19.0` / pnpm `11.19.0` passed 25/26 locally with one explicit no-local-PostgreSQL skip plus lint/build; fresh [Actions run 32819898640](https://github.com/tujiaqi2002/badminton/actions/runs/32819898640) passed 26/26 with no skips plus lint/build under Node 22 / pnpm 11.16.0 / PostgreSQL 16.

Stage result: every preparation and revalidation gate for #137 is clean, but the PR remains Draft. Production stays at 44 migrations with inactive Phase 3B.1; a new explicit authorization is required before merging #137 and allowing the integration to activate migrations 45–46.

### 27. 2026-08-25: First Phase 3B.2 production activation rolled back and zero-price recovery validated

After separate review, the user explicitly authorized merging PR #137. It merged at 07:16:55 UTC, but the protected Supabase deployment stopped in migration 45's final fail-closed assertion with `payment=1` and SQLSTATE `55000`. The whole activation transaction rolled back. Production stayed at 44 migrations with inactive Phase 3B.1, 17 direct writers plus three wrappers, zero operations/memberships/transitions, and none of the activation objects or private legacy delegates.

PII-free read-only diagnosis found one legitimate zero-price booking: total zero, allocation zero, `pay_at_venue`, and no Payment/refund. The old `0 >= 0` predicate incorrectly required paid, conflicting with the established schema, manager override, Phase 3A projection, and payment-primitive semantics. No booking was changed and no zero-value Payment was fabricated.

Issue #139 was created and recovery started only after explicit confirmation. Migration 45's final predicate is corrected because that migration never entered production history. Append-only migration `20260825074102` converges staging, where the old 45 was already recorded, by requiring the exact 46-version baseline and uniquely matching the old or corrected `pg_get_functiondef` source shape; every unknown shape fails closed. The assertion remains private, security invoker, empty-search-path, and owner-only.

Staging advanced to 47 migrations. Old-shape replacement and corrected-shape no-op rehearsals, Phase 2/3A/3B diagnostics, and the 17-writer matrix with a CAD 0 manager override all passed. Persistent state returned to 192/192 with zero shadow, Session, payment, or incomplete-operation drift. Advisors remained at 50 security and 60 performance INFO findings, all unused indexes and zero unindexed foreign keys.

Bundled Node `v24.19.0` / pnpm `11.19.0` passed 27 of 28 tests with zero failures and one explicit no-local-PostgreSQL skip; lint and build passed. The added SQL truth table covers zero-price, positive unpaid/partial/paid, refund, paid-without-ledger, and over-allocation. [Actions run 32823781076](https://github.com/tujiaqi2002/badminton/actions/runs/32823781076) passed 28/28 with zero skips plus real concurrency, lint, and build under Node 22 / pnpm 11.16.0 / PostgreSQL 16.

The 07:43–07:44 UTC production read-only preflight again confirmed 44 migrations, clean Phase 2/3A/3B.1 diagnostics, the 123/135/192/131/23/26 / CAD 1,642.00 reconciliation, a 0/0/0 kernel, and 17 direct writers plus three wrappers. Activation, Session-assignment, explicit-primary, and private-legacy objects are absent; zero Edge Functions are deployed, and advisors remain 47 security / 62 performance INFO.

Stage result: zero-price recovery is complete on the isolated stage and pinned CI, and Draft PR #140 is open, while production remains safely at 44 migrations. Merge and another production attempt for migrations 45–47 remain separately gated. Read/UI, Stripe, and legacy decommission are outside this phase.
