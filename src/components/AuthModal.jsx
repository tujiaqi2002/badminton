import { ArrowRight, Mail, X } from 'lucide-react'
import { useState } from 'react'

export default function AuthModal({ onClose, onEmail, onGoogle, onDemo, demoMode, googleEnabled }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    if (!email) return
    setBusy(true)
    const ok = await onEmail(email)
    setBusy(false)
    if (ok) setSent(true)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="icon-button modal-close" onClick={onClose} aria-label="关闭"><X size={20} /></button>
        <div className="auth-seal">虎</div>
        <span className="eyebrow">欢迎来到 Tiger</span>
        <h2 id="auth-title">一封邮件，即刻开场</h2>
        <p>无需记密码。我们会发送安全登录链接到你的邮箱。</p>
        {sent ? (
          <div className="success-message"><Mail size={22} /><strong>登录链接已发送</strong><span>请打开邮件完成登录。</span></div>
        ) : (
          <form onSubmit={submit}>
            <label htmlFor="email">邮箱地址</label>
            <div className="input-with-icon"><Mail size={18} /><input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" required /></div>
            <button className="primary-button" disabled={busy}>{busy ? '发送中…' : <>发送登录链接 <ArrowRight size={17} /></>}</button>
          </form>
        )}
        {(demoMode || googleEnabled) && (
          <>
            <div className="auth-divider"><span>或</span></div>
            {demoMode ? (
              <button className="outline-button wide-button" onClick={onDemo}>进入体验模式</button>
            ) : (
              <button className="outline-button wide-button" onClick={onGoogle}>使用 Google 继续</button>
            )}
          </>
        )}
        <small className="terms">继续即表示你同意《使用条款》和《隐私政策》。</small>
      </div>
    </div>
  )
}
