# Reservation Phase 4B.0：可重复的 staging frontend gate

> Issue：[#148](https://github.com/tujiaqi2002/badminton/issues/148)  
> 状态：进行中。只授权 `badminton_stage` 本地前端、合成 Auth 身份与权限/浏览器证据；没有授权 Phase 4B.1 canonical schedule 实现、PR 合并、生产部署或任何 legacy decommission。

## 1. 环境边界

- 测试前端只连接 `badminton_stage`（project ref `vcoujmzsgdboidndtzzg`）。
- 生产 GitHub Pages 继续连接 production project `ldbtrouofmqmnkyxiewk`；本阶段不修改其 URL、key、Auth redirect 或读取来源。
- staging 只使用 publishable/anon key。service-role key、数据库密码和真实客户/Auth 数据不得进入浏览器、仓库或截图。
- `.env.staging.local` 被 Git 忽略；仓库只提交无凭据的 `.env.staging.example`。

## 2. 可重复启动

1. 将 `.env.staging.example` 复制为 `.env.staging.local`。
2. 只填写 staging URL、active publishable key 与预期 project ref。
3. 使用以下命令启动：

```text
pnpm dev --mode staging --host 127.0.0.1 --port 4174
```

本地密码入口同时要求以下条件，任一缺失都 fail closed 到原有邮件登录：

1. `VITE_STAGING_PASSWORD_AUTH` 精确为 `true`；
2. `VITE_APP_ENVIRONMENT` 精确为 `staging`；
3. Supabase URL 中的 project ref 与 `VITE_EXPECTED_SUPABASE_PROJECT_REF` 完全一致；
4. 页面 hostname 是 `localhost`、`127.0.0.1` 或 IPv6 loopback。

因此，把 staging build 放到 GitHub Pages 或把 production URL 与 staging ref 混配，都不会显示测试密码入口。

## 3. Auth 基线与选择

初始化 fixture 中已有 1 个 `auth.users` row 和 1 个 `staff_members(role='admin')` row，但它是历史测试占位：邮箱不可投递、无 password hash、未确认、无 identity、从未登录。它保留给确定性数据库诊断，不能冒充真实 Auth 登录验证。

Hosted staging 当前只启用 email provider；signup 开启、mailer autoconfirm 关闭，Google/GitHub/anonymous provider 均未开启。因此 Phase 4B.0 使用 Supabase Dashboard/Auth Admin 的受支持流程创建两个 disposable、自动确认的 password identity：

- synthetic manager：加入 `staff_members(role='admin')`；
- synthetic non-manager：不加入 `staff_members`，只用于拒绝路径。

账号、密码和 populated `.env.staging.local` 都只保存在本机，不进入 commit、Issue、PR、console log 或截图。当前创建动作仍等待已登录的 Supabase Dashboard 会话；不得通过直接写 `auth.users` 绕过 Auth Admin。

## 4. 已完成的权限证据

在 `badminton_stage` 以真实 PostgreSQL client role 验证 canonical manager RPC：

- `authenticated` + fixture manager JWT subject 调用 `admin_list_reservation_allocations` 成功，2026-09-01 至 2026-09-15 窗口返回 6 个 allocation summaries；
- `authenticated` + 不属于 `staff_members` 的 subject 返回 `Manager access required`；
- `anon` 在函数 ACL 层返回 `permission denied`；
- `admin_get_reservation_detail` 以 manager subject 成功返回 versioned Reservation/Party/Session/payment/lineage envelope；
- 两个 RPC 都是 `SECURITY INVOKER`、空 `search_path`、authenticated 可执行、anon 不可执行。

这些检查证明数据库授权边界正确，但不能替代浏览器中的 supported Auth login；后者必须等 disposable identities 创建后补齐。

## 5. 前端证据

- 无 staging 三重配置时，本地页面保持原有 magic-link 登录。
- 正确 staging 配置时，本地页面显示明确的“仅限本地 Staging / Local staging only”password 入口。
- 登录页现在可在未登录状态切换中文/English，两套新增文案均已实际渲染。
- fail-closed gate 有独立单元测试，覆盖 flag、环境名、project-ref、Supabase URL 与 hostname 的缺失/错配。
- Before 与中英文 After 桌面截图已保存：[`Before`](../screenshots/issue-148/before-auth-desktop.png)、[`中文 After`](../screenshots/issue-148/after-auth-desktop-zh.png)、[`English After`](../screenshots/issue-148/after-auth-desktop-en.png)。登录后的桌面/手机排期证据仍待 supported Auth identity 完成后补齐。

## 6. 当前未做

- 未创建或修改 Supabase migration、RLS、grant、RPC、Realtime publication 或 Edge Function。
- 未修改 production Supabase/Pages 配置。
- 未实现 `VITE_RESERVATION_SCHEDULE_READ_SOURCE`，未让 schedule/capacity 消费 canonical allocation。
- 未切换 order/detail/customer read，未修改 writer、付款、计价、Stripe 或通知。
- 未删除 legacy adapter、字段、RPC 或 fixture placeholder。

---

# Full English

## Reservation Phase 4B.0: repeatable staging frontend gate

Issue [#148](https://github.com/tujiaqi2002/badminton/issues/148) is in progress. The approved scope is limited to a local frontend connected to `badminton_stage`, disposable synthetic Auth identities, and permission/browser evidence. It does not authorize Phase 4B.1 canonical schedule implementation, PR merge, production deployment, or legacy decommission.

### Environment boundary

The test frontend connects only to `badminton_stage` (`vcoujmzsgdboidndtzzg`). Production GitHub Pages remains connected to `ldbtrouofmqmnkyxiewk`; this phase does not change its URL, key, Auth redirects, or read source. Only a publishable/anon key may reach the staging browser. Service-role credentials, database passwords, and production Auth/customer data remain excluded.

The populated `.env.staging.local` file is ignored by Git. The repository contains only `.env.staging.example`. Copy that file, fill the staging URL, active publishable key, and expected project ref, then run:

```text
pnpm dev --mode staging --host 127.0.0.1 --port 4174
```

Password auth appears only when the flag is exactly `true`, the app environment is exactly `staging`, the configured Supabase URL matches the expected project ref, and the page runs on a loopback hostname. Every missing or mismatched condition fails closed to the existing magic-link login. A staging build served from GitHub Pages or a production URL mixed with a staging ref therefore cannot expose this test entry.

### Auth baseline and decision

The deterministic fixture contains one `auth.users` row mapped to one admin staff row, but it is a database placeholder: its address is undeliverable, it has no password hash or identity, it is unconfirmed, and it has never signed in. It remains for deterministic diagnostics and cannot serve as browser Auth evidence.

Hosted staging currently enables only the email provider. Signup is enabled, mailer autoconfirm is disabled, and Google, GitHub, and anonymous providers are disabled. Phase 4B.0 therefore uses supported Supabase Dashboard/Auth Admin tooling to create an auto-confirmed disposable password manager plus a disposable non-manager. Only the manager is added to `staff_members`. Credentials remain local and are never committed or posted. This creation step is still waiting for an authenticated Supabase Dashboard session; the implementation will not bypass Auth Admin by directly writing `auth.users`.

### Evidence completed so far

The canonical manager RPC boundary was exercised under real PostgreSQL client roles. An authenticated fixture-manager subject successfully read six allocation summaries for the September 1–15 window. An authenticated subject absent from `staff_members` received `Manager access required`, and `anon` was rejected at the function ACL. The manager detail RPC returned the expected versioned Reservation, Party, Session, payment, and lineage envelope. Both RPCs remain security-invoker functions with an empty `search_path`, authenticated-only execution, and no anonymous execution.

The browser renders the existing magic-link form when staging gates are absent and the clearly labeled local-staging password form when every gate matches. The unauthenticated form can now switch between Chinese and English. Unit tests cover every flag, environment, project-ref, URL, and hostname mismatch. The [`Before`](../screenshots/issue-148/before-auth-desktop.png), [`Chinese After`](../screenshots/issue-148/after-auth-desktop-zh.png), and [`English After`](../screenshots/issue-148/after-auth-desktop-en.png) desktop screenshots are retained; authenticated desktop/mobile schedule evidence remains pending until the supported disposable identities are created.

No migration, policy, grant, RPC, Realtime, Edge Function, production configuration, schedule read source, order/detail/customer read, writer, pricing, payment, Stripe, notification, or legacy capability has changed.
