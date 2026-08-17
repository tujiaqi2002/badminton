import { useEffect, useRef } from 'react'
import { AlertCircle, CalendarClock, Check, ChevronRight, History, LoaderCircle, RotateCcw, ShieldCheck, X } from 'lucide-react'
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

const compactOperationSlot = (items, courtTitle) => {
  const snapshots = (items || []).filter((item) => item?.start_at)
  if (!snapshots.length) return ''
  const first = snapshots[0]
  const firstDate = first.start_at.slice(0, 10)
  const sameDate = snapshots.every((item) => item.start_at.slice(0, 10) === firstDate)
  const sameTime = snapshots.every((item) => (
    timeFromDateTime(item.start_at) === timeFromDateTime(first.start_at)
    && timeFromDateTime(item.end_at) === timeFromDateTime(first.end_at)
  ))
  if (!sameDate || !sameTime) return compactSlot(first, courtTitle)

  const courtIds = new Set(snapshots.map((item) => item.court_id))
  const courts = COURTS.filter((court) => courtIds.has(court.id))
  const courtLabel = courts.length > 1
    ? `${courtTitle(courts[0])}–${courtTitle(courts.at(-1))}`
    : courts[0] ? courtTitle(courts[0]) : null
  return [
    firstDate.replaceAll('-', '.'),
    courtLabel,
    `${timeFromDateTime(first.start_at)}–${timeFromDateTime(first.end_at)}`,
  ].filter(Boolean).join(' · ')
}

const quickOperationSlot = (items, language) => {
  const snapshots = (items || []).filter((item) => item?.start_at)
  if (!snapshots.length) return null
  const first = snapshots[0]
  const firstDate = first.start_at.slice(0, 10)
  const sameDate = snapshots.every((item) => item.start_at.slice(0, 10) === firstDate)
  const sameTime = snapshots.every((item) => (
    timeFromDateTime(item.start_at) === timeFromDateTime(first.start_at)
    && timeFromDateTime(item.end_at) === timeFromDateTime(first.end_at)
  ))
  const visible = sameDate && sameTime ? snapshots : [first]
  const courtIds = new Set(visible.map((item) => item.court_id))
  const courts = COURTS.filter((court) => courtIds.has(court.id))
  const court = courts.length > 1
    ? language === 'en'
      ? `Court ${COURTS.indexOf(courts[0]) + 1}–${COURTS.indexOf(courts.at(-1)) + 1}`
      : `${courts[0].name}–${courts.at(-1).name}`
    : courts[0]
      ? language === 'en' ? courts[0].english : courts[0].name
      : ''
  return {
    date: firstDate,
    court,
    time: `${timeFromDateTime(first.start_at)}–${timeFromDateTime(first.end_at)}`,
  }
}

const shortDate = (date) => date ? date.slice(5).split('-').map(Number).join('.') : ''

const quickOperationSummary = (operation, language, changed, fallback) => {
  const before = quickOperationSlot(operation.before_items, language)
  const after = quickOperationSlot(operation.after_items, language)
  if (operation.event_type === 'booking.rescheduled' && before && after) {
    const includeDate = before.date !== after.date
    const beforeText = [includeDate ? shortDate(before.date) : '', before.court, before.time].filter(Boolean).join(' ')
    const afterText = [includeDate ? shortDate(after.date) : '', after.court, after.time].filter(Boolean).join(' ')
    return `${beforeText} → ${afterText}`
  }
  const current = after || before
  return current
    ? [current.court, current.time].filter(Boolean).join(' ')
    : changed.join(' · ') || fallback
}

const eventNameKey = (eventType) => ({
  'booking.created': 'admin.audit.created',
  'booking.cancelled': 'admin.audit.cancelled',
  'booking.rescheduled': 'admin.audit.rescheduled',
  'booking.linked': 'admin.audit.linked',
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

const operationDetails = (operation, courtTitle, t) => {
  const before = (operation.before_items || []).find(Boolean)
  const after = (operation.after_items || []).find(Boolean)
  const changed = (operation.changed_fields || [])
    .map((field) => changedFieldKey(field))
    .filter(Boolean)
    .map((key) => t(key))
  return {
    before,
    after,
    customerName: after?.customer_name || before?.customer_name || t('admin.audit.unknownCustomer'),
    beforeSlot: compactOperationSlot(operation.before_items, courtTitle),
    afterSlot: compactOperationSlot(operation.after_items, courtTitle),
    changed,
  }
}

const formatAuditTime = (occurredAt, locale, compact = false) => new Intl.DateTimeFormat(locale, compact
  ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }
  : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  .format(new Date(occurredAt))

export function AdminAuditQuickPanel({ operations, loading, onOpen, onViewAll }) {
  const { courtTitle, language, locale, t } = useI18n()
  const recent = (operations || []).slice(0, 10)

  return (
    <section className="admin-audit-quick" aria-label={t('admin.audit.quickAria')}>
      <header>
        <span><History size={14} /></span>
        <div><strong>{t('admin.audit.launchTitle')}</strong><small>{t('admin.audit.launchHelp')}</small></div>
        <b>{recent.length}</b>
      </header>
      <div className="admin-audit-quick-list" aria-live="polite">
        {loading ? (
          <div className="admin-audit-quick-empty"><LoaderCircle className="spin" size={16} /><span>{t('admin.audit.loading')}</span></div>
        ) : recent.length === 0 ? (
          <div className="admin-audit-quick-empty"><CalendarClock size={17} /><span>{t('admin.audit.empty')}</span></div>
        ) : recent.map((operation) => {
          const details = operationDetails(operation, courtTitle, t)
          const summary = quickOperationSummary(operation, language, details.changed, t('admin.audit.bookingChanged'))
          return (
            <button
              className={`admin-audit-quick-item ${operation.event_type.split('.').at(-1)} ${operation.reverted_at ? 'reverted' : ''}`}
              type="button"
              key={operation.operation_id}
              onClick={() => onOpen(operation.operation_id)}
              aria-label={t('admin.audit.openOperation', { action: t(eventNameKey(operation.event_type)), name: details.customerName })}
            >
              <span className="admin-audit-quick-heading"><strong>{t(eventNameKey(operation.event_type))}</strong><time>{formatAuditTime(operation.occurred_at, locale, true)}</time></span>
              <b>{details.customerName}</b>
              <small className="admin-audit-quick-slot">{summary}</small>
              <span className="admin-audit-quick-more">
                <small>{t('admin.audit.operator', { name: operation.actor_email?.split('@')[0] || t('admin.audit.unknownOperator') })}</small>
                <span>{operation.item_count > 1 ? t('admin.audit.items', { count: operation.item_count }) : t('admin.audit.viewDetails')}<ChevronRight size={12} /></span>
              </span>
            </button>
          )
        })}
      </div>
      <button className="admin-audit-quick-all" type="button" onClick={() => (onViewAll ? onViewAll() : onOpen(null))}>{t('admin.audit.viewAll')}<ChevronRight size={13} /></button>
    </section>
  )
}

function AuditOperation({ operation, busy, focused, elementRef, onRevert }) {
  const { courtTitle, locale, t } = useI18n()
  const { customerName, beforeSlot, afterSlot, changed } = operationDetails(operation, courtTitle, t)
  const isReverted = Boolean(operation.reverted_at) || operation.undo_reason === 'already_reverted'
  const happenedAt = formatAuditTime(operation.occurred_at, locale)

  return (
    <article ref={elementRef} className={`admin-audit-event ${isReverted ? 'reverted' : ''} ${focused ? 'focused' : ''}`}>
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

export default function AdminAuditDrawer({ open, operations, loading, revertingId, focusOperationId, onClose, onRevert }) {
  const { t } = useI18n()
  const focusedRef = useRef(null)

  useEffect(() => {
    if (!open || !focusOperationId) return undefined
    const frame = window.requestAnimationFrame(() => focusedRef.current?.scrollIntoView({ block: 'nearest' }))
    return () => window.cancelAnimationFrame(frame)
  }, [focusOperationId, open, operations])

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
              focused={focusOperationId === operation.operation_id}
              elementRef={focusOperationId === operation.operation_id ? focusedRef : null}
              onRevert={onRevert}
            />
          ))}
        </div>
        <footer>{t('admin.audit.immutableNote')}</footer>
      </aside>
    </>
  )
}
