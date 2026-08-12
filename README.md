# Tiger ç¾½çƒé¦†

ä¸€ä¸ªä¸ºäº”ç‰‡ç¾½æ¯›çƒåœºåœ°æ‰“é€ çš„å®žæ—¶é¢„è®¢ PWAã€‚å‰ç«¯ä½¿ç”¨ React + Viteï¼Œæ‰˜ç®¡äºŽ GitHub Pagesï¼›èº«ä»½ã€æ•°æ®åº“ã€å®žæ—¶åŒæ­¥å’ŒæœåŠ¡ç«¯æ”¯ä»˜é€»è¾‘ç”± Supabase æä¾›ã€‚

## å·²å®žçŽ°

- é£Žã€æž—ã€ç«ã€å±±ã€é›·äº”ç‰‡åœºåœ°çš„ 7 å¤©å®žæ—¶æŽ’æœŸ
- æ¡Œé¢äºŒç»´æ—¶é—´çŸ©é˜µä¸Žæ‰‹æœºåœºåœ°å¡ç‰‡è§†å›¾
- 60 / 90 / 120 åˆ†é’Ÿé¢„è®¢ã€äººæ•°ã€åŠ¨æ€ä»·æ ¼ã€åˆ°åº—ä»˜æ¬¾
- Supabase é‚®ç®± Magic Link å’Œ Google OAuth æŽ¥å£
- â€œæˆ‘çš„é¢„è®¢â€ã€å–æ¶ˆã€çŠ¶æ€ä¸Žæ”¯ä»˜ä¿¡æ¯
- PostgreSQL `EXCLUDE` æ—¶é—´åŒºé—´çº¦æŸï¼Œé˜²æ­¢ä»»æ„é‡å å’Œå¹¶å‘è¶…å–
- å…¬å¼€å ç”¨è¡¨ä¸Žç§äººè®¢å•è¡¨åˆ†ç¦»ï¼Œå…¬å¼€çœ‹æ¿ä¸æ³„éœ²ç”¨æˆ·èº«ä»½
- Supabase RLSã€Realtimeã€åŽŸå­é¢„è®¢ RPC
- Stripe Checkout Edge Function ä¸Ž Webhook éª¨æž¶
- PWA manifestã€ç¦»çº¿å£³ã€ç§»åŠ¨ç«¯å®‰å…¨åŒºä¸Žå›¾æ ‡
- GitHub Actions è‡ªåŠ¨æž„å»ºå¹¶éƒ¨ç½² GitHub Pages
- æœªé…ç½® Supabase æ—¶è‡ªåŠ¨è¿›å…¥å¯äº¤äº’ä½“éªŒçŽ¯å¢ƒ

## æœ¬åœ°è¿è¡Œ

éœ€è¦ Node.js 20+ ä¸Ž pnpmã€‚

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

æ²¡æœ‰å¡«å†™çŽ¯å¢ƒå˜é‡ä¹Ÿèƒ½æ‰“å¼€å®Œæ•´ä½“éªŒç‰ˆã€‚ç”Ÿäº§çŽ¯å¢ƒå¿…é¡»é…ç½®ï¼š

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_STRIPE_ENABLED=false
```

æµè§ˆå™¨ç«¯åªèƒ½ä½¿ç”¨ Supabase çš„ publishable / anon keyï¼Œç»ä¸èƒ½æ”¾å…¥ `service_role` æˆ– secret keyã€‚

## Supabase ä¸Šçº¿

1. åœ¨ Supabase æ–°å»ºé¡¹ç›®ã€‚
2. æ‰“å¼€ SQL Editorï¼Œæ‰§è¡Œ [`supabase/schema.sql`](./supabase/schema.sql)ã€‚
3. åœ¨ Authentication â†’ URL Configuration è®¾ç½®ï¼š
   - Site URLï¼šå®žé™… GitHub Pages åœ°å€
   - Redirect URLsï¼šåŒä¸€åœ°å€åŠ  `/**`
4. å¦‚ä½¿ç”¨ Google ç™»å½•ï¼Œåœ¨ Authentication â†’ Providers å¯ç”¨ Googleã€‚
5. ä»Ž Project Settings â†’ API å¤åˆ¶ Project URL ä¸Žæµè§ˆå™¨å¯ç”¨çš„ publishable/anon keyã€‚
6. åœ¨ GitHub ä»“åº“ Settings â†’ Secrets and variables â†’ Actions æ·»åŠ ï¼š
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
7. åœ¨ GitHub Settings â†’ Pages â†’ Build and deploymentï¼ŒæŠŠ Source è®¾ä¸º **GitHub Actions**ã€‚

## Stripeï¼ˆå¯é€‰ï¼‰

åˆ°åº—æ”¯ä»˜å¼€ç®±å³ç”¨ã€‚å¯ç”¨åœ¨çº¿æ”¯ä»˜å‰ï¼š

```bash
supabase functions deploy create-checkout
supabase functions deploy stripe-webhook --no-verify-jwt
supabase secrets set STRIPE_SECRET_KEY=sk_...
supabase secrets set STRIPE_WEBHOOK_SIGNING_SECRET=whsec_...
supabase secrets set SITE_URL=https://å®žé™…ç«™ç‚¹åœ°å€
```

ç„¶åŽåœ¨ Stripe åˆ›å»ºæŒ‡å‘ä»¥ä¸‹åœ°å€çš„ webhookï¼Œå¹¶ç›‘å¬ `checkout.session.completed` ä¸Ž `checkout.session.expired`ï¼š

```text
https://YOUR_PROJECT.supabase.co/functions/v1/stripe-webhook
```

æœ€åŽæŠŠ GitHub Actions Variable `VITE_STRIPE_ENABLED` è®¾ä¸º `true`ã€‚

## å¹¶å‘å®‰å…¨è®¾è®¡

å‰ç«¯â€œå·²è®¢â€çŠ¶æ€åªç”¨äºŽä½“éªŒï¼Œæœ€ç»ˆè£å†³å§‹ç»ˆåœ¨æ•°æ®åº“ã€‚`bookings_no_time_overlap` å¯¹ `court_id + tsrange(start_at, end_at)` åˆ›å»º GiST æŽ’ä»–çº¦æŸï¼Œä»…å…è®¸ä¸€ä¸ª `held/confirmed` åŒºé—´ã€‚ä¸¤ä¸ªç”¨æˆ·åŒæ—¶ç‚¹å‡»åŒä¸€æ—¶é—´æ—¶ï¼Œåªæœ‰ä¸€ç¬”æ’å…¥èƒ½æäº¤ï¼Œå¦ä¸€ç¬”ä¼šæ”¶åˆ°æ˜Žç¡®å†²çªé”™è¯¯ã€‚

Stripe è®¢å•å…ˆé”å®š 10 åˆ†é’Ÿã€‚ä¸‹ä¸€æ¬¡åˆ›å»ºè®¢å•ä¼šæ¸…ç†è¿‡æœŸé”ï¼›ç”Ÿäº§çŽ¯å¢ƒè¿˜åº”ä½¿ç”¨ Supabase Cron æ¯åˆ†é’Ÿæ‰§è¡Œä¸€æ¬¡è¿‡æœŸæ¸…ç†ï¼Œä»¥ç¡®ä¿ä½Žæµé‡æ—¶ä¹ŸåŠæ—¶é‡Šæ”¾ã€‚

## åŸŸå

`tiger.io` å·²è¢«å…¶ä»–å…¬å¸ä½¿ç”¨ï¼Œä¸èƒ½ç›´æŽ¥ç»‘å®šã€‚å…ˆä½¿ç”¨ä»“åº“å¯¹åº”çš„ `https://tujiaqi2002.github.io/badminton/`ï¼›è´­ä¹°å¹¶æŒæœ‰æ–°åŸŸååŽï¼Œå†åˆ° GitHub Pages çš„ Custom domain è®¾ç½® DNSã€‚ä¸è¦åœ¨æœªæ‹¥æœ‰åŸŸåæ—¶æäº¤ `CNAME`ã€‚

## èµ„æ–™

- äº§å“ä¸Žè¿è¥è®¾è®¡ï¼š[`docs/PRODUCT.md`](./docs/PRODUCT.md)
- æ•°æ®åº“ä¸Ž RLSï¼š[`supabase/schema.sql`](./supabase/schema.sql)
- éƒ¨ç½²å·¥ä½œæµï¼š[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)