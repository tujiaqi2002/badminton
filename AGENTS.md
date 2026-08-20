# Tiger Project Instructions

本仓库是 Workspace 中的 `project-001-badminton`。

## 开始工作前

按顺序阅读：

1. [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) 确认当前发布、进行中 PR 和风险。
2. 产品行为任务读 [`PRODUCT_CONTEXT.md`](./PRODUCT_CONTEXT.md)。
3. 代码、数据库、权限或部署任务同时读 [`TECHNICAL_CONTEXT.md`](./TECHNICAL_CONTEXT.md)。
4. 需要追溯原因时读 [`PROJECT_HISTORY.md`](./PROJECT_HISTORY.md)，不要把旧聊天当当前事实。

开始修改前检查 `git status`、当前分支、关联 issue/PR。一个目标使用一个分支；不要把无关修改加入正在评审的 PR。

## 项目边界

- 产品当前是单一 Tiger 羽球馆的中英双语 PWA，不是通用多商户 SaaS。
- 当前生产访问是私有馆长试运行；不能顺手开放普通客户登录。
- 馆长权限由数据库 `staff_members`、RLS 和 RPC 决定，禁止在前端硬编码邮箱授权。
- GitHub Pages 是静态前端。最终权限、并发、计价和秘密必须留在 Supabase/PostgreSQL 或 Edge Functions。
- 不提交密码、token、service role、Stripe secret、真实管理员邮箱或客户个人数据。

## 修改规则

- 数据库结构变更只追加新的 `supabase/migrations/<timestamp>_<name>.sql`，不可覆盖生产历史或重新执行基础 `schema.sql`。
- 新 RPC 必须校验调用者权限、固定安全的 `search_path`，并只授予必要角色。
- 排期、置换、关联、循环、计价和取消必须由数据库最终防冲突；前端校验只改善体验。
- 馆务配置必须同时验证客户场地页、预订管理、场地监控和数据库约束，不接受只在设置表单里保存成功。
- 新用户可见文案必须有中文和英文；桌面与手机均需验证。
- 高频馆长操作保持直接；新增确认步骤前先判断日志、撤回和无效落点是否已经足够安全。

## 验证

最低验证：

```text
pnpm run lint
pnpm run build
```

涉及交互时必须浏览器验证；涉及 Supabase 时还要检查 migration/RLS/RPC 与远端历史。当前没有完整自动化测试套件，因此不能只凭构建成功宣称业务正确。

## 完成后

- 当前阶段、PR、风险变化：更新 `PROJECT_STATUS.md`。
- 已接受产品行为变化：更新 `PRODUCT_CONTEXT.md`。
- 架构、数据库、安全、部署变化：更新 `TECHNICAL_CONTEXT.md`。
- 阶段性里程碑：更新 `PROJECT_HISTORY.md`。
- 可复用教训先写入 `PROJECT_HISTORY.md`；本机存在全局 Workspace 时，再同步到其 `COMPOUND_LESSONS.md`。

生产部署、数据库破坏性操作、合并 PR 和清理旧 worktree 需要明确授权。
