# Reservation migration Phase 0 baseline

> Captured: 2026-08-23 06:41:58 UTC
>
> Production project: `ldbtrouofmqmnkyxiewk` (`ACTIVE_HEALTHY`, PostgreSQL 17.6)
>
> Parent design: [Issue #118](https://github.com/tujiaqi2002/badminton/issues/118)
>
> Phase issue: [Issue #119](https://github.com/tujiaqi2002/badminton/issues/119)

## 结论

Phase 0 对 Phase 1 给出 **Conditional GO（有条件通过）**。

现有生产数据没有发现会阻止“只加不删”schema 的结构性异常：本地和远端 migration 完全一致；有效 booking 与 `court_slots` 一一对应；没有有效场地时间重叠；group、link、recurrence、价格和 currency 的关键不变量成立。按已确认的确定性规则，当前 131 个 legacy booking groups 可以映射为 123 个 Reservations、135 个 Sessions、192 个 Court allocations。

这个结论不授权执行 migration、backfill、部署或生产写入。Phase 1 必须满足本文列出的安全门禁并经过独立 Issue/PR 评审。

## 范围与安全边界

本阶段只执行只读 metadata、aggregate 和 advisor 检查：

- 没有执行 DDL、DML、migration、RPC mutation、Edge Function 部署或配置修改；
- 没有输出客户姓名、邮箱、电话、备注、用户 ID、booking ID 或付款 provider reference；
- 只记录无法反推个人身份的计数、金额汇总、schema metadata 和约束结果；
- 可复跑查询位于 [`supabase/diagnostics/phase_0_reservation_baseline.sql`](../../supabase/diagnostics/phase_0_reservation_baseline.sql)，并由 `READ ONLY` transaction 包裹。

## 1. 环境与 migration 对账

| 项目 | 结果 |
| --- | --- |
| Supabase project | `ldbtrouofmqmnkyxiewk`, `ACTIVE_HEALTHY`, `us-west-2` |
| PostgreSQL | 17.6（平台 build `17.6.1.155`） |
| DB session timezone | `UTC` |
| Venue timezone / currency | `America/Toronto` / `CAD` |
| 历史锁定 / 多场地拖动 | `true` / `single` |
| 本地 migration | 37 |
| 远端 migration | 37 |
| 首个 / 最新版本 | `20260812161833_private_manager_schedule` / `20260821003535_booking_relationship_management` |
| Local-only / remote-only | 0 / 0 |
| 已部署 Edge Functions | 0 |

Migration history 对齐，Phase 1 可以从最新 migration 之后追加新文件；不得修改已应用的 37 个版本或重新执行 `supabase/schema.sql`。

## 2. 生产数据基线

### Booking、group、link 与 slot

| 指标 | 全部历史 | 当前有效（`held` / `confirmed`） |
| --- | ---: | ---: |
| `bookings` / Court allocation rows | 192 | 139 |
| `booking_group_id` | 131 | 104 |
| 多行 groups | — | 17 |
| `booking_link_id` clusters | 5 | 5 |
| linked groups | 13 | 12 |
| `court_slots` | 139 | 139 |

补充事实：

- 当前没有 `held` 行，139 条有效行全部是 `confirmed`；
- 9 个 legacy group 出现“部分已取消”，所以新模型不能假设 group 只有全有效或全取消两种状态；
- 全历史有 4 个 group 包含不同 schedule；当前有效 group 中为 0；
- group 内不存在不同 `booking_link_id` 或 link/null 混合，适合确定性 backfill；
- `court_slots` 缺失、残留、字段不一致均为 0。

### Link cluster 已经表达的真实业务

5 个有效 link clusters 中：

| 特征 | cluster 数 |
| --- | ---: |
| 包含不同日期/时间 | 3 |
| 包含不同时长 | 3 |
| 混合付款状态 | 1 |
| 不同客户姓名快照 | 3 |
| 不同非空邮箱快照 | 3 |
| 不同非空电话快照 | 1 |
| 混合“有/无邮箱” | 1 |
| 多 currency | 0 |

这验证了目标模型的必要性：现有 link 不是单一 Session，而是可以包含不同 Session、party 和 payment state 的 Reservation 来源。迁移不能把整个 link cluster 压成同一时段或同一客户。

### Recurrence

| 指标 | 结果 |
| --- | ---: |
| Recurrence series | 2 |
| 有效 series | 2 |
| Occurrence groups | 6 |
| Week 范围 | 1–4 |
| 同一 series/week 重复 group | 0 |
| series/week 只填一边 | 0 |
| group 内 recurrence 不一致 | 0 |

因此可以保持“一周一笔独立 Reservation、由 recurrence series 关联”的已确认规则。

## 3. 金额、计价与付款基线

所有历史记录都使用 CAD：

| 范围 | Court rows | 金额 |
| --- | ---: | ---: |
| 全部历史 | 192 | CAD 11,641.39 |
| 当前有效 | 139 | CAD 8,355.39 |
| 行上标记为 `paid` | 26 | CAD 1,642.00 |

当前 status/payment 分布：

| Booking status | Payment status | Payment method | Price source | Rows | Amount |
| --- | --- | --- | --- | ---: | ---: |
| `cancelled` | `paid` | `venue` | `system` | 1 | 98.00 |
| `cancelled` | `pay_at_venue` | `venue` | `system` | 52 | 3,188.00 |
| `confirmed` | `paid` | `venue` | `system` | 25 | 1,544.00 |
| `confirmed` | `pay_at_venue` | `venue` | `manager_override` | 1 | 0.99 |
| `confirmed` | `pay_at_venue` | `venue` | `system` | 113 | 6,810.40 |

计价检查全部通过：system price 为空、override shape 错误、override total 不一致、负金额和非 CAD 均为 0。唯一 manager override 将系统价 CAD 55.00 改为 CAD 0.99；迁移必须原样保留两者、override source 和历史时间，不得重新计价。

生产数据没有 Stripe booking、checkout session、payment intent、refund 或 failed payment。Stripe Edge Functions 也未部署，当前付款事实只来自馆长手工状态和审计。

### 历史付款可重建性

| 指标 | 结果 |
| --- | ---: |
| 标记为 `paid` 的 Court rows | 26 |
| 有 `booking.payment_updated` 审计的 paid rows | 5 |
| 没有专门付款审计的 paid rows | 21 |
| `payment_updated` operations / events | 2 / 6 |
| 已取消但仍标记 paid | 1 |

这是 Phase 2 的主要账务限制：21 条记录无法可靠还原原付款批次、付款人或 provider。回填时只能创建明确标记为 `legacy_reconciliation` 的 reconciliation payment/allocation，并保留来源 booking；不得虚构 payer、时间、provider reference，也不得把 `pay_at_venue` 伪造成成功付款。

## 4. 完整性、并发与审计

| 检查 | 异常数 |
| --- | ---: |
| 有效 booking 缺少 slot | 0 |
| 非有效 booking 残留 slot | 0 |
| Slot projection 字段不一致 | 0 |
| 同一 court 的有效时间重叠 | 0 |
| 无效/零长度区间 | 0 |
| 空 `booking_group_id` | 0 |
| 未 validated constraints | 0 |
| 缺少匹配索引的 FK | 0 |
| DB deadlocks / conflicts（自 2026-07-24 stats reset） | 0 / 0 |

现有 `bookings_no_time_overlap` 是已验证的 GiST exclusion constraint；`bookings` 的 slot 同步、未来时间、venue rules、audit 和 `updated_at` triggers 都存在。Phase 1 必须保留这些边界：只新增 nullable parent FKs，不能削弱现有 overlap constraint 或 slot projection。

审计表情况：

- `private.app_audit_events`: 1,547 events、649 operations、213 entity pairs；所有 192 个 booking 都至少有一条 audit event；
- `private.booking_admin_actions`: 1,308 legacy rows；
- booking audit 主要包括 cancelled 295 events / 123 operations、created 121 / 79、details updated 161 / 21、linked 23 / 8、payment updated 6 / 2、rescheduled 801 / 435、reverted 53 / 16；
- audit 表有 immutable trigger，客户端不能直接 update/delete。

数据规模很小：最大表 `private.app_audit_events` 约 4.25 MB。当前 autovacuum/autoanalyze 正常，没有分区或手工维护需求；也不能仅因 advisor 显示 `unused_index` 就删除索引。

## 5. RLS、grants 与 RPC 安全基线

- 15 个 public/private 业务表全部启用 RLS；private audit/manager 与 venue 表同时启用 FORCE RLS；
- `anon` 对 public/private 业务表没有直接 table grants；`authenticated` 只有 booking/slot/court/staff/profile 的必要读取及 profile 自身更新，没有 core booking 的通用写权限；
- `anon`/`authenticated` 没有 private schema `USAGE`；
- booking、slot、court 的馆长读取 policy 使用 `staff_members` 与 `(select auth.uid())`；profile 使用 own-row `USING` + `WITH CHECK`；
- `court_slots` 是 `supabase_realtime` publication 中唯一的 public 业务表；当前没有 public/private views；
- public/private 中共扫描到 250 个 routines（包括 extension routines），58 个 `SECURITY DEFINER`，其中 46 个在 public；43 个 public definer 可由 `authenticated` execute；
- 所有现有 definer 都设置了明确 `search_path`，没有缺失；
- 16 个 public admin definer 没有直接调用统一的 `private.require_manager()`：15 个仍有等价的 `auth.uid()` + `staff_members` 内联校验，1 个 `admin_create_booking` 是调用安全 multi-booking RPC 的 wrapper。现状仍是数据库端授权，但实现风格不统一，后续不得简单写成“所有 RPC 都调用 helper”。

## 6. Supabase advisors 与当前平台变化

### Security advisor

共 47 条：

| Level | 数量 | 内容 | Phase 0 判断 |
| --- | ---: | --- | --- |
| INFO | 2 | `private.manager_accounts`、`public.venue_member_tiers` RLS enabled but no policy | 当前 direct grants/schema access 已关闭，实际为 deny-by-default；Phase 1 新表仍需显式 policy/grants |
| WARN | 1 | `btree_gist` 位于 public | 现有 exclusion constraint 依赖它；本迁移不移动 extension |
| WARN | 43 | authenticated 可执行 public `SECURITY DEFINER` | 当前均有 fixed search path 和 server-side auth boundary；Phase 1 只增加最小公开 wrapper，并显式 revoke default execute |
| WARN | 1 | Leaked password protection 未启用 | 当前 Google/OTP manager-only 不阻塞 Phase 1；开放 password/customer auth 前必须处理 |

参考：[RLS no policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)、[extension in public](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public)、[definer executable](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)、[password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。

Performance advisor 只有 19 条 INFO 级 `unused_index`，没有更高等级 performance finding。生产数据和运行时间不足以证明这些索引无用，Phase 0 不删除任何索引。

### 影响 Phase 1 的最新平台事实

- Supabase 已宣布新建 public tables 不再默认暴露给 Data/GraphQL API，并计划在 2026-10-30 对所有项目执行新默认。Phase 1 必须在 migration 中显式定义 RLS、table grants 和 function execute，不能依赖 Dashboard 默认行为。参考 [breaking-change notice](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)。
- Extension version pinning 已弃用；Phase 1 不 pin extension version，也不移动当前 `btree_gist`。
- `realtime` schema 已锁定；Phase 1 不直接修改该 schema。后续如需新 read model 的 Realtime，只通过受支持的 publication 配置单独评审。
- 平台已停止 Node 20 支持；仓库 CI 使用 Node 22，当前方向兼容。

参考：[Supabase changelog](https://supabase.com/changelog)、[database migrations](https://supabase.com/docs/guides/deployment/database-migrations)。

## 7. 确定性 backfill 冻结值

如果在本快照上按 #118 的规则回填，必须得到：

| Target entity | 全部历史 | 当前有效 |
| --- | ---: | ---: |
| Reservations | 123 | 97 |
| Sessions | 135 | 104 |
| Court allocations | 192 | 139 |
| Legacy group party snapshots | 131 | 104 |

映射规则：

1. 没有 link 的 legacy group 生成一个 Reservation；同一非空 `booking_link_id` cluster 生成一个 Reservation。
2. Session 按 `(legacy booking_group_id, start_at, end_at)` 生成，不能因为两个来源 group 恰好同时间而自动合并。
3. 每个 legacy Court row 保留原 ID、金额、价格来源、状态和创建时间。
4. 每个 legacy group 建立独立 party/original-booker source；跨 group 不做模糊客户去重。
5. 每个 recurrence occurrence 保持独立 Reservation。

Phase 2 开始前应重新运行基线 SQL并冻结新的 snapshot；生产数据会继续变化，本文数字不是未来 backfill 的永久常量。

## 8. Phase 1 开工门禁

Phase 1 只能是 additive schema，并必须同时满足：

1. 只新增父实体、索引、RLS/grants/helper，以及 `bookings.reservation_id` / `session_id` nullable FKs；不 backfill、不切读写、不 drop/rename legacy 字段。
2. 对每张新 public 表显式 `ENABLE RLS`、`REVOKE` 和最小 `GRANT`；当前生产继续 manager-only。
3. 新 privileged implementation 放 private schema，`SECURITY DEFINER SET search_path = ''`，内部再次校验 caller；公开 wrapper 先 revoke default execute，再按角色精确 grant。
4. 新 view 必须 `security_invoker = true`；所有 FK/RLS 查询列有匹配索引。
5. 新业务时间使用 `timestamptz`；Phase 1 不转换 legacy `timestamp`。旧值的 `America/Toronto` 与 DST 转换留给 Phase 2 专项验证。
6. 保留当前 `bookings_no_time_overlap`、`court_slots` 和触发器；不移动 `btree_gist`，不提前分区。
7. 新约束使用稳定命名；如需扫描历史数据，采用可验证、低锁的加入方式并在独立步骤 `VALIDATE`。
8. Phase 1 PR 必须包含 schema/RLS/grants/function privilege 的验证 SQL和 rollback/compatibility 说明；不得直接部署生产。

进入 Phase 2 前还必须单独确认 reconciliation payment 的精确 schema 和 reporting 语义，因为 21/26 个历史 paid Court rows 没有足够付款审计。

## 9. 验证记录

2026-08-23 使用 Codex Desktop 明确加载的内置 runtime 验证：

| 检查 | 结果 |
| --- | --- |
| Node.js | `v24.19.0` |
| pnpm | `11.19.0` |
| `pnpm run test` | 22/22 passed |
| `pnpm run lint` | passed |
| `pnpm run build` | passed；保留既有主 bundle >500 kB warning |
| Baseline SQL | 在生产 project 以 `READ ONLY` transaction 全量执行成功并 `ROLLBACK` |
| `git diff --check` | passed |
| UI screenshots | 不适用；Phase 0 没有 UI/交互变化 |

仓库 GitHub Pages workflow 固定 Node 22、pnpm 11.16.0，与本次内置 Node 24.19.0、pnpm 11.19.0 不完全一致。本地通过不能单独证明部署兼容；最终仍以 CI 固定环境为准。本阶段只改文档和只读 SQL，不改变前端 bundle。

## English summary

Phase 0 gives a **Conditional GO** for an additive-only Phase 1. Local and remote histories match at 37 migrations. Production currently contains 192 legacy booking rows, 131 booking groups, five link clusters, two recurrence series, and 139 active court-slot projections. No missing/stale slots, active overlaps, invalid intervals, unvalidated constraints, missing foreign-key indexes, group/link membership inconsistencies, non-CAD rows, or pricing-shape violations were found.

A deterministic migration of this snapshot would create 123 Reservations, 135 Sessions, 192 Court allocations, and 131 legacy-group party snapshots. Active data would map to 97 Reservations, 104 Sessions, and 139 allocations. Linked data already includes different schedules, durations, customer snapshots, and a mixed payment state, confirming that a link cluster must become a Reservation containing multiple Sessions and Parties rather than one shared timeslot or customer.

The main accounting limitation is historical payment reconstruction. There are 26 Court rows marked paid, but only five have a dedicated `booking.payment_updated` audit event. Phase 2 must therefore create explicitly labelled legacy reconciliation records for the other 21 rows without inventing a payer, provider reference, or payment batch. Phase 1 may only add nullable parent relationships and secured parent tables; it must preserve the current GiST overlap constraint, slot projection, triggers, legacy fields, and read/write behavior. No production change is authorized by this report.
