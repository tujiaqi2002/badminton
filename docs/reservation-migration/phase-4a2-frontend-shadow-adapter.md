# Reservation Phase 4A.2：前端读模型适配器与受控影子读取

> Issue：[#142](https://github.com/tujiaqi2002/badminton/issues/142)。本阶段只建立馆长端前端适配与观察能力；默认 UI、mutation、客户读取、数据库和 Realtime 均不切换。

## 1. 结论

Phase 4A.2 不是可见的产品改版，也不是默认读路径切换。它增加三层可回退基础：

1. 一个显式 version 1 的前端 canonical DTO，把 Phase 4A.1 的 schedule、Reservation search、detail 和 shadow status RPC 结果转换为稳定的 camelCase 结构；
2. 一个 legacy Court-allocation adapter，把现有 `bookings` 排期行转换到同一 allocation DTO，供同数据对比；
3. 一个默认关闭的馆长 shadow mode。在旧排期查询成功后，它以 keyset cursor 读取 canonical allocations，并同时读取数据库 PII-free shadow status；旧数据仍是页面唯一渲染来源。

本阶段没有 migration、RLS/grant、写入 RPC、客户 Auth、付款行为、按钮、文案或视觉变化。

## 2. 为什么只对排期做实时 shadow comparison

旧馆长排期和 canonical schedule 都是一行表示一片 Court allocation，可以按稳定的 allocation UUID 对比。实时比较以下无歧义字段：

- allocation 是否两边都存在；
- court；
- venue-local starts/ends；
- allocation status；
- allocation amount/currency；
- immutable origin Reservation；
- current projection Session；
- legacy group/link source trace。

旧订单搜索是一片 Court allocation 一行；canonical 搜索是一笔 effective Reservation 一行。两者 cardinality、分页 identity、付款状态和 summary 定义不同。Phase 4A.2 会 normalise canonical Reservation search/detail fixtures，但不会把两个不同粒度的列表强行逐行比较，也不会提前改造订单 UI。订单搜索与详情切换仍属于独立 Phase 4C。

数据库 `admin_get_reservation_read_shadow_status(0)` 继续覆盖 grouping、primary contact、money、payment、Session 与完整 ownership 的总体一致性。前端日志只使用它的 count/code/totals，不读取 sample details。

## 3. 开关与权限

新环境变量：

```env
VITE_RESERVATION_READ_SHADOW=false
```

- 只有精确字符串 `true` 才启用；缺失、`TRUE`、`1` 或其他值都保持关闭。
- `.env.example` 与 GitHub Pages workflow 默认都是 `false`。
- 即使开关开启，调用位置仍位于已验证 `isAdmin` 后的馆长排期读取链路；四个数据库 RPC 还会再次执行 manager authorization。
- 开关关闭时不发任何新 RPC，页面继续只读取 legacy data。
- 开关开启时 shadow 请求不控制 loading、toast、渲染或 mutation；失败不会改变旧 UI。
- 新一次排期读取会取消上一轮未完成 shadow 请求，组件卸载也会取消请求，避免旧范围结果继续运行。

任何 `VITE_` 值都会进入浏览器 bundle。该开关只能保存布尔配置，不能放 token、客户资料或 secret。

## 4. DTO 与兼容策略

客户端 DTO version 与服务器 `schema_version` 分开记录，当前都为 `1`。服务器返回未知 schema version 时 adapter fail closed，不尝试猜测字段。

### Allocation DTO

同时接受 legacy booking row 与 canonical allocation row，保留：

- allocation、origin/projection/effective Reservation/Session identity；
- court/time/status/price；
- source-only legacy group/link；
- current Reservation money、payment、recurrence、transition 和 primary-contact summary。

Legacy adapter 无法证明的 effective ownership 和 aggregate 字段保持 `null`，不会从姓名、电话、group/link 或时间猜测。

### Reservation summary/search/detail DTO

- summary 明确分成 schedule、primary contact、money、recurrence 与 lineage；
- search 保留 Reservation keyset cursor 和 Reservation-level totals；
- detail whitelist Parties/roles、Sessions/allocations、payment shares、Payments/allocation entries、source lineage、transitions 与 assignment summary；
- 未声明字段会被丢弃，因此即使未来服务端意外加入 provider reference、idempotency key、raw payload 或 Auth ID，它们也不会自动进入前端 DTO。

## 5. 时间与分页

Canonical Session 使用 `timestamptz`，legacy booking 使用 venue-local `timestamp`。Adapter 使用配置的 venue timezone（缺省 `America/Toronto`）把 canonical instant 转成 `YYYY-MM-DDTHH:mm:ss` 再比较；不能用浏览器本机 timezone。

Shadow schedule 按本地日期构造精确 UTC boundary，并沿用 `(starts_at, allocation_id)` cursor；不使用 OFFSET。前端有 cursor 缺失、重复 cursor 和 100-page 上限保护。Canonical API 使用 overlap window，而现有 legacy 排期只选择 window 内开始的 booking；比较前 canonical rows 会按相同 start-at 语义过滤，避免跨午夜 allocation 产生假告警。

## 6. PII-free 日志

成功或 mismatch 只输出固定事件 `reservation_read_shadow_v1`，包含：

- legacy/canonical/compared allocation counts；
- client mismatch count 和按 code 聚合的 counts；
- server status、mismatch count/codes 和 totals。

日志不包含姓名、邮箱、电话、备注、Party、Payment、Reservation/allocation ID 或数据库 sample details。请求错误只记录经过 allowlist 处理的 error code，不记录服务端 message；因此数据库错误即使意外带入输入值，也不会进入 console。

## 7. Rollback 与后续门禁

最小回退是把 `VITE_RESERVATION_READ_SHADOW` 设为 `false` 并重新 build；默认部署本来就是 false。即使 adapter 代码仍在 bundle 内，关闭时不会执行新 RPC。由于旧数据仍是唯一 UI source，不需要数据库回滚，也不会影响 mutation、Realtime 或客户读取。

Phase 4B/4C 开始前需要：

1. 在受控 manager/staging 环境启用 shadow；
2. client comparison 与 server diagnostic 连续 clean；
3. 对任何 mismatch 先停止 cutover 并调查，不能静默 fallback 后掩盖漂移；
4. schedule 与 order/detail 的默认 read/UI 切换分别取得独立确认。

## 8. 验证证据

- 本地 Codex bundled Node `v24.19.0` / pnpm `11.19.0`：adapter tests 14/14；Reservation suite 33 tests 中 32 pass、1 个无本地 PostgreSQL 的明确 skip；lint/build 通过。
- Default-off demo manager browser：desktop 与 390×844 mobile 排期、订单筛选和切周正常；console 0 error/warn，0 `reservation_read_shadow_v1` event。
- Production 与 `badminton_stage` migration history 只读复核均为 48，最新 `20260825091608_reservation_phase_4a_manager_read_contract`；本阶段没有 DB push。
- PR [#145](https://github.com/tujiaqi2002/badminton/pull/145) 最终 merge-head [CI run 32837678041](https://github.com/tujiaqi2002/badminton/actions/runs/32837678041)：Node `v22.23.2` / pnpm `11.16.0` / PostgreSQL 16，Reservation 33/33、adapter 14/14、0 skip，lint/build 全绿。Supabase Preview 因无 migration 正常跳过。
- 用户授权后，PR #145 于 2026-08-25 10:36:34 UTC 合并为 `ea3e6a80afcec64736a54b2bba65f0936f7e9ab8`；Pages [run 32838082873](https://github.com/tujiaqi2002/badminton/actions/runs/32838082873) build/deploy 成功。线上页面返回 200，并引用该 run 产出的 `index-ssrRc0gW.js`。
- GitHub Actions 未设置 `VITE_RESERVATION_READ_SHADOW`，workflow fallback 为 `false`。线上 bundle 中 `reservation_read_shadow_v1` 和 `VITE_RESERVATION_READ_SHADOW` 字面量均为 0，证明 shadow 路径已被生产构建裁剪。Production 与 `badminton_stage` 仍各为 48 migrations。
- 后续 Phase 4A.3 在单独授权下短时开启生产 shadow：Pages [run 32839524612](https://github.com/tujiaqi2002/badminton/actions/runs/32839524612) 成功，四个馆长排期范围全部产生 `info` 级别 clean event，两个 canonical 只读 RPC 各 4 次 POST 均为 HTTP 200。观察后 diagnostic 仍 clean，变量已删除，并由 Pages [run 32839948133](https://github.com/tujiaqi2002/badminton/actions/runs/32839948133) 恢复默认关闭 bundle。完整证据见 [`phase-4a3-production-shadow-observation.md`](./phase-4a3-production-shadow-observation.md)。

Phase 4A.2 的默认关闭基础已部署，Phase 4A.3 已验证短时生产 shadow 和回退。以上证据不授权默认 read/UI cutover 或 legacy decommission。

---

# English version

## Reservation Phase 4A.2: frontend read adapters and controlled shadow reads

Phase 4A.2 is not a visible product redesign or a default read-path cutover. It adds three reversible foundations for manager reads:

1. an explicit version 1 canonical frontend DTO for the Phase 4A.1 schedule, Reservation search, detail, and shadow-status RPCs;
2. a legacy Court-allocation adapter that maps current `bookings` schedule rows into the same allocation DTO for like-for-like comparison;
3. an opt-in manager shadow mode. After the legacy schedule query succeeds, it reads canonical allocations with compound keyset pagination and fetches the database's PII-free shadow status. Legacy data remains the only rendered UI source.

There is no migration, RLS/grant change, mutation change, customer read, customer Auth change, payment behavior change, Realtime change, new button, copy change, or visual change in this phase.

## Why live comparison is schedule-only

The legacy manager schedule and canonical schedule both represent one physical Court allocation per row, so they can be compared by stable allocation UUID. The comparison covers presence, court, venue-local start/end, allocation status, amount/currency, immutable origin Reservation, projection Session, and legacy group/link source traces.

Legacy order search returns one Court allocation per row, while canonical search returns one effective Reservation per row. Their cardinality, pagination identity, payment states, and aggregate summaries are intentionally different. Phase 4A.2 normalizes canonical Reservation search and detail fixtures but does not create misleading row-by-row comparisons or prematurely redesign the order UI. Order search/detail cutover remains Phase 4C.

The database `admin_get_reservation_read_shadow_status(0)` remains authoritative for full ownership, grouping, primary-contact, Session, amount, and payment reconciliation. The frontend consumes only its counts, codes, status, and totals; it does not consume sample details.

## Flag and authorization

The new setting is:

```env
VITE_RESERVATION_READ_SHADOW=false
```

Only the exact string `true` enables it. Missing values, `TRUE`, `1`, and all other values fail closed. The example environment and GitHub Pages workflow both default to `false`. Even when enabled, calls originate only from the manager schedule path after verified `isAdmin`; every database RPC independently enforces manager authorization.

With the flag off, no new RPC is sent. With it on, shadow requests never control loading state, toast messages, rendering, or mutations. A newer schedule read aborts the previous shadow request, and unmounting aborts any remaining request.

All `VITE_` variables are public browser configuration. This flag may contain only a boolean value and must never contain a token, customer data, or secret.

## DTO and compatibility policy

The client DTO version and server `schema_version` are recorded separately and are both `1` today. An unknown server schema version fails closed instead of guessing field semantics.

The allocation DTO accepts both legacy booking rows and canonical allocation rows. It preserves allocation, origin/projection/effective Reservation and Session identity, court/time/status/price, source-only legacy group/link fields, and current Reservation money, payment, recurrence, transition, and primary-contact summaries. Facts that the legacy row cannot prove remain `null`; the adapter never infers ownership from names, contact strings, group/link fields, or timing.

Reservation summary separates schedule, primary contact, money, recurrence, and lineage. Search preserves the Reservation keyset cursor and Reservation-level totals. Detail whitelists Parties/roles, Sessions/allocations, payment shares, Payments/allocation entries, source lineage, transitions, and assignment summaries. Undeclared fields are dropped, so provider references, idempotency keys, raw provider payloads, or Auth IDs cannot silently enter the DTO if a later backend response changes.

## Time and pagination

Canonical Sessions use `timestamptz`; legacy bookings use venue-local `timestamp`. The adapter converts canonical instants with the configured venue timezone, defaulting to `America/Toronto`, rather than using the browser machine timezone.

Shadow schedule requests build exact UTC boundaries from venue-local dates and use `(starts_at, allocation_id)` keyset cursors with no OFFSET. Missing/repeated cursors and a 100-page safety limit fail closed. The canonical API uses overlap-window semantics, while the current legacy schedule selects bookings whose start falls within the window. Canonical rows are filtered to the same start-time semantics before comparison so an overnight allocation does not create a false mismatch.

## PII-free logging

Clean and mismatch results emit the fixed `reservation_read_shadow_v1` event with only legacy/canonical/compared counts, client mismatch counts by code, and server status/mismatch counts/totals. Logs contain no name, email, phone, note, Party, Payment, Reservation/allocation ID, or database sample detail. Failures record only an allowlisted error code and never the server message.

## Rollback and later gates

Rollback is setting `VITE_RESERVATION_READ_SHADOW=false` and rebuilding; that is already the deployment default. Disabled code sends no new RPC. Because legacy data remains the only UI source, no database rollback is required and mutations, Realtime, and customer reads are unaffected.

Before Phase 4B or 4C can cut over a default read path, controlled manager/staging observation must remain clean. Any mismatch stops the cutover for investigation rather than being hidden by an automatic fallback. Schedule and order/detail default read/UI cutovers each require their own explicit approval.

## Validation evidence

- Local Codex bundled Node `v24.19.0` / pnpm `11.19.0`: 14/14 adapter tests; 32 passes and one explicit no-local-PostgreSQL skip across the 33-test Reservation suite; lint/build passed.
- Default-off demo manager browser: desktop and 390×844 mobile schedule, order filters, and week navigation passed with zero console errors/warnings and zero `reservation_read_shadow_v1` events.
- Read-only migration-history checks show production and `badminton_stage` remain aligned at 48, latest `20260825091608_reservation_phase_4a_manager_read_contract`; Phase 4A.2 performed no DB push.
- PR [#145](https://github.com/tujiaqi2002/badminton/pull/145) final merge-head [CI run 32837678041](https://github.com/tujiaqi2002/badminton/actions/runs/32837678041) passed 33/33 Reservation PostgreSQL tests and 14/14 adapter tests with zero skips under Node `v22.23.2`, pnpm `11.16.0`, and PostgreSQL 16; lint/build were green. Supabase Preview correctly skipped because there is no migration.
- After explicit authorization, PR #145 merged at 2026-08-25 10:36:34 UTC as `ea3e6a80afcec64736a54b2bba65f0936f7e9ab8`. Pages [run 32838082873](https://github.com/tujiaqi2002/badminton/actions/runs/32838082873) built and deployed successfully; the live page returns 200 and references the exact `index-ssrRc0gW.js` produced by the run.
- The GitHub Actions variable is unset, so the workflow fallback remains false. The live bundle contains zero `reservation_read_shadow_v1` and `VITE_RESERVATION_READ_SHADOW` literals, proving the shadow path was compiled away. Production and `badminton_stage` remain at 48 migrations.
- A later separately authorized Phase 4A.3 observation temporarily enabled production shadow. Pages [run 32839524612](https://github.com/tujiaqi2002/badminton/actions/runs/32839524612) succeeded; four manager-schedule ranges emitted `info`-level clean events; and both canonical read-only RPCs completed four POST/HTTP 200 calls. The diagnostic remained clean, the variable was deleted, and Pages [run 32839948133](https://github.com/tujiaqi2002/badminton/actions/runs/32839948133) restored the default-off bundle. Full evidence is in [`phase-4a3-production-shadow-observation.md`](./phase-4a3-production-shadow-observation.md).

The default-off Phase 4A.2 foundation is deployed, and Phase 4A.3 has verified a bounded production shadow observation and rollback. This evidence does not authorize a default read/UI cutover or legacy decommission.
