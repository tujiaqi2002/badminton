import Stripe from 'npm:stripe@14.25.0'
import { createClient } from 'jsr:@supabase/supabase-js@2'

Deno.serve(async (request) => {
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })
  const signature = request.headers.get('stripe-signature')
  if (!signature) return new Response('Missing signature', { status: 400 })

  try {
    const body = await request.text()
    const event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SIGNING_SECRET')!,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    )
    const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const session = event.data.object as Stripe.Checkout.Session
    const bookingId = session.metadata?.booking_id

    if (bookingId && event.type === 'checkout.session.completed' && session.payment_status === 'paid') {
      await service.from('bookings').update({
        status: 'confirmed',
        payment_status: 'paid',
        stripe_payment_intent_id: String(session.payment_intent),
        hold_expires_at: null,
      }).eq('id', bookingId).eq('status', 'held')
    }
    if (bookingId && event.type === 'checkout.session.expired') {
      await service.from('bookings').update({ status: 'expired', payment_status: 'failed' }).eq('id', bookingId).eq('status', 'held')
    }
    return new Response('ok')
  } catch (error) {
    return new Response(error.message, { status: 400 })
  }
})
