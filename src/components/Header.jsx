import { CalendarDays, LogOut, UserRound } from 'lucide-react'

export default function Header({ user, view, onViewChange, onAuth, onSignOut }) {
  return (
    <header className="site-header">
      <button className="brand" onClick={() => onViewChange('book')} aria-label="返回预约首页">
        <span className="brand-mark" aria-hidden="true">虎</span>
        <span><strong>TIGER</strong><small>羽球馆</small></span>
      </button>

      <nav className="desktop-nav" aria-label="主导航">
        <button className={view === 'book' ? 'active' : ''} onClick={() => onViewChange('book')}>
          <CalendarDays size={17} /> 场地
        </button>
        <button className={view === 'mine' ? 'active' : ''} onClick={() => onViewChange('mine')}>
          <UserRound size={17} /> 我的预订
        </button>
      </nav>

      {user ? (
        <button className="account-button" onClick={onSignOut} title="退出登录">
          <span className="avatar">{(user.email || '体验用户').slice(0, 1).toUpperCase()}</span>
          <span className="account-label">{user.email?.split('@')[0] || '体验用户'}</span>
          <LogOut size={15} />
        </button>
      ) : (
        <button className="outline-button header-login" onClick={onAuth}>登录 / 注册</button>
      )}
    </header>
  )
}
