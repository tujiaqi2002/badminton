# Tiger Product Context

> Tiger 羽球馆的长期产品上下文。最后核对：2026-08-27。

本文档是未来 Codex 任务和开发协作的产品事实来源。开始修改功能前先读本文；涉及数据库、安全、部署或权限时，同时阅读 [`TECHNICAL_CONTEXT.md`](./TECHNICAL_CONTEXT.md)。若旧聊天、截图或旧文档与本文冲突，以当前代码、数据库迁移和本文的最新决定为准。

## 1. 产品定义

Tiger 是为一家拥有五片场地的羽毛球馆打造的中英双语预约 PWA。它需要同时适配网页和手机，视觉简约、高级、安静，让客户或馆长第一时间回答：**哪片场地在什么时间有空？**

这不是通用场馆市场，而是一套服务单一球馆的运营系统，核心是快速预订、直观排期、可靠计价、清晰管理和可追溯操作。

### 品牌与场地

- 中文名：**Tiger 羽球馆**。
- 英文名：**Tiger Badminton Club**。
- 主基调：暖米纸色背景、水墨黑/灰信息层级、朱砂红强调、克制留白。
- 页面要有空间感，但不能浪费大屏左右空间；排期工具应尽量利用可用宽度。
- 当前五片场地名称：**壹、贰、叁、肆、伍 / Court 1–5**。
- 早期的“风、林、火、山、雷”已经废弃，不再作为客户可见名称。

## 2. 核心原则

1. **方便优先。** 高频动作应通过一次直接操作或一张短表单完成。
2. **关键信息就地可见。** 日期、场地、时段、支付、价格、备注与操作结果应出现在动作附近。
3. **数据库最终裁决。** 前端负责预览和体验，PostgreSQL 负责权限、冲突、计价与并发安全。
4. **快速操作必须可追溯。** 拖拽提高效率，撤回和日志弥补误操作风险。
5. **避免意外。** 无效落点不执行；原地落下不提示成功；破坏性动作要有明确意图或确认。
6. **配置必须真实生效。** 营业时间、价格、活动、时长、历史锁定应同步影响所有相关页面和数据库校验。
7. **中英功能对等。** 新功能必须同时提供中文和英文。
8. **渐进式复杂度。** 客户只看到简单预约流程；高级工具只向馆长展示。

## 3. 角色与当前访问策略

### 客户目标能力

- 登录后查看真实空闲状态，但看不到其他客户身份。
- 预订一个或多个场地。
- 选择时长、到场人数、付款方式，填写必填电话和可选备注。
- 确认前看到最终计算价格。
- 在“我的预订”查看状态、支付、金额、创建时间、历史记录与可取消性。

### 馆长能力

馆长拥有客户能力，并可访问：

- 预订管理。
- 场地监控。
- 馆务中心。
- 完整客户/订单资料。
- 新建、移动、缩放、置换、关联、取消和编辑订单。
- 营业时间、价格、活动、会员、日志和管理员权限管理。

馆长身份只能由数据库角色决定，前端禁止按邮箱硬编码判断。浏览器中保存的登录 token 只能证明用户身份，不能让普通用户获得馆长权限；数据库 RLS 和 RPC 会再次校验。

### 当前上线策略

当前生产版本是**私有馆长试运行版**：

- 进入应用必须先登录。
- 只有数据库中已邀请并授权的馆长能进入。
- 馆长登录后默认进入“预订管理”。
- 客户页面仍保留在代码中，但正式开放客户登录需要一次明确的 Auth/访问策略变更，不能顺手移除当前登录门槛。

公开仓库中禁止记录真实管理员邮箱、客户个人信息、数据库密码或密钥。

## 4. 信息架构

- **场地**：客户查看空闲和创建预订。
- **我的预订**：当前登录者自己的订单。
- **预订管理**：馆长排期编辑器与订单查询。
- **场地监控**：按周快速回答电话咨询。
- **馆务中心**：球馆级配置与运营工具。

顶部导航为简约、紧凑、固定的系统栏。点击头像进入可搜索的设置中心：

- 显示：字体大小滑杆、中文/English。
- 外观：7 套 UI 主题、馆长专属订单配色。
- 账户：当前账号与退出登录。

显示偏好目前保存在浏览器本地；除非以后明确增加账号同步，否则不写入数据库。

## 5. 客户预约

### 空闲状态

- 可查看今天和允许提前预订范围内的日期。
- 过去的开始时间不可预订。
- 客户开始时间网格按“客户最短预订”显示；当前推荐默认值为 60 分钟。
- 馆长运营网格仍可保持 30 分钟精度。
- 关闭日、营业时间、提前预订天数、阻止预订的活动和既有订单都必须影响空闲状态。

### 确认场次

客户可以：

- 多选场地。
- 在客户最短/最长时长范围内选时长。
- 选择到场人数（当前最多 8 人）。
- 填写必填联系电话。
- 填写可选备注。
- 选择可用付款方式。
- 确认前查看最终价格。

如果客户取消了全部场地选择，应保留“0 个已选”的真实状态并提示“请至少选择一个场地”。不能偷偷恢复旧场地，也不能允许空场地提交。

内部计价规则名称只给馆长看，客户只看到价格结果和必要说明。

### 价格与支付

- 按场地、时间片和对应规则计算。
- 跨价格时段的订单可由多个费率组成。
- 会员折扣在匹配场地/时段价格后应用。
- 多场地逐片计费。
- 到店支付当前可用。
- Stripe 只有在 Edge Functions、密钥、Webhook 和完整流程都验证后才能启用。

### 我的预订

每条订单显示日期、场地、开始/结束、时长、订单状态、已付/未付、最终金额和下单时间。符合取消规则时显示取消入口；取消窗口由馆务设置决定。

列表应优先帮助客户快速识别自己的场次：日期和时段作为第一扫描目标，场地、状态、支付、金额和下单时间以稳定的信息块展示；已取消、过期或未到场订单保持可读但视觉上弱于有效订单。不能为了视觉效果隐藏既有取消流程或订单信息。

同一次创建、同一时间段的多场地订单在“我的预订”中应作为一张多场地卡片展示，聚合显示场地数量、场地标识和总金额；在没有整组取消后端能力前，取消操作继续逐片场地展示并调用既有单条 booking 取消流程。

### 已确认的目标预约语义（写入已激活；馆长排期、详情与订单查询已 canonical）

Issue #118 已确认把现有 `booking_group_id` / `booking_link_id` 统一迁移到一个业务模型：**Reservation → Sessions → Court allocations**。Phase 3B.2 已在生产激活统一 transaction writer，Phase 4B 已把馆长 schedule/capacity、selected detail 与 order/search 三个读取面切到 canonical；现有 group/link action UI 和 public writer RPC contract 继续生效，RPC 内部由新内核维护 aggregate、ledger 与 legacy projection 的一致性。客户读取、聚合 action scope 与 legacy decommission 尚未切换。

- Reservation 表示一笔商业预约，可以包含多个日期、时间、时长不同的 Session；一个 Session 表示一次实际到场，并包含一个或多个 Court allocation。
- 馆长可以显式强制合并不同客户的 Reservation，例如夫妻分别来电后一次结算；系统必须二次确认并选择主要联系人，保留双方资料和原始来源，禁止按姓名、电话或邮箱自动合并身份。
- 联系人、参与者、原始预订人和付款人是可重叠但不同的 party roles；每笔 Reservation 最多一个主要联系人。
- 价格归属于 Court allocation。Reservation 总价由有效 allocation 金额推导；merge/split 不自动重算历史系统价或 manager override。
- 付款意向支持单人支付与 split；split 支持 equal/custom。意向不等于到账事实，实际 unpaid/partial/paid/refunded 状态由不可丢失的 payment ledger 推导。
- 移动默认作用于 Session；同一 Session 的多个场地一起移动。只移动一个 allocation 时，在同一 Reservation 内先拆成新 Session。
- 取消 RPC 必须显式收到 allocation/session/reservation scope；付款默认属于整笔 Reservation，但支持多人、多次、部分付款和精确分配。
- 周期预订是一组由 recurrence series 连接的独立 Reservations，不是一笔无限跨周 Reservation。
- 拆分时保留原 allocation ID、价格、创建时间和审计来源；付款使用追加冲销/重分配，不能复制、覆盖或删除历史账本。
- 不同 currency、不同 venue，或处于争议/退款处理中等不可安全迁移的账务状态时，普通合并必须拒绝。

分阶段设计、迁移门禁和完整验收标准以 [Issue #118](https://github.com/tujiaqi2002/badminton/issues/118) 为准；Phase 0 生产基线见 [`docs/reservation-migration/phase-0-baseline.md`](./docs/reservation-migration/phase-0-baseline.md)。

Phase 2 的历史回填使用内部 `legacy_unspecified` 付款意向，因为旧 booking 只证明 paid/pay-at-venue 状态，不能证明客户当时选择单人支付还是 split。它不会取消未来的 single/equal/custom 选项，也不会替历史记录虚构 payer、payment shares、provider 或时间。该 snapshot 已于 2026-08-24 回填生产，但前端和 RPC 尚未 read/write cutover；Phase 3 之前新产生的 legacy booking 仍可能没有 aggregate ownership，必须由后续 catch-up + dual-write reconciliation 处理。完整规则见 [`docs/reservation-migration/phase-2-backfill.md`](./docs/reservation-migration/phase-2-backfill.md)。

Phase 3A / Issue #128 的未激活兼容基础、`venue_settings.timezone` 单列权限修复及 Issue #131 的 RLS policy consolidation 已于 2026-08-24 进入生产：安全 legacy group 可以确定性、幂等 catch-up；已经分别属于不同 Reservation 的 group 再被 link/unlink，以及无法由旧字段证明的 merge/split 或付款变化，必须停下并显示 shadow mismatch，不能自动猜测。真实 authenticated 角色验证确认馆长可读 clean shadow status，非馆长看不到 venue/shadow rows，其他配置字段和 writes 继续 RPC-only。第 42 个 migration 只删除冗余 false `FOR ALL` policy，performance advisor 恢复到原有 40 个 INFO，权限、数据和冻结指纹均无漂移。完整中英文边界见 [`docs/reservation-migration/phase-3a-compatibility-foundation.md`](./docs/reservation-migration/phase-3a-compatibility-foundation.md)。

Phase 3B.1 / Issue #134 / PR #135 的事务内核于 2026-08-25 先以未激活状态安装；随后经 Issue #139 / PR #140 的独立授权与验证，Phase 3B.2 已在生产激活其 writer。现有 group/link/payment/status public RPC signature 与 legacy read path 保持兼容，但 17 个公开 writer 已在事务内维护 membership、Session/Party lineage、Payment/refund ledger、legacy projection 与审计。不同客户 merge 仍必须由馆长显式选择 primary contact，系统不自动推断；没有新增 Reservation Realtime publication。完整内核设计见 [`docs/reservation-migration/phase-3b-inactive-transaction-kernel.md`](./docs/reservation-migration/phase-3b-inactive-transaction-kernel.md)。

Phase 3B.2 / Issue #136 / PR #137 首次自动生产 activation 因零价边界的 fail-closed assertion 停止并整笔回滚。Issue #139 / PR #140 修正了零价一致性规则，并在独立合成 `badminton_stage` 与 CI 通过后获明确授权；生产于 2026-08-25 08:25 UTC 原子应用 migrations 45–47，writer activation 与上线后只读验收均已通过。当前产品语义如下：

- 一笔 Reservation 可以承载一个或多个旧 booking group；同一个人同时订多场地，与馆长后来关联多笔预订，都用同一类 aggregate/transition 模型表达，而不是两套互不相干的概念。
- 不同客户可以强制合并，但馆长必须显式选择 primary contact；旧 link 动作只在 primary 唯一无歧义时自动兼容。系统保留所有来源客户和 Party lineage，不合并或删除身份。
- 合并时付款意向可选 `single_payer`、`split_equal` 或 `split_custom`；历史无证据数据继续保留为内部 `legacy_unspecified`，不猜测当年由谁付款。
- 付款状态是 append-only ledger 的投影。“标记已付”创建 Payment/allocation；已付改回未付追加 refund，不覆盖原付款。一人、AA、部分付款与多次付款因此可以共存。
- 零价 allocation 不需要 Payment，ledger allocation 为 0 是一致状态；不得为了显示 `paid` 而伪造 CAD 0 receipt。正价 `paid` 必须与 ledger 精确相等，任何 over-allocation 都必须拒绝。未来 read/UI 可把零价显示为“免费 / No charge”。
- 移动与资料修改以 Session 为主要作用域；取消可按 allocation/session/reservation 明确选 scope；merge/split/reverse 只改变当前关系归属，不覆盖已有排期、价格、付款或审计历史。
- Phase 3B.2 只切换数据库写入实现，没有切换读取或界面；客户和馆长目前不会看到新 Reservation/Session read path 或新付款界面。当前 group/link 展示与 public RPC contract 继续有效，但写操作已由 Phase 3B transaction kernel 同步 aggregate 与 legacy projection。等 Phase 4 完成 read/UI cutover 并经过生产观察、rollback window 后，才能在独立 Phase 5 高风险 Issue 中评估旧字段和 RPC 下线。

Phase 4A.1 / Issue #142 / PR #143 已把目标馆长读取契约应用并验证于生产与独立 `badminton_stage`，但尚未切换任何 UI。新读取把“同时创建的多场地”和“后来关联的多笔预订”统一显示为同一类 Reservation：排期仍以一片 Court allocation 为渲染单位，但共享 effective Reservation / Session ID；订单列表以一笔 current Reservation 为单位；详情一次返回联系人 roles、Sessions、allocations、付款计划、Payment/ledger、来源与关系历史。付款状态只从有效 allocation 与追加式 ledger 推导，零价显示为 `no_charge`；legacy group/link ID 只做来源追溯。生产 diagnostic、真实角色权限与索引计划均已通过。完整中英文契约见 [`docs/reservation-migration/phase-4a-manager-read-contract.md`](./docs/reservation-migration/phase-4a-manager-read-contract.md)。

Phase 4A.1 不改变现有馆长或客户界面，也不新增客户登录。Phase 4A.2 已部署默认关闭的 legacy adapter/feature flag 和回退路径；Phase 4A.3 已完成一次受控生产观察并恢复默认关闭。只有后续 read/UI cutover、稳定 rollback window 与单独 Phase 5 授权完成后，才能 decommission 旧字段/RPC。

Phase 4A.2 已在 PR #145 合并并以默认关闭状态部署生产。前端现在有 versioned canonical DTO normalizer 和 legacy allocation adapter；只有把 `VITE_RESERVATION_READ_SHADOW` 设为精确 `true` 时，馆长排期才会在旧 booking rows 正常渲染后额外读取 canonical allocations 与 PII-free database status。影子结果不改变页面、loading、toast、按钮或任何写入。实时比较只覆盖同为一片 Court allocation 一行的排期；旧 booking-row 订单列表与新 Reservation-row 列表不会被强行逐行比较。

Phase 4A.3 曾在明确授权的短时窗口临时开启该变量，验证当前、前一周、返回当前与后一周四个馆长排期范围；四次 comparison/server status 均为 clean，两个只读 RPC 各 4 次 POST 均返回 HTTP 200。观察结束后变量已删除并重新部署，当前 workflow fallback 为 `false`，生产 bundle 再次裁剪 shadow 调用。Legacy bookings 全程是唯一页面来源；默认 schedule/order/detail cutover 仍分别属于 Phase 4B/4C。完整边界与证据见 [`docs/reservation-migration/phase-4a2-frontend-shadow-adapter.md`](./docs/reservation-migration/phase-4a2-frontend-shadow-adapter.md) 与 [`docs/reservation-migration/phase-4a3-production-shadow-observation.md`](./docs/reservation-migration/phase-4a3-production-shadow-observation.md)。

Phase 4B.0 已建立只在 loopback、本地 staging flag/environment 与精确 project-ref 全部匹配时出现的 password 测试入口，并用 `badminton_stage` 的 disposable manager/non-manager 完成真实 Auth 与馆长权限回归。Phase 4B.1 让馆长排期与容量监控直接读取 current Court allocations：同一 Reservation / Session 的多场地仍一片场地一张卡，但共享 effective identity；容量与排期共用同一数据。PR #151 安装 fail-closed Pages selector 后，production 已通过 exact `canonical` variable 启用该来源；读取失败会显示持续错误并隐藏排期/容量，不会把错误误报为全空，也不会 per-request 静默回旧数据。当时馆长订单列表/搜索与所有写操作仍是后续独立门禁；订单列表已在 Phase 4B.3 切换，所有 aggregate actions 与 legacy removal 仍分别属于 Phase 4C/5 门禁。完整生产证据与回退方式见 [`docs/reservation-migration/phase-4b1-production-cutover.md`](./docs/reservation-migration/phase-4b1-production-cutover.md)。

Phase 4B.2 已由 PR #154 进入 `main`，先完成 default-legacy 发布，再经独立授权把 production selected-detail selector 设为 exact canonical。馆长选中一片场地后会看到一张只读的统一 Reservation 卡，把主要联系人、其他参与人、整笔预约备注、当前 Session 备注、Session/allocation 范围、付款计划/已付/待付和 merge/split lineage 分开表达。同一 Reservation 的不同 Court allocation 共享商业详情与缓存，但当前 allocation / Session identity 继续严格核对；跨 Reservation 才发起新详情请求。生产真实观察、非馆长拒绝与 pre/post database diagnostic 均通过。现有编辑、付款、关联、移动和取消按钮继续保持 legacy booking writer scope；馆长 order/search 在本阶段当时未变，后续已由 Phase 4B.3 切换。客户读取、writer action、数据库模型与登录策略仍未改变。完整证据见 [`docs/reservation-migration/phase-4b2-production-cutover.md`](./docs/reservation-migration/phase-4b2-production-cutover.md)。

Phase 4B.3 已在确认的 Issue #157 范围内完成 canonical 馆长订单查询，并在 `badminton_stage`、production default-legacy 与独立 production canonical cutover 三道门禁中通过验证。订单列表单位从一片 Court allocation 改为一笔 Reservation；一笔预约无论包含多少 Session、日期、时段、时长或 Courts 都只出现一次。日期筛选通过命中的 Session 找到 Reservation，卡片同时区分“本次命中的场次”和“整笔预约完整范围”。搜索覆盖所有 Party，而非只覆盖 primary contact；卡片显示主要联系人和其他 Party 数。付款筛选与金额来自整笔 Reservation 的 canonical ledger projection。

Canonical 聚合卡当前只提供“在排期中查看”，并聚焦该 Reservation 当天的全部有效 allocations。它不提供含糊的单 booking 改期/取消入口；付款、移动、取消和关系动作必须在后续 Phase 4C 明确 allocation/session/reservation scope 后才能迁移。Production order/search 已通过 exact `canonical` selector 启用；回退是把变量设为 `legacy`/删除并重新部署，不需要数据库回滚。完整设计和生产证据见 [`docs/reservation-migration/phase-4b3-canonical-order-search.md`](./docs/reservation-migration/phase-4b3-canonical-order-search.md) 与 [`docs/reservation-migration/phase-4b3-production-cutover.md`](./docs/reservation-migration/phase-4b3-production-cutover.md)。

Phase 4C.1 / Issue #162 接受了第一个 canonical 馆长写入界面，但只覆盖 profile mutation。馆长必须显式选择 Reservation、当前 Session 或具体 Party，并选择变更原因；Reservation 只允许修改整笔 notes，Session 只允许修改当前场次 notes / 人数，Party 只允许修改该联系人的姓名、邮箱、电话。界面不能从 primary contact、当前选中 Court 或旧 booking row 隐式推断作用域。

Canonical profile editor 不提供付款状态、价格、场地、时间、取消、关系或 Party role 修改。并发版本过期时必须要求重新加载，网络重试复用同一 idempotency identity；错误不能静默改走 legacy writer。只有 selected-detail 与 profile 两个 selector 同时 exact `canonical` 时才启用该界面。PR #163 已把 database/frontend capability 安装到 production，但 profile selector 仍缺失并 fail closed 到 legacy；真实馆长继续看到旧“编辑资料”，新 RPC 没有收到页面调用。Production canonical profile UI 需要独立授权。完整契约与发布证据见 [`docs/reservation-migration/phase-4c1-profile-mutation.md`](./docs/reservation-migration/phase-4c1-profile-mutation.md) 和 [`docs/reservation-migration/phase-4c1-default-legacy-production-verification.md`](./docs/reservation-migration/phase-4c1-default-legacy-production-verification.md)。

Issue #165 接受了一个更简单的迁移前提：截至 2026-08-27，当前 Reservation/booking/付款/排期交易记录、2 条场馆活动、2 条场馆会员及唯一非馆长账号都只是馆长和项目维护者的测试数据，没有需要迁移的真实业务价值。后续不再为这些测试记录设计复杂的逐条修复或保留迁移；目标改为先证明可恢复，再在 staging 演练清理，最后经独立授权把 production 重置为干净的 canonical-first 基线。3 名馆长身份及其 staff/manager 授权、场地、定价、营业时间、会员等级、馆务/安全配置和 migration history 始终保留；普通客户登录仍不开放。R0/R1 证据见 [`docs/reservation-migration/reservation-reset-r1-backup-restore.md`](./docs/reservation-migration/reservation-reset-r1-backup-restore.md)。R2 已在 `badminton_stage` 完成真实 reset/restore、故障 rollback 与重复执行拒绝。R3A 又完成 fresh production read-only manifest、加密恢复验证，以及默认关闭的 production DB runner/独立 Auth runbook；这些工作不改变上述产品边界，也不授权 production/Auth 删除。下一门禁 R3B 必须再次明确确认最终 runner hash、4,327-row database purge 与唯一 non-manager Auth graph；证据见 [`docs/reservation-migration/reservation-reset-r2-stage-rehearsal.md`](./docs/reservation-migration/reservation-reset-r2-stage-rehearsal.md) 和 [`reservation-reset-r3a-production-preflight.md`](./docs/reservation-migration/reservation-reset-r3a-production-preflight.md)。

订单较多时，“我的预订”默认展示即将开始的订单，并提供 Upcoming/Past/Cancelled tabs、日期/场地/编号等搜索、折叠式高级筛选、已应用筛选 chip 与清除入口。结果按月份分组，筛选和搜索只改变列表可见性，不隐藏单张订单卡片上的既有信息或取消动作。

## 6. 馆长预订管理

预订管理是馆长最重要的工作区和默认落地页。

### 日期导航

- 快捷条固定显示周一到周日。
- 点击某天只高亮，不把它重排到第一格。
- 前一周/后一周按完整周移动，并落到目标周周一。
- 独立、醒目的“今天”按钮快速返回今天。
- 整个日期框可打开符合 Tiger 风格的自定义日期选择器。
- 切换日期或周后，预订详情回到 idle，不能残留上一天的选择。

### 网格布局

- 正常桌面宽度下，即使日志栏展开，也必须完整看到五片场地。
- 时间轴位于网格左侧；整点线比半点线更明显。
- 今天显示“现在”时间线。
- 今天已过去区域可轻微灰化以帮助定位；历史日期仍可查看。
- 左侧详情和右侧日志要紧凑，不能挤坏中间五列。
- 桌面端左侧详情、中央排期和右侧日志使用同一工作区高度，左右侧栏底部必须与排期网格底部对齐；内容超出时在侧栏内部滚动。

### 选中和详情

- 左键点击订单选中并在左侧嵌入显示详情。
- 点击外部空白或右键可取消选择。
- 订单关系菜单打开后，点击菜单和触发按钮之外的任意位置会关闭菜单；菜单内操作和拖拽连接保持可用。
- 不再显示单独占高度的“已选中预订”提示条。
- 详情包括姓名、邮箱、电话、备注、人数、场地/时间、下单时间、订单状态、支付状态、价格。
- 显式进入编辑模式后，可修改姓名、邮箱、电话、备注、人数和支付状态。
- 未付可通过快捷 checkbox 标记为已付；已付改回未付仍需进入编辑模式。
- 有备注的卡片在支付小标签旁显示简洁备注提示。

### 新建订单

馆长可通过三种方式新增：

- 点击空白格。
- 在空白时间段纵向拖出范围。
- 横跨连续场地列和时间段进行“圈地”，一次选中多个相邻场地。

新增表单支持：必填客户姓名；可选邮箱、电话、备注；单/多场地；30 分钟步进；人数；每周重复；价格预览；馆长手动改价。

重复周订必须在提交前列出所有不可用日期/场地并警告馆长。

### 直接拖拽改期

核心交互仍然是直接拖拽，不使用“拿起—再放下”的两阶段模式。

拖拽时：

- 馆长可按个人习惯选择自由移动、只换场地（保持日期与时间）或只改时间（保持日期与场地）；偏好保存在当前设备，不影响其他馆长。
- 圈选新增、移动/置换/跨日/取消、调整时长和关联拖拽的实时反馈统一显示在左侧详情区，包括操作类型、原位置、目标位置、作用范围与有效/无效状态。
- 拖拽期间不再插入横跨排期顶部的临时操作提示条，避免日期栏与网格发生纵向位移；拖拽结束或取消后，左侧恢复原预订详情或空状态。
- 原位保留安静虚影，显示原始时段。
- 跟随鼠标的卡片半透明并保持自身订单颜色。
- 落点预览清楚显示新的开始和结束时间。
- 30 分钟的短距离移动也容易操作。
- 无效落点明确拒绝，原卡不能突然消失。
- 落点与起点完全相同属于 no-op，不显示“改期成功”。
- 不使用刺眼的红色虚线框，以轻量背景高亮提示目标。

### 调整时长和进行中订单

- 拖动卡片右下角改变结束时间，步进 30 分钟。
- 馆长订单最短可为 30 分钟。
- 订单开始后不能移动开始时间或场地。
- 已开始订单仍可修改结束时间，只要求新结束时间晚于当前时间。
- 已取消“必须至少比现在晚 30 分钟”的额外限制。
- 已结束订单是否可改由“历史订单锁定”控制。

### 置换订单

当拖到已占用区域时，可在满足以下条件后原子置换：

- 落点至少与一个**其他**订单重叠。
- 落点订单连续填满源订单时长。
- 一个 4 小时订单可以与 2+2 小时或 2+1+1 小时等多个小订单置换。
- 匹配目标时排除源订单，禁止“自己和自己置换”。

置换要么全部成功，要么全部不变。

### 分组、关联和重复

- `booking group` 表示一次创建的多场地订单。
- 多场地 booking group 的拖动和缩放范围由馆务中心统一设置为“整组一起移动”或“只移动选中场地”；预订详情不重复展示该设置，拖动预览需要说明本次实际生效范围。
- 单场地移动不拆分订单，不清除 `booking_group_id` 或 `booking_link_id`。同组 booking 出现不同时段后，详情必须逐条显示真实场地和时间，不能继续假设整组同一时段。
- `booking link` 表示馆长后续将不同订单组关联起来。
- 被关联订单以后仍可拥有不同场地、日期、开始、结束和时长。
- 从选中详情/卡片的链接把手拖到另一订单，确认后建立关联。
- 关联的视觉只使用卡片右上角小链条 icon。
- 不使用“多场联订”文字、连锁边框、跨列线条或每个间隙重复图标。
- 周期订单只使用小型循环 icon，不需要侧边纹理。

### 取消、撤回和日志

- 右侧区域平时显示最近操作日志。
- 只有拖拽期间才变为红色“快速取消”落点。
- 拖入后仍需确认，避免误删。
- `Ctrl+Z` 用于撤回最近可撤回操作；交互层最多保留 5 次快速撤回。
- 日志栏最多显示 10 条关键操作并在内部滚动。
- 每条摘要直接说明：做了什么、客户、原场地/时间、现场地/时间、操作人、时间。
- 底部“查看详细操作日志”跳转馆务中心的完整查询。

## 7. 订单查询

查询区位于排期网格下方、订单列表上方。

- 默认范围：今天。
- 默认排除已取消订单。
- 支持今天、未来 7 天、未来 30 天、自定义日期范围。
- Canonical 单位是一笔 Reservation；多个日期、时间、时长和场地不会重复成多条订单。
- 支持 reference、所有 Party 的姓名/邮箱/电话、Session 备注和场地搜索。
- 支持 Reservation 状态和 canonical 支付状态筛选，包括部分付款、退款、免费和显式异常。
- 统计 Reservation 数、命中场地时长、独立 primary contact 数和今日命中的 Reservation 数。
- 每页最多 50 条，使用稳定 keyset cursor 支持前后分页。
- 按命中日期分组，一张卡同时显示主要/其他 Party、命中场次、整笔完整范围、Courts、状态和付款汇总。
- Canonical 卡当前只提供“在排期中查看”；改期、取消与付款 action 待后续明确作用域。Production 已启用 canonical 列表并完成中英文桌面/手机、API 与数据库 postflight 验证。

## 8. 场地监控

场地监控是独立馆长 tab，服务电话咨询。

- 固定周一到周日。
- 最小显示刻度为 1 小时。
- 每格显示空闲场地数量。
- 充足为安静绿色/中性，紧张为暖黄色，满场为红色。
- 过去时间灰化且不可新建。
- 点击有空的格子可跳到对应日期/时间的预订管理，快速代客下单。
- 预订管理中保留清晰入口提示馆长可使用场地监控。

## 9. 馆务中心

馆务中心是球馆级配置的长期承载位置。

### 总览与基础设置

- 今日营业时间、有效计价、未来活动、有效会员。
- 中英文名称、时区、币种。
- 提前预订天数、最小时间刻度。
- 客户最短/最长、馆长最长预订。
- 免费取消提前小时数。
- 历史订单锁定。

### 历史订单锁定

- 默认开启。
- 开启时馆长可查看历史订单，但不能移动或修改。
- 关闭后，授权馆长可以修改过去订单。
- 无论该设置如何，客户始终不能新订过去时间。

### 营业时间

- 每周七天独立配置开始、结束或整日关闭。
- 修改后必须同步影响场地页、预订管理、场地监控和数据库写入校验。

### 定价

规则可限定：单个/全部场地、一个/多个/全部星期、时间范围、会员等级、有效日期范围。

优先级使用“具体程度”解释，不向馆长暴露难懂的加权分数。一般顺序：特定日期优先于永久规则；再按会员、场地、星期、时间范围的具体程度排序；完全相同则最新修改优先。馆长界面需要直接预览实际计算结果。

数据库必须维持所有可预约营业时段的基础价格覆盖。

### 活动与闭馆

- 活动包含中英标题、类型、状态、开始/结束、适用场地、标记颜色、说明和阻止预订开关。
- “阻止新的预订”默认开启。
- 活动要出现在排期中，并在开启阻止时影响空闲和数据库校验。
- 保存时必须明确反馈冲突，不能静默忽略。

### 会员

- 按姓名、联系方式或会员号查询。
- 管理状态、等级、折扣、有效期和备注。
- 管理可复用会员等级。
- 只有明确匹配会员等级的计价规则才应用对应优惠。

### 管理员管理

- 馆长可按邮箱添加另一位馆长。
- 显示 invited、active、disabled 状态。
- 数据库实时裁决权限，停用后立即失去管理访问。
- 当前馆长不能停用自己。
- 系统至少保留一个 active 馆长。
- 添加权限不会自动发邮件，只登记允许登录的邮箱。

### 完整操作日志

即使排期旁边只显示精简摘要，馆务中心仍保留完整日志查询。支持日期、操作人、动作、实体和搜索条件，并可分页查看 before/after 详情。

## 10. 视觉与可访问性

### 主题

当前保留 7 套 UI：

1. UI 01 留白水墨。
2. UI 02 如虎添翼水墨。
3. UI 03 黄黑运动简约。
4. UI 04 高级黑白灰“专注·超越·如虎添翼”。
5. UI 05 黄色锦旗飞虎。
6. UI 06 彩色专注版。
7. UI 07 五色水墨。

主题只改变视觉，不改变业务规则。

### 订单颜色

- 使用可扩展、确定性的颜色生成，不循环复用 5 个固定颜色。
- 同一客户在同一排期中尽量保持可识别。
- 大量客户时仍能生成足够多的可区分颜色。
- 所有颜色统一感知明度，避免黄色显得刺眼、深蓝显得过重。
- 偏暖、低饱和、柔和，和米纸背景融合；视觉透明感约为 0.90–0.95。
- 文本对比度必须可读。
- 分组/关联不能只靠颜色表达。

### 字体和响应式

- 全局字体滑杆范围 90%–140%。
- 放大后导航、场地名、卡片、抽屉和表格不能溢出。
- 桌面优先完整五场地网格。
- 手机使用触控友好控件、安全区和紧凑抽屉，不能强制桌面宽画布。

## 11. 验收底线

- 两个并发的重叠订单最多成功一个。
- 客户不能读取他人身份和联系方式。
- 普通登录者即使手动请求也不能执行馆长 RPC。
- 多场地创建、组移动、置换、取消、关联必须原子执行。
- 馆务配置要影响全部相关页面和数据库校验。
- 前端不存在 service-role 或其他秘密凭据。
- 客户端不能修改审计日志。
- 拖拽时原位始终有清晰来源反馈，直到有效落点提交。
- 切日后不残留旧订单详情。
- 新文案必须中英双语。

## 12. 已废弃决定

除非用户重新明确决定，否则不要恢复：

- 风、林、火、山、雷场地名。
- 固定 07:00–22:00 营业时间。
- 只能预订 60/90/120 分钟。
- 使用 Supabase Dashboard 作为主要馆长后台。
- 当前私有试运行中的匿名浏览。
- 在前端用邮箱判断管理员。
- 五个固定颜色反复分配所有客户。
- 红色虚线拖拽目标。
- 永久显示快速取消区域。
- 单独占空间的“已选中预订”栏。
- 关联订单的文字、连锁边框或跨列连接线。
- 已开始订单结束时间必须比当前时间多 30 分钟。

## 13. 后续方向（尚未承诺完成）

- 正式开放客户 Auth 策略。
- Stripe 生产支付、退款。
- 通知和提醒。
- 财务报表、套票/月卡、导出。
- 多门店。
- 从当前实体日志扩展为更完整的 app-level audit log。

## 14. 维护规则

产品决定变化时，应在同一个 PR：

1. 更新本文。
2. 明确旧规则是废弃、继续支持还是由设置控制。
3. 涉及 schema、Auth、RPC、权限或部署时更新 [`TECHNICAL_CONTEXT.md`](./TECHNICAL_CONTEXT.md)。
4. 不根据旧截图或旧聊天推断当前生产行为。

## English update: Phase 4B.3 canonical Reservation order search

Under confirmed Issue #157, Phase 4B.3 completed canonical manager order search on isolated `badminton_stage`, then passed default-legacy production deployment and a separately authorized exact-canonical production cutover. The list unit is now one Reservation rather than one Court allocation: a Reservation containing multiple Sessions, dates, times, durations, or Courts still appears once. Date filters find Reservations through matching Sessions, and each card separates the matched schedule from the complete Reservation range.

Search covers every Party rather than only the primary contact, and cards show the primary contact plus the remaining Party count. Payment filters and totals use the Reservation-level canonical ledger projection. The aggregate card currently exposes only “View in schedule,” which focuses every effective allocation for that Reservation on the matched day. It deliberately omits ambiguous single-booking move, cancellation, and payment actions until a later phase defines allocation/session/reservation scope.

Production order/search now uses exact `canonical`. The cutover changed no writer/action, customer read, payment/pricing, Auth, Realtime, or database fact; rollback is selector-to-legacy/delete plus rebuild. Full bilingual scope and production evidence are in [`docs/reservation-migration/phase-4b3-canonical-order-search.md`](./docs/reservation-migration/phase-4b3-canonical-order-search.md) and [`docs/reservation-migration/phase-4b3-production-cutover.md`](./docs/reservation-migration/phase-4b3-production-cutover.md).

## English update: Phase 4A.1 production read contract and Phase 3B boundary

Phase 4A.2 merged in PR #145 and is deployed as a default-off manager shadow foundation. The frontend now has versioned canonical DTO normalizers and a legacy allocation adapter. Only exact `VITE_RESERVATION_READ_SHADOW=true` causes the verified manager schedule path to fetch canonical allocations and the PII-free database status after the legacy booking rows load. Shadow results do not change UI, loading, toasts, buttons, mutations, or customer reads. Live comparison is limited to schedule allocations because both models have the same row cardinality. Legacy booking-row order search and canonical Reservation-row search are not forced into a misleading row comparison.

Phase 4A.3 temporarily enabled the flag under explicit approval and exercised four production manager-schedule ranges. All four client/server comparisons were clean, and both read-only RPCs completed four POST requests with HTTP 200 responses. The temporary variable was then deleted and the site rebuilt; the workflow again falls back to false and the production bundle has compiled the shadow call away. Legacy bookings remained the sole UI source. Visible schedule and order/detail adoption remain separate Phase 4B/4C gates. Full bilingual scope and evidence are in [`docs/reservation-migration/phase-4a2-frontend-shadow-adapter.md`](./docs/reservation-migration/phase-4a2-frontend-shadow-adapter.md) and [`docs/reservation-migration/phase-4a3-production-shadow-observation.md`](./docs/reservation-migration/phase-4a3-production-shadow-observation.md).

Phase 4B.0 established a password test entry that appears only when the loopback host, local staging flag/environment, and exact expected project ref all match. Disposable manager and non-manager identities in `badminton_stage` completed real Auth and manager-permission regression. Phase 4B.1 now renders the production manager schedule and capacity directly from current Court allocations. Multiple Courts in one effective Reservation/Session remain one card per physical allocation while sharing effective identities, and schedule/capacity consume the same rows. PR #151 installed a fail-closed Pages selector, and production enables the source through the exact `canonical` variable. A canonical read failure keeps a persistent error visible and hides schedule/capacity instead of claiming full availability or silently falling back per request. At that gate manager order/search and every write action remained later work; Phase 4B.3 has since switched manager order/search, while every aggregate action and legacy removal still requires Phase 4C/5 gates. Full production evidence and rollback instructions are in [`docs/reservation-migration/phase-4b1-production-cutover.md`](./docs/reservation-migration/phase-4b1-production-cutover.md).

Issue #165 accepts a simpler migration premise: as of 2026-08-27, the current reservation/booking/payment/schedule records, two venue events, two venue members, and the sole non-manager account are test-only and have no business-retention requirement. R0/R1 proved the exact retention boundary and encrypted recovery; R2 has now completed a real synthetic reset/restore, failure rollback, and second-run rejection in `badminton_stage`. A clean canonical-first production baseline still requires a separate destructive gate. The three manager identities and their staff/manager authorization, venue configuration, pricing, opening hours, member-tier definitions, security/configuration history, and migration history remain protected; ordinary customer login remains closed.

Phase 4B.2 entered `main` through PR #154, completed a default-legacy deployment, and then received separate authorization for an exact-canonical production selected-detail cutover. Selecting one Court allocation now gives the manager a read-only canonical Reservation card that separates the primary contact, other Parties, Reservation notes, selected-Session notes, Session/allocation scope, payment plan/paid/outstanding amounts, and merge/split lineage. Sibling Court allocations share the commercial detail and cache while selected allocation/Session identities remain strict; crossing Reservations issues the next request. Live manager observation, non-manager denial, and pre/post database diagnostics passed. Existing edit, payment, relationship, move, and cancellation controls retain their legacy booking writer scopes. Manager order/search was unchanged at this gate and later switched in Phase 4B.3; customer reads, writer actions, the database model, and login policy remain unchanged. Full evidence is in [`docs/reservation-migration/phase-4b2-production-cutover.md`](./docs/reservation-migration/phase-4b2-production-cutover.md).

Issue #142 / PR #143 Phase 4A.1 has installed and verified the target manager read contract in production and isolated `badminton_stage`; no UI has switched. The contract presents multi-court allocations created together and bookings linked later as the same Reservation concept. Schedule still renders one physical Court allocation per row but shares effective Reservation/Session IDs, Reservation search returns one current aggregate per row, and detail returns Party roles, Sessions, allocations, payment shares, Payment/ledger facts, source facts, and relationship history in one call. Production diagnostics, real-role permission checks, and index plans passed.

Money state is derived only from effective allocation prices and the append-only ledger, with zero-price Reservations reported as `no_charge`. Legacy group/link IDs are source trace fields rather than ownership. Phase 4A.1 changed no live manager/customer UI and opened no customer login. The deployed Phase 4A.2 frontend foundation keeps both a legacy adapter and an off-by-default feature flag; Phase 4A.3 verified the shadow path and rollback without changing the default UI. Legacy fields and RPCs remain until separately authorized read/UI cutovers, a stable rollback window, and Phase 5 decommission. The full bilingual contract is in [`docs/reservation-migration/phase-4a-manager-read-contract.md`](./docs/reservation-migration/phase-4a-manager-read-contract.md).

Phase 3B.1 / PR #135 was first installed in production on 2026-08-25 as an inactive transaction kernel. After separate authorization and validation under Issue #139 / PR #140, Phase 3B.2 is now active in production. Existing group/link/payment/status public RPC signatures and legacy reads remain compatible, while all 17 public writers now maintain memberships, Session/Party lineage, Payment/refund ledger facts, legacy projections, and audit integrity in one transaction. No Reservation table was added to Realtime.

The private kernel provides merge/split/reverse lineage, Session and Party lineage, one-payer/AA payments, and append-only refunds. Different-customer merge still requires an explicit manager-selected primary contact.

Phase 3B.2 / PR #137's first automatic production activation stopped at a fail-closed zero-price assertion and rolled back in full. Issue #139 / PR #140 corrected the zero-price consistency rule, passed isolated `badminton_stage` and CI validation, and was then explicitly authorized. Production atomically applied migrations 45–47 at 2026-08-25 08:25 UTC; post-deployment diagnostics are clean. This switches no read path or UI.

The accepted model treats a Reservation created as a multi-court group and a Reservation later assembled from linked booking groups as the same business concept: one commercial Reservation containing one or more Sessions and Court allocations. Different customers may be force-merged only through an explicit primary-contact choice, while all source identities and Party lineage remain preserved. The payment intent may be `single_payer`, `split_equal`, or `split_custom`; unverifiable historical intent remains `legacy_unspecified`.

Payment status is a projection of an append-only ledger. Marking paid records a Payment and allocations; changing paid back to unpaid appends a refund instead of rewriting the original payment. Schedule and detail changes are primarily Session-scoped, cancellation must use an explicit allocation/session/reservation scope, and merge/split/reverse changes current relationship ownership without overwriting schedule, price, payment, or audit history.

A zero-price allocation requires no Payment, and a zero ledger allocation is consistent; the system must not fabricate a CAD 0 receipt merely to mark it paid. Positive paid balances must reconcile exactly, and every over-allocation is rejected. A future read/UI phase may label zero-price items “No charge.”

Production still presents the legacy group/link behavior, and existing public RPC contracts remain compatible, but writes now run through the Phase 3B transaction kernel and keep the new aggregate model synchronized. Customers and managers see no new Reservation/Session read path or payment UI. Legacy RPCs and fields cannot be retired until a separately authorized Phase 4 read/UI cutover has completed, production has passed its observation and rollback window, and a separate high-risk Phase 5 issue authorizes decommissioning. Stripe also remains a separate future decision.
