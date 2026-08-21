const ACTIVE_STATUSES = new Set(['held', 'confirmed'])

export const bookingGroupKey = (booking) => booking?.booking_group_id || booking?.id || null

export const canLinkBookings = (source, target) => {
  if (!source || !target || source.id === target.id) return false
  if (!ACTIVE_STATUSES.has(source.status) || !ACTIVE_STATUSES.has(target.status)) return false
  if (bookingGroupKey(source) === bookingGroupKey(target)) return false
  return !(source.booking_link_id && source.booking_link_id === target.booking_link_id)
}

export const buildBookingRelationship = (bookings, selected) => {
  const selectedGroupId = bookingGroupKey(selected)
  if (!selectedGroupId) return null
  const active = bookings.filter((booking) => ACTIVE_STATUSES.has(booking.status))
  const rows = selected.booking_link_id
    ? active.filter((booking) => booking.booking_link_id === selected.booking_link_id)
    : active.filter((booking) => bookingGroupKey(booking) === selectedGroupId)
  const groupsById = new Map()

  rows.forEach((booking) => {
    const groupId = bookingGroupKey(booking)
    const group = groupsById.get(groupId) || {
      booking_group_id: groupId,
      primary_booking_id: booking.id,
      customer_name: booking.customer_name,
      starts_at: booking.start_at,
      ends_at: booking.end_at,
      booking_ids: [],
      court_ids: [],
      subtotal: 0,
      currency: booking.currency || 'CAD',
      booking_count: 0,
      paid_count: 0,
    }
    group.booking_ids.push(booking.id)
    group.court_ids.push(booking.court_id)
    group.subtotal += Number(booking.total_amount || 0)
    group.booking_count += 1
    if (booking.payment_status === 'paid') group.paid_count += 1
    if (booking.start_at < group.starts_at) {
      group.starts_at = booking.start_at
      group.primary_booking_id = booking.id
    }
    if (booking.end_at > group.ends_at) group.ends_at = booking.end_at
    groupsById.set(groupId, group)
  })

  const groups = [...groupsById.values()]
    .map((group) => ({
      ...group,
      subtotal: Number(group.subtotal.toFixed(2)),
      payment_summary: group.paid_count === group.booking_count
        ? 'paid'
        : group.paid_count > 0 ? 'partial' : 'unpaid',
    }))
    .sort((left, right) => left.starts_at.localeCompare(right.starts_at) || left.booking_group_id.localeCompare(right.booking_group_id))

  return {
    booking_link_id: selected.booking_link_id || null,
    selected_group_id: selectedGroupId,
    group_count: groups.length,
    linked_total: Number(groups.reduce((sum, group) => sum + group.subtotal, 0).toFixed(2)),
    currency: groups[0]?.currency || selected.currency || 'CAD',
    paid_group_count: groups.filter((group) => group.payment_summary === 'paid').length,
    partially_paid: groups.some((group) => group.payment_summary === 'partial'),
    groups,
  }
}


