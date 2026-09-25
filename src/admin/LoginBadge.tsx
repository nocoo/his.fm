import { Button, ThemeToggle } from '@nocoo/basalt';
import { ArrowLeft, ArrowUpRight, AudioLines, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { errorMessage } from './model';
import { adminService } from './service';

export function LoginBadge() {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const local = import.meta.env.DEV;
  async function login() {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await adminService.login();
      navigate('/admin');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="admin-login">
      <div className="admin-login-tools">
        <Button variant="ghost" asChild>
          <Link to="/">
            <ArrowLeft size={16} />
            返回网站
          </Link>
        </Button>
        <ThemeToggle aria-label="切换主题" />
      </div>
      <div className="admin-login-badge" data-basalt-surface-root="">
        <div className="admin-badge-strip">
          <span className="admin-badge-slot" />
          <strong>his.fm</strong>
          <span>STUDIO</span>
        </div>
        <div className="admin-badge-body">
          <div className="admin-badge-mark">
            <AudioLines size={42} strokeWidth={1.3} />
          </div>
          <p className="admin-eyebrow">A PLACE FOR GOOD STORIES</p>
          <h1>欢迎回到工作室</h1>
          <p>
            下一段值得听见的声音，
            <br />
            从这里开始。
          </p>
          <div className="admin-badge-actions">
            {error && (
              <p className="admin-error" role="alert">
                {error}
              </p>
            )}
            {local ? (
              <Button loading={pending} onClick={login}>
                进入本地工作室
                <ArrowUpRight size={16} />
              </Button>
            ) : (
              <Button asChild>
                <a href="/admin">
                  通过 Access 登录
                  <ArrowUpRight size={16} />
                </a>
              </Button>
            )}
            <span>{local ? '本地开发环境 · 独立测试数据' : '仅限 his.fm 内容管理团队'}</span>
          </div>
        </div>
        <div className="admin-badge-status">
          <ShieldCheck size={14} />
          {local ? 'LOCAL DEVELOPMENT' : 'PROTECTED BY CLOUDFLARE ACCESS'}
        </div>
      </div>
      <span className="admin-login-caption">MAKE ROOM FOR A HUMAN VOICE.</span>
    </main>
  );
}
