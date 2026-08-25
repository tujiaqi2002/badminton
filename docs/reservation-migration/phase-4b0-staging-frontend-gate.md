# Reservation Phase 4B.0：可重复的 staging frontend gate

> Issue：[#148](https://github.com/tujiaqi2002/badminton/issues/148)  
> 状态：已完成。授权范围仅包含 `badminton_stage` 本地前端、合成 Auth 身份与权限/浏览器证据；Phase 4B.1 canonical schedule 实现、PR 合并、生产部署与 legacy decommission 均未开始。

## 1. 环境与安全边界

- 测试前端只连接 `badminton_stage`（project ref `vcoujmzsgdboidndtzzg`）。
- 生产 GitHub Pages 继续连接 production project `ldbtrouofmqmnkyxiewk`；本阶段没有修改其 URL、key、Auth redirect 或读取来源。
- staging 浏览器只接收 publishable/anon key。service-role key、数据库密码、真实客户或生产 Auth 数据没有进入浏览器、仓库、Issue 或截图。
- `.env.staging.local` 被 Git 忽略；仓库只提交无凭据的 `.env.staging.example`。

本地密码入口必须同时满足：`VITE_STAGING_PASSWORD_AUTH=true`、`VITE_APP_ENVIRONMENT=staging`、Supabase URL 的 project ref 与 `VITE_EXPECTED_SUPABASE_PROJECT_REF` 完全一致，以及页面运行在 loopback hostname。任一条件缺失或错配都会 fail closed 到原有 magic-link 登录。因此 production build 或非本机 staging build 不会暴露该入口。

可重复启动：复制 `.env.staging.example` 为 `.env.staging.local`，填写 staging URL、active publishable key 与预期 project ref，然后运行：

```text
pnpm dev --mode staging --host 127.0.0.1 --port 4174
```

## 2. Auth 身份与数据库权限证据

初始化 fixture 中已有一个不可登录的确定性 Auth/staff 占位：它没有 password hash、confirmation 或 identity，继续只用于数据库诊断。本阶段通过 Supabase Dashboard/Auth Admin 的受支持流程另建两个 disposable、自动确认的 password identity：

- synthetic manager：加入 `staff_members(role='admin')`；
- synthetic non-manager：不加入 `staff_members`。

账号和密码只保存在本机，未进入 commit、Issue、PR、console log 或截图。完成后的 staging 共有 3 个 Auth rows 与 2 个 staff rows，其中真实 manager 的 Auth/staff 对应数为 1，真实 non-manager 的 staff 对应数为 0。

使用这两个真实 Auth subject 与 `anon` 完成权限矩阵：

- manager 调用 `admin_list_reservation_allocations` 成功，在 2026-09-01 至 2026-09-15 返回 6 个 allocation summaries；manager detail RPC 也返回 versioned Reservation/Party/Session/payment/lineage envelope；
- non-manager 返回 `Manager access required`；
- `anon` 在函数 ACL 层返回 `permission denied`；
- 两个 RPC 均保持 `SECURITY INVOKER`、空 `search_path`、authenticated 可执行、anon 不可执行。

## 3. 浏览器与视觉证据

本地 staging 浏览器完成了真实 password Auth 与数据回归：

- manager 登录后能看到完整馆长导航；2026-09-07 排期正确显示同一 Reservation 的 Court 1/Court 2 两条 10:00–11:00 multi-court/recurring allocation；
- 容量监控同一时段显示 5 片场地中剩余 3 片，与两片被占用一致；
- 中文和 English 的登录、排期与容量页面均实际渲染；
- 390×844 手机视口无横向页面溢出，手机底栏、排期详情与容量监控均正常；
- non-manager 登录后只显示“此账号没有访问权限”，无法进入馆长界面；
- 上述路径的 browser console error/warn 均为 0。

截图：

- 登录：[`Before`](../screenshots/issue-148/before-auth-desktop.png)、[`中文 After`](../screenshots/issue-148/after-auth-desktop-zh.png)、[`English After`](../screenshots/issue-148/after-auth-desktop-en.png)
- 桌面排期：[`中文`](../screenshots/issue-148/after-manager-schedule-desktop-zh.png)、[`English`](../screenshots/issue-148/after-manager-schedule-desktop-en.png)
- 手机排期：[`390×844`](../screenshots/issue-148/after-manager-schedule-mobile-zh.png)
- 桌面容量：[`中文`](../screenshots/issue-148/after-manager-capacity-desktop-zh.png)、[`English`](../screenshots/issue-148/after-manager-capacity-desktop-en.png)
- 手机容量：[`390×844`](../screenshots/issue-148/after-manager-capacity-mobile-zh.png)
- 非馆长拒绝：[`桌面中文`](../screenshots/issue-148/after-non-manager-denied-desktop-zh.png)

## 4. 最终验证

- bundled Node `v24.19.0` / pnpm `11.19.0`；
- `pnpm test`：75 tests，74 pass、1 个因没有本地 PostgreSQL connection 的明确 skip、0 fail；
- `pnpm run lint`：通过；
- production build：通过，stage project ref 在 `dist` 中为 0 次；
- staging build：通过，stage ref 与 staging label 均进入测试 artifact；
- 最终 staging `phase_4a_manager_read_contract.sql`：48 migrations、192 bookings/memberships、192 canonical allocations、123 Reservations，Phase 3B/4A mismatch 全部为 0，writer boundary 17/0/17/3、7 张 FORCE RLS 表、Realtime 仍只有 `public.court_slots`。

Vite 仅保留既有的 >500 kB chunk warning，不影响本阶段结论。

## 5. 明确未做与下一门禁

- 未新增或修改 migration、RLS、grant、RPC、Realtime publication 或 Edge Function。
- 未修改 production Supabase/Pages 配置。
- 未让 schedule/capacity 消费 canonical allocation；legacy rows 仍是唯一渲染来源。
- 未切换 order/detail/customer read，未修改 writer、付款、计价、Stripe 或通知。
- 未删除 legacy adapter、字段、RPC 或 fixture placeholder。

Phase 4B.0 到此完成。下一步必须先评审并明确确认 Phase 4B.1 的 canonical schedule read-source/cutover 范围，才可继续实现。

---

# Full English

## Reservation Phase 4B.0: repeatable staging frontend gate

Issue [#148](https://github.com/tujiaqi2002/badminton/issues/148) Phase 4B.0 is complete. The authorized scope was limited to a local frontend connected to `badminton_stage`, disposable synthetic Auth identities, and permission/browser evidence. Phase 4B.1 canonical schedule implementation, PR merge, production deployment, and legacy decommission have not started.

### Environment and security boundary

The test frontend connects only to `badminton_stage` (`vcoujmzsgdboidndtzzg`). Production GitHub Pages remains connected to `ldbtrouofmqmnkyxiewk`; this phase changed none of its URLs, keys, Auth redirects, or read sources. Only a publishable/anon key reaches the staging browser. Service-role credentials, database passwords, and production Auth/customer data remain excluded from the browser, repository, Issue, and screenshots.

The populated `.env.staging.local` is ignored by Git, while the repository contains only `.env.staging.example`. Password auth appears only when the flag is exactly true, the app environment is exactly staging, the Supabase URL matches the expected project ref, and the page runs on a loopback hostname. Every missing or mismatched condition fails closed to the existing magic-link login, so production and non-local staging builds cannot expose this entry.

For repeatable startup, copy `.env.staging.example` to `.env.staging.local`, fill the staging URL, active publishable key, and expected project ref, then run:

```text
pnpm dev --mode staging --host 127.0.0.1 --port 4174
```

### Auth identities and database permission evidence

The deterministic fixture's original Auth/staff row remains an intentionally non-login placeholder with no password hash, confirmation, or identity. Two additional disposable, auto-confirmed password identities were created through supported Supabase Dashboard/Auth Admin tooling. Only the synthetic manager was added to `staff_members(role='admin')`; the synthetic non-manager was not. Credentials stayed local and were never committed, posted, logged, or captured.

The completed staging state contains three Auth rows and two staff rows: one real manager Auth/staff match and zero non-manager staff matches. Using the two real Auth subjects, the manager successfully read six allocation summaries for September 1–15 and the versioned Reservation detail envelope. The non-manager received `Manager access required`; `anon` was denied at the function ACL. Both read RPCs remain security-invoker functions with empty search paths, authenticated-only execution, and no anonymous execution.

### Browser and visual evidence

Real password Auth and data regression passed in the local staging browser. The manager saw the complete manager navigation, two 10:00–11:00 Court 1/Court 2 multi-court/recurring allocations for one Reservation on September 7, and three remaining courts in the capacity monitor for the same slot. Chinese and English login, schedule, and capacity pages rendered correctly. At 390×844, the page had no horizontal overflow and the mobile navigation, schedule detail, and capacity monitor remained usable. The non-manager signed in successfully but saw only the access-denied page and could not enter manager UI. Browser console errors and warnings were zero throughout.

Screenshots:

- Auth: [`Before`](../screenshots/issue-148/before-auth-desktop.png), [`Chinese After`](../screenshots/issue-148/after-auth-desktop-zh.png), [`English After`](../screenshots/issue-148/after-auth-desktop-en.png)
- Desktop schedule: [`Chinese`](../screenshots/issue-148/after-manager-schedule-desktop-zh.png), [`English`](../screenshots/issue-148/after-manager-schedule-desktop-en.png)
- Mobile schedule: [`390×844`](../screenshots/issue-148/after-manager-schedule-mobile-zh.png)
- Desktop capacity: [`Chinese`](../screenshots/issue-148/after-manager-capacity-desktop-zh.png), [`English`](../screenshots/issue-148/after-manager-capacity-desktop-en.png)
- Mobile capacity: [`390×844`](../screenshots/issue-148/after-manager-capacity-mobile-zh.png)
- Non-manager denial: [`Chinese desktop`](../screenshots/issue-148/after-non-manager-denied-desktop-zh.png)

### Final validation and next gate

Bundled Node `v24.19.0` and pnpm `11.19.0` produced 74 passes, one explicit no-local-PostgreSQL skip, and zero failures across 75 tests. Lint and both production/staging builds passed. The production artifact contains zero staging project references; the staging artifact contains the expected staging reference and label. The final hosted diagnostic remained clean at 48 migrations, 192 bookings/memberships, 192 canonical allocations, 123 Reservations, zero Phase 3B/4A mismatches, the 17/0/17/3 writer boundary, seven FORCE RLS tables, and `public.court_slots`-only Realtime. The only build notice is the existing >500 kB Vite chunk warning.

This phase added no migration, policy, grant, RPC, Realtime publication, Edge Function, production configuration, canonical render source, order/detail/customer read, writer, pricing, payment, Stripe, notification, or legacy decommission change. Legacy rows remain the only rendered source. Phase 4B.1 requires a new review and explicit confirmation before implementation begins.
