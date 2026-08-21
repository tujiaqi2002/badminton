import { ArrowRight, Mail, X } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../lib/i18n'

export default function AuthModal({ onClose, onEmail, onGoogle, onDemo, demoMode, googleEnabled, locked = false }) {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    if (!email) return
    setBusy(true)
    const ok = await onEmail(email)
    setBusy(false)
    if (ok) setSent(true)
  }

  const continueWithGoogle = async () => {
    if (googleBusy) return
    setGoogleBusy(true)
    const started = await onGoogle()
    if (!started) setGoogleBusy(false)
  }

  return (
    <div className={`modal-backdrop ${locked ? 'locked-auth' : ''}`} onMouseDown={(event) => !locked && event.target === event.currentTarget && onClose()}>
      <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        {!locked && <button type="button" className="icon-button modal-close" onClick={onClose} aria-label={t('auth.close')}><X size={20} /></button>}
        <div className="auth-seal">虎</div>
        <span className="eyebrow">{t('auth.eyebrow')}</span>
        <h2 id="auth-title">{t('auth.title')}</h2>
        <p>{t('auth.description')}</p>
        {sent ? (
          <div className="success-message"><Mail size={22} /><strong>{t('auth.sentTitle')}</strong><span>{t('auth.sentText')}</span></div>
        ) : (
          <form onSubmit={submit}>
            <label htmlFor="email">{t('auth.email')}</label>
            <div className="input-with-icon"><Mail size={18} /><input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" required /></div>
            <button className="primary-button" disabled={busy || googleBusy}>{busy ? t('auth.sending') : <>{t('auth.sendLink')} <ArrowRight size={17} /></>}</button>
          </form>
        )}
        {(demoMode || googleEnabled) && (
          <>
            <div className="auth-divider"><span>{t('auth.or')}</span></div>
            {demoMode ? (
              <button type="button" className="outline-button wide-button" onClick={onDemo}>{t('auth.demo')}</button>
            ) : (
              <button type="button" className="outline-button wide-button" onClick={continueWithGoogle} disabled={busy || googleBusy}>
                {googleBusy ? t('auth.googleStarting') : t('auth.google')}
              </button>
            )}
          </>
        )}
        <small className="terms">{t('auth.terms')}</small>
      </div>
    </div>
  )
}
