import { ArrowRight, LockKeyhole, Mail, X } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../lib/i18n'

export default function AuthModal({
  onClose,
  onEmail,
  onPassword,
  onGoogle,
  onDemo,
  demoMode,
  googleEnabled,
  passwordEnabled = false,
  locked = false,
}) {
  const { t, toggleLanguage } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    if (!email || (passwordEnabled && !password)) return
    setBusy(true)
    const ok = passwordEnabled
      ? await onPassword(email, password)
      : await onEmail(email)
    setBusy(false)
    if (ok && !passwordEnabled) setSent(true)
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
        <button type="button" className={`auth-language-toggle ${locked ? '' : 'with-close'}`} onClick={toggleLanguage} aria-label={t('language.switch')}>{t('language.switchShort')}</button>
        <div className="auth-seal">虎</div>
        {passwordEnabled && <span className="auth-staging-badge">{t('auth.stagingOnly')}</span>}
        <span className="eyebrow">{t('auth.eyebrow')}</span>
        <h2 id="auth-title">{t(passwordEnabled ? 'auth.stagingTitle' : 'auth.title')}</h2>
        <p>{t(passwordEnabled ? 'auth.stagingDescription' : 'auth.description')}</p>
        {sent ? (
          <div className="success-message"><Mail size={22} /><strong>{t('auth.sentTitle')}</strong><span>{t('auth.sentText')}</span></div>
        ) : (
          <form onSubmit={submit}>
            <label htmlFor="email">{t('auth.email')}</label>
            <div className="input-with-icon"><Mail size={18} /><input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="username" required /></div>
            {passwordEnabled && (
              <>
                <label className="auth-password-label" htmlFor="staging-password">{t('auth.password')}</label>
                <div className="input-with-icon"><LockKeyhole size={18} /><input id="staging-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></div>
                <small className="staging-auth-note">{t('auth.stagingPasswordNote')}</small>
              </>
            )}
            <button className="primary-button" disabled={busy || googleBusy}>
              {busy
                ? t(passwordEnabled ? 'auth.signingIn' : 'auth.sending')
                : <>{t(passwordEnabled ? 'auth.signIn' : 'auth.sendLink')} <ArrowRight size={17} /></>}
            </button>
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
