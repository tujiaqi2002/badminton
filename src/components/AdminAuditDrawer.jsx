import { AlertCircle, CalendarClock, Check, History, LoaderCircle, RotateCcw, ShieldCheck, X } from 'lucide-react'
import { COURTS, timeFromDateTime } from '../lib/booking'
import { useI18n } from '../lib/i18n'

const compactSlot = (snapshot, courtTitle) => {
  if (!snapshot?.start_at) return ''
  const court = COURTS.find((item) => item.id === snapshot.court_id)
  const date = snapshot.start_at.slice(0, 10).replaceAll('-', '.')
  const start = timeFromDateTime(snapshot.start_at)
  const end = timeFromDateTime(snapshot.end_at)
  return [date, court ? courtTitle(court) : null, `${start}–${end}`].filter(Boolean).join(' · ')
}

const eventNameKey = (eventType) => ({
  'booking.created': 'admin.audit.created',
  'booking.cancelled': 'admin.audit.cancelled',
  'booking.rescheduled': 'admin.audit.rescheduled',
  'booking.details_updated': 'admin.audit.detailsUpdated',
}[eventType] || 'admin.audit.changed')

const undoReasonKey = (reason) => ({
  already_reverted: 'admin.audit.alreadyReverted',
  changed_afterwards: 'admin.audit.changedAfterwards',
  booking_missing: 'admin.audit.bookingMissing',
  unsupported: 'admin.audit.notRevertible',
  not_found: 'admin.audit.notRevertible',
}[reason] || 'admin.audit.notRevertible')

const changedFieldKey = (field) => ({
  customer_name: 'admin.audit.fieldName',
  customer_email: 'admin.audit.fieldEmail',
  customer_phone: 'admin.audit.fieldPhone',
  customer_notes: 'admin.audit.fieldNotes',
  payment_status: 'admin.audit.fieldPayment',
}[field])

function AuditOperation({ operation, busy, onRevert }) {
  const { courtTitle, locale, t } = useI18n()
  const before = (operation.before_items || []).find(Boolean)
  const after = (operation.after_items || []).find(Boolean)
  const customerName = after?.customer_name || before?.customer_name || t('admin.audit.unknownCustomer')
  const beforeSlot = compactSlot(before, courtTitle)
  const afterSlot = compactSlot(after, courtTitle)
  const isReverted = Boolean(operation.reverted_at) || operation.undo_reason === 'already_reverted'
  const changed = (operation.changed_fields || [])
    .map((field) => changedFieldKey(field))
    .filter(Boolean)
    .map((key) => t(key))
  const happenedAt = new Intl.DateTimeFormat(locale, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(operation.occurred_at))

  return (
    <article className={`admin-audit-event ${isReverted ? 'reverted' : ''}`}>
      <header>
        <span className="admin-audit-event-icon"><History size={13} /></span>
        <div>
          <strong>{t(eventNameKey(operation.event_type))}</strong>
          <small>{happenedAt} · {operation.actor_email || t('admin.audit.manager')}</small>
        </div>
        {operation.item_count > 1 && <b>{t('admin.audit.items', { count: operation.item_count })}</b>}
      </header>
      <div className="admin-audit-event-body">
        <strong>{customerName}</strong>
        {operation.event_type === 'booking.rescheduled' && beforeSlot && afterSlot ? (
          <span>{beforeSlot}<em>→</em>{afterSlot}</span>
        ) : (
          <span>{afterSlot || beforeSlot || (changed.length ? changed.join(' · ') : t('admin.audit.bookingChanged'))}</span>
        )}
        {operation.event_type === 'booking.details_updated' && changed.length > 0 && (
          <small>{t('admin.audit.editedFields', { fields: changed.join(' · ') })}</small>
        )}
      </div>
      <footer>
        {isReverted ? (
          <span className="admin-audit-state safe"><Check size={12} /> {t('admin.audit.reverted')}</span>
        ) : operation.can_undo ? (
          <span className="admin-audit-state"><ShieldCheck size={12} /> {t('admin.audit.safeToUndo')}</span>
        ) : (
          <span className="admin-audit-state muted" title={t(undoReasonKey(operation.undo_reason))}><AlertCircle size={12} /> {t(undoReasonKey(operation.undo_reason))}</span>
        )}
        {operation.can_undo && (
          <button type="button" disabled={busy} onClick={() => onRevert(operation)}>
            {busy ? <LoaderCircle className="spin" size={13} /> : <RotateCcw size={13} />}
            {t('admin.audit.undo')}
          </button>
        )}
      </footer>
    </article>
  )
}

export default function AdminAuditDrawer({ open, operations, loading, revertingId, onClose, onRevert }) {
  const { t } = useI18n()
  if (!open) return null

  return (
    <>
      <button className="admin-audit-backdrop" type="button" aria-label={t('admin.audit.close')} onClick={onClose} />
      <aside className="admin-audit-drawer" role="dialog" aria-modal="true" aria-labelledby="admin-audit-title">
        <header>
          <div><span><History size={14} /> {t('admin.audit.eyebrow')}</span><h2 id="admin-audit-title">{t('admin.audit.title')}</h2></div>
          <button type="button" onClick={onClose} aria-label={t('admin.audit.close')}><X size={18} /></button>
        </header>
        <p>{t('admin.audit.description')}</p>
        <div className="admin-audit-list">
          {loading ? (
            <div className="admin-audit-empty"><LoaderCircle className="spin" size={20} /><span>{t('admin.audit.loading')}</span></div>
          ) : operations.length === 0 ? (
            <div className="admin-audit-empty"><CalendarClock size={22} /><strong>{t('admin.audit.empty')}</strong><span>{t('admin.audit.emptyHelp')}</span></div>
          ) : operations.map((operation) => (
            <AuditOperation
              key={operation.operation_id}
              operation={operation}
              busy={revertingId === operation.operation_id}
              onRevert={onRevert}
            />
          ))}
        </div>
        <footer>{t('admin.audit.immutableNote')}</footer>
      </aside>
    </>
  )
}
