import Stripe from 'npm:stripe@14.25.0'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) throw new Error('Authentication required')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { bookingId } = await request.json()
    const { data: booking, error } = await supabase
      .from('bookings')
      .select('id, court_id, start_at, end_at, status, total_amount, currency')
      .eq('id', bookingId)
      .eq('status', 'held')
      .single()
    if (error || !booking) throw new Error('Booking hold not found')

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })
    const siteUrl = Deno.env.get('SITE_URL')!
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_creation: 'always',
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: booking.currency.toLowerCase(),
          unit_amount: Math.round(Number(booking.total_amount) * 100),
          product_data: { name: 'Tiger 羽球馆场地预订', description: `${booking.start_at} — ${booking.end_at}` },
        },
      }],
      metadata: { booking_id: booking.id },
      success_url: `${siteUrl}/?payment=success`,
      cancel_url: `${siteUrl}/?payment=cancelled`,
    })

    const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    await service.from('bookings').update({ stripe_checkout_session_id: session.id }).eq('id', booking.id)
    return Response.json({ url: session.url }, { headers: cors })
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400, headers: cors })
  }
})
