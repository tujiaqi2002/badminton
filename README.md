# Tiger 羽球馆

一个为五片羽毛球场地打造的实时预订 PWA。前端使用 React + Vite，托管于 GitHub Pages；身份、数据库、实时同步和服务端支付逻辑由 Supabase 提供。

## 已实现

- 风、林、火、山、雷五片场地的 7 天实时排期
- 桌面二维时间矩阵与手机场地卡片视图
- 60 / 90 / 120 分钟预订、人数、动态价格、到店付款
- Supabase 邮箱 Magic Link 和 Google OAuth 接口
- “我的预订”、取消、状态与支付信息
- PostgreSQL `EXCLUDE` 时间区间约束，防止任意重叠和并发超卖
- 公开占用表与私人订单表分离，公开看板不泄露用户身份
- Supabase RLS、Realtime、原子预订 RPC
- Stripe Checkout Edge Function 与 Webhook 骨架
- PWA manifest、离线壳、移动端安全区与图标
- GitHub Actions 自动构建并部署 GitHub Pages
- 未配置 Supabase 时自动进入可交互体验环境

## 本地运行

需要 Node.js 20+ 与 pnpm。

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

没有填写环境变量也能打开完整体验版。生产环境必须配置：

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_STRIPE_ENABLED=false
```

浏览器端只能使用 Supabase 的 publishable / anon key，绝不能放入 `service_role` 或 secret key。

## Supabase 上线

1. 在 Supabase 新建项目。
2. 打开 SQL Editor，执行 [`supabase/schema.sql`](./supabase/schema.sql)。
3. 在 Authentication → URL Configuration 设置：
   - Site URL：实际 GitHub Pages 地址
   - Redirect URLs：同一地址加 `/**`
4. 如使用 Google 登录，在 Authentication → Providers 启用 Google。
5. 从 Project Settings → API 复制 Project URL 与浏览器可用的 publishable/anon key。
6. 在 GitHub 仓库 Settings → Secrets and variables → Actions 添加：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
7. 在 GitHub Settings → Pages → Build and deployment，把 Source 设为 **GitHub Actions**。

## Stripe（可选）

到店支付开箱即用。启用在线支付前：

```bash
supabase functions deploy create-checkout
supabase functions deploy stripe-webhook --no-verify-jwt
supabase secrets set STRIPE_SECRET_KEY=sk_...
supabase secrets set STRIPE_WEBHOOK_SIGNING_SECRET=whsec_...
supabase secrets set SITE_URL=https://实际站点地址
```

然后在 Stripe 创建指向以下地址的 webhook，并监听 `checkout.session.completed` 与 `checkout.session.expired`：

```text
https://YOUR_PROJECT.supabase.co/functions/v1/stripe-webhook
```

最后把 GitHub Actions Variable `VITE_STRIPE_ENABLED` 设为 `true`。

## 并发安全设计

前端“已订”状态只用于体验，最终裁决始终在数据库。`bookings_no_time_overlap` 对 `court_id + tsrange(start_at, end_at)` 创建 GiST 排他约束，仅允许一个 `held/confirmed` 区间。两个用户同时点击同一时间时，只有一笔插入能提交，另一笔会收到明确冲突错误。

Stripe 订单先锁定 10 分钟。下一次创建订单会清理过期锁；生产环境还应使用 Supabase Cron 每分钟执行一次过期清理，以确保低流量时也及时释放。

## 域名

`tiger.io` 已被其他公司使用，不能直接绑定。先使用仓库对应的 `https://tujiaqi2002.github.io/badminton/`；购买并持有新域名后，再到 GitHub Pages 的 Custom domain 设置 DNS。不要在未拥有域名时提交 `CNAME`。

## 资料

- 产品与运营设计：[`docs/PRODUCT.md`](./docs/PRODUCT.md)
- 数据库与 RLS：[`supabase/schema.sql`](./supabase/schema.sql)
- 部署工作流：[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)
