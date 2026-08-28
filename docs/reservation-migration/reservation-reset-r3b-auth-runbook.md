# Reservation reset R3B：Auth post-commit runbook（草案）

> 关联 Issue：[#165](https://github.com/tujiaqi2002/badminton/issues/165)
> 状态：未授权、未执行。本文不包含 user UUID、邮箱、credential 或可直接运行的删除命令。

## 1. 适用边界

只在 production database runner 已成功提交并返回固定 `database reset committed / Auth pending` marker 后使用本 runbook。Auth 删除不是 database transaction 的一部分，不能与 database rollback 捆绑。

若 database runner 失败或 rollback，不得执行 Auth 步骤。若 database 已 commit 但任一 postflight 不通过，立即停止；不要删除 Auth user，先评估 encrypted artifact recovery。

## 2. Auth 删除前门禁

全部条件必须在同一维护窗口重新只读确认：

1. Database transaction-domain、2 个 events、2 个 members、对应 audit/actions 和 non-manager profile 已为 0；固定 DB marker 恰好 1 条。
2. 仍只有 4 个 Auth users：3 个 admin `staff_members` 对应馆长，以及唯一 1 个不在该集合的 candidate。
3. Candidate ID 的 SHA-256 仍为 `71b3e7bbce898d4cce09ef50c3457f25877dec9d5ce9f2a46578f3ad04d294b6`。只比较 hash；不要把 UUID 或邮箱写入仓库、Issue 或日志。
4. Candidate 在全部 28 个 public/private Auth FK 落点中的引用都为 0。
5. `storage.objects.owner` 与 `owner_id` 对 candidate 都为 0。Supabase 文档说明拥有 Storage objects 的 user 可能无法直接删除；若出现对象，停止并单独确认 Storage 处理范围。
6. Manager preserve graph 仍为 3 Auth users、4 identities、2 profiles、3 staff rows、3 manager-account rows；manager login smoke test 成功。
7. 记录 candidate 当时的 identity/session/refresh-token 计数。Session/token 是易变状态，不靠 R3A 的 1 / 1 / 1 旧数字放行。

## 3. 授权与执行

操作员必须取得明确的 R3B destructive confirmation，且该确认同时指向：

- 已 review 的最终 database runner SHA-256 与 4,327-row database purge manifest；
- 上述 hash 唯一匹配的 non-manager Auth candidate；
- candidate 的 identities、sessions、refresh tokens 和 Auth user 删除；
- database commit 后不能即时 transaction rollback 的事实。

取得确认后，使用 Supabase Dashboard 的 Authentication user management 或受控的 Auth Admin API 删除该 **唯一 candidate**。不要直接编写 repo migration 删除 `auth.users`，不要把 admin credential 或 service secret 写入 shell history、仓库或 Issue。

如果 Dashboard/API 返回 Storage ownership、FK、network 或未知错误：停止并保留 Auth user，不尝试绕过约束。Database 已 commit 时仍可重复 Auth 步骤，但必须先重跑本 runbook 的只读 selector。

## 4. JWT 与 session 边界

Supabase Auth 使用 JWT。官方文档明确说明，删除 user 不会让已经签发的 access token 立即失效；token 可能继续通过签名验证直至自身过期，但不能再用 refresh token 获取新 token。

因此：

1. 保持普通客户登录关闭；删除后不要立刻把“Auth row 不存在”等同于“所有旧 JWT 已过期”。
2. 确认 candidate 的 sessions 与 refresh tokens 已归零。
3. 查询 production 的实际 JWT expiry 配置，并至少等到删除前最后一个 access token 的最晚 expiry 后，才关闭 token-expiry 观察窗口；不要假设固定 1 小时。
4. 即使旧 token 尚在有效期，candidate 不在 `staff_members` / `manager_accounts`，且 transaction/profile 已删除；验证它无法通过 manager-only RPC/RLS。

参考：[Managing User Data](https://supabase.com/docs/guides/auth/managing-user-data) 与 [User Sessions](https://supabase.com/docs/guides/auth/sessions)。

## 5. Auth postflight

删除成功后只读验证：

- Auth users 从 4 变为 3，且全部精确属于 manager set；
- Candidate users / identities / sessions / refresh tokens 均为 0；
- Manager users / identities / profiles / staff / manager accounts 保持 3 / 4 / 2 / 3 / 3；
- public/private 对已删除 user 不存在引用，Storage ownership 仍为 0；
- 28/28 public RLS、private grants、`court_slots`-only Realtime 与 51 migrations 不变；
- 馆长真实登录、管理 RPC、预订管理、场地监控在桌面和手机均通过；
- 已知 test account 无法再登录，旧 token 不能获得 manager access。

把计数、时间、最终 runner hash、database marker 与 Auth API/Dashboard 成功结果记录到 Issue #165，但不要记录 user UUID、邮箱、token、credential 或备份路径。

## 6. 失败与恢复

- **DB commit 前失败**：整个 SQL transaction rollback；Auth 不动。
- **DB commit 后、Auth 删除前失败**：停止，Auth 仍可登录；根据 DB postflight 决定继续或从 encrypted artifact 恢复。
- **Auth 删除中失败**：重跑只读 selectors；只在 candidate 仍唯一且 manager graph 完整时重试。
- **Auth 已删除后发现问题**：不能靠 transaction 恢复 Auth credential/session。数据库可依据 encrypted artifact 进入受控恢复，但原 Auth identity/session 不能从本 runbook自动重建。

当前 hosted production restore RTO 未测量，所以本 runbook不承诺即时恢复。

---

## English summary

Auth cleanup is a separate, post-commit destructive operation. It targets only the single non-manager user selected by its absence from the admin staff set and a frozen SHA-256 identifier. Recheck all database and Storage references immediately before deletion, use Supabase Authentication user management rather than a repository migration, preserve all three manager authorization graphs, and account for access tokens remaining cryptographically valid until their own expiry. This runbook is a draft and performs no Auth mutation.
