# Tiger Project Status

> 项目：`project-001-badminton`。核对日期：2026-08-25。当前工作分支：`codex/phase-3b-atomic-writer-activation`。

## 1. 一句话结论

Tiger 已经越过基础 MVP，进入**单馆运营 Beta / 私有馆长试运行**阶段：预订并发、馆长可视化排期和馆务配置已经相当丰富；独立数据库 staging 已建立，但自动 PR 预览、正式在线支付和普通客户开放尚未达到生产成熟度。

换句话说，当前主要问题不是“功能太少”，而是**功能增长快于工程保障**。下一阶段应优先稳定、验证和协作，不宜马上扩张到多商户、AI 或市场平台。

## 2. 当前可验证事实

- 仓库：`tujiaqi2002/badminton`，默认分支 `main`。
- 生产前端：`https://tujiaqi2002.github.io/badminton/`，由 GitHub Actions 从 `main` 发布。
- 后端：Supabase project `ldbtrouofmqmnkyxiewk`，PostgreSQL + Auth + Realtime + RPC/RLS。
- 独立数据库 staging：Supabase project `badminton_stage` / `vcoujmzsgdboidndtzzg`，已对齐 Phase 3B.2 Draft PR #137 的 46 个 migration，只含确定性合成数据，不复制生产客户或 Auth 数据。
- `main` 当前已包含 PR #135（Phase 3B.1 inactive kernel）与 docs-only PR #138（生产验证记录），以及此前 Phase 0/1/2/3A 与产品 PR。
- 生产 migration history 与 `main` 均为 44 个版本，最新为 `20260824164530_phase_3b_writer_inventory_c_collation`；当前没有 pending production migration。Kernel 已安装但仍未激活。
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

### Issue #136 / Draft PR #137：Reservation Phase 3B.2 atomic writer activation（整理到最新 `main`，不合并）

- #137 最初从 #135 head 叠加。#135 和 docs-only #138 已合并后，用户于 2026-08-25 明确授权把 #137 head 整理到最新 `main`、将 PR base 改为 `main`，并重跑 staging/CI/production read-only preflight；本次不授权 PR merge、生产 migration/write/catch-up、read/UI cutover、Stripe 或 legacy decommission。
- 第 45 个 append-only migration 在单一事务中原子激活全部 17 个 direct writer：既有 public signature 保持不变，旧定义冻结到 private legacy delegate，新 public entry 在调用 Phase 3B primitive 前先校验客户/馆长权限。3 个 wrapper 继续只间接委托，不形成旁路。
- activation 新增 append-only `reservation_session_assignments`，显式记录 physical/effective Session 投影变化；merge/split/reverse 继续以 transition、Party lineage 和 versioned membership 表达当前商业归属，不改写 booking origin。
- 新 manager-only `admin_link_booking_groups_with_primary(...)` 支持不同客户显式选主联系人，并选择 `single_payer` / `split_equal` / `split_custom`；旧双参数 link 只在 primary 唯一无歧义时兼容，不从姓名、电话或时间自动猜测。
- legacy “标记已付”现在在同一事务内追加 Payment/allocation ledger；已付改回未付通过追加 refund 表达，不删除或改写原付款历史。排期、资料、取消、关系和撤回都在同一事务中验证 aggregate + legacy projection + audit postconditions。
- 第 46 个 performance-only follow-up 为 8 个 composite FK 补齐与声明列顺序一致的索引；staging performance advisor 的 `unindexed_foreign_keys` 已从 8 降为 0。剩余项均为 INFO `unused_index`，其数量会随实际测试使用统计变化，不根据 fresh synthetic 流量删索引。
- hosted activation 后诊断返回 `phase_3b_atomic_writer_activation_verified`：46 个 migration、192/192 membership、0 shadow/session/payment drift、0 incomplete operation、7 张 Phase 3B public table 全部 FORCE RLS，client DML/private helper EXECUTE 为 0，Realtime 仍只有 `public.court_slots`。writer 边界为 17 public entries / 0 public direct legacy writers / 17 private legacy delegates / 3 wrappers。
- hosted writer matrix 覆盖 17 个 direct writer、显式 primary、权限拒绝、幂等重试与晚回滚；外层事务回滚后 staging 持久数据回到 192 memberships 且诊断仍 clean。多连接 contention 已验证 same-key payment、同 booking 竞争排期与重叠 merge scope；Phase 3B.1 CI 继续覆盖真实 committed-winner 的 Payment/AA/refund races。
- emergency rollback artifact 已在真实激活的 staging 中使用外层 transaction 完整执行：内层恢复 17 public legacy writers，保留所有 append-only history；外层 rollback 后 staging 回到 activated 状态且数据无污染。
- Phase 3A 旧诊断已向前兼容：未激活时仍校验 17 direct writers，激活后则校验 17/17/3 边界；Phase 2 使用相同 synthetic staging fingerprints 专门化后，与 Phase 3A hosted diagnostic 均在激活后通过。原样 Phase 2 diagnostic 会按设计对生产冻结指纹 fail closed，不代表 staging 数据漂移。
- #137 已通过非破坏性 merge 提交 `693ca38` 整理到最新 `main`，PR base 已改为 `main`，仍为 Draft / MERGEABLE / CLEAN。本地使用 bundled Node `v24.19.0` / pnpm `11.19.0` 得到 25/26 pass（1 个无本地 PostgreSQL 的明确 skip）、lint/build 通过；最新 [Actions run 32819898640](https://github.com/tujiaqi2002/badminton/actions/runs/32819898640) 在固定 Node 22 / pnpm 11.16.0 / PostgreSQL 16 下为 26/26、0 skip，lint/build 全绿。
- 07:04–07:05 UTC fresh revalidation：production 为 44 migrations 且 Phase 3B.1 inactive；staging 为 46 migrations。Production advisors 为 47 security（2 INFO / 45 WARN）和 62 performance INFO（4 unindexed FK + 58 unused）；staging security 为 50（2 INFO / 48 WARN），performance 在 writer matrix 前后由 62 变为 60 个 `unused_index` INFO，`unindexed_foreign_keys` 始终为 0。旧文档的 staging security 49 少计了 activation 新增的显式-primary manager RPC definer warning；现场复核确认该 RPC 固定空 `search_path`、先调用 `private.require_manager()`、匿名无 EXECUTE、仅 `authenticated` / `service_role` 可执行，因此是预期且受控的 manager entry 提示。
- Fresh production read-only preflight 全部通过：`ACTIVE_HEALTHY` / PostgreSQL 17.6、123/135/192/131/23/26 / CAD 1,642.00、1,739 audits、236 public functions、17 direct + 3 wrappers、0 operation/membership/transition。Activation table、Session assignment table、explicit-primary RPC 均不存在；Realtime 仅 `court_slots`，Edge Functions 为 0。#137 当前全部准备门禁已 clean，但这仍不构成 merge/生产 activation 授权，必须停下单独请求确认。

### Issue #134 / PR #135：Reservation Phase 3B.1 inactive transaction kernel（生产已安装，未激活）

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
- staging advisors 为 49 security（生产既有 47 + 项目自带 `rls_auto_enable()` 的 2 条已记录 WARN）和 74 performance INFO。4 条 composite-FK 提示均已有等价覆盖索引或唯一 `booking_id` 主键，不新增重复索引；其余 70 条是 fresh synthetic stage 的 `unused_index`。Production-like hosted apply 门禁已完成；follow-up [Actions run 32753722730](https://github.com/tujiaqi2002/badminton/actions/runs/32753722730) 在 PostgreSQL 16.15 上为 22/22、0 fail、0 skip，真实 same-key/AA/refund races、lint、build 均通过。这是 #135 merge 前的证据；当前未授权的是 #137 activation。
- 详细中英文设计见 [`docs/reservation-migration/phase-3b-inactive-transaction-kernel.md`](./docs/reservation-migration/phase-3b-inactive-transaction-kernel.md)，只读验证脚本为 [`supabase/diagnostics/phase_3b_inactive_transaction_kernel.sql`](./supabase/diagnostics/phase_3b_inactive_transaction_kernel.sql)。
- 上线后 Phase 2、Phase 3A 和 Phase 3B.1 diagnostics 全部通过：123 Reservations、135 Sessions、192/192 owned Court allocations、131 Parties、23 Payments、26 allocations / CAD 1,642.00，shadow mismatch 为 0。Kernel 精确为 `inactive`，operation / membership / transition 均为 0。
- Writer/security boundary 无漂移：17 direct / 3 wrapper，direct fingerprint `ac236997585da13cc6cc0439b8eafcf0`，wrapper fingerprint `d1eb5d63d36f01f1caad2e4e9e516dbf`；0 client mutation function、0 booking dual-write trigger、0 张 Phase 3B 表进入 Realtime。旧 public writer/read/UI 仍是生产权威路径。
- 生产 security advisor 保持既有 47（2 INFO / 45 WARN），没有 Phase 3B.1 新 security finding。Performance advisor 为 62 INFO：4 个已知 composite-FK column-order 提示 + 58 `unused_index`；无 WARN/ERROR。这 4 个提示已由尚未授权生产的 #137 performance follow-up 在 staging 清除。
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

## English update: Phase 3B production boundary

PR #135 merged at 2026-08-25 06:24:23 UTC after explicit authorization limited to the inactive kernel. The Supabase GitHub integration applied migrations 43–44 successfully, and GitHub Pages [run 32816825670](https://github.com/tujiaqi2002/badminton/actions/runs/32816825670) passed. Production now has 44 migrations and remains inactive: zero operations, memberships, and transitions; 17 unchanged direct writers and three wrappers; no client mutation function, booking dual-write trigger, or Phase 3B Realtime publication.

Issue #136 originally authorized atomic writer activation and validation only on `badminton_stage`. After #135 and docs-only PR #138 merged, the user authorized only reorganizing Draft PR #137 onto the latest `main` and repeating staging, CI, and production read-only preflight. Merge and production activation remain unauthorized. Migration 45 atomically replaces all 17 direct public writers with authorized Phase 3B entries while preserving the exact legacy definitions as private delegates; the three wrappers remain indirect. Migration 46 adds eight ordered composite-FK indexes and reduces the staging `unindexed_foreign_keys` advisor count to zero.

The hosted activation diagnostic is clean: 192 memberships, zero shadow/session/payment drift, zero incomplete operations, seven Phase 3B tables with FORCE RLS, no client DML or private-helper EXECUTE, and only `public.court_slots` in Realtime. The writer boundary is 17 public entries, zero public direct legacy writers, 17 private legacy delegates, and three wrappers. The synthetic hosted writer matrix, multi-connection contention checks, and an outer-transaction emergency rollback rehearsal all passed without persistent staging drift. The Phase 2 diagnostic must be specialized with the same synthetic staging fingerprints; running the production-fingerprint version unchanged intentionally fails closed and is not staging drift.

Draft PR #137 is now based directly on the latest `main` through non-destructive merge commit `693ca38`; it remains Draft, mergeable, and clean. Bundled Node `v24.19.0` / pnpm `11.19.0` again produced 25 passes, zero failures, and one explicit local-PostgreSQL skip across 26 reservation tests, with lint/build passing. Fresh [Actions run 32819898640](https://github.com/tujiaqi2002/badminton/actions/runs/32819898640) passed 26/26 with no skips plus lint/build under pinned Node 22 / pnpm 11.16.0 / PostgreSQL 16.

The 07:04–07:05 UTC fresh baseline is 44 production migrations and 46 staging migrations. Production advisors remain 47 security findings and 62 performance INFO items, including four unindexed-FK notices. Staging has 50 security findings and zero unindexed-FK notices; its unused-index INFO count moved from 62 to 60 after the writer matrix exercised two indexes, confirming that this runtime statistic is not a fixed schema fingerprint. The previous staging security total of 49 undercounted the intentional warning for the new manager-gated explicit-primary RPC. A live catalog audit confirmed its empty `search_path`, leading `private.require_manager()` check, anonymous denial, and EXECUTE grants limited to `authenticated` and `service_role`, so this is an expected controlled manager-entry notice.

The fresh production read-only preflight passed on healthy PostgreSQL 17.6 with 123 Reservations, 135 Sessions, 192/192 owned allocations, 131 Parties, 23 Payments, 26 allocations / CAD 1,642.00, 1,739 audit events, and 236 public functions. The inactive kernel remains at zero operations, memberships, and transitions with 17 direct writers and three wrappers. The activation table, Session-assignment table, and explicit-primary RPC are absent; Realtime still publishes only `court_slots`, and zero Edge Functions are deployed.

Draft PR #137 must remain Draft after the latest-main reorganization and all verification. Reads, UI, Stripe, and every legacy decommission action remain out of scope. A separate explicit authorization is still required to merge and activate it in production.
