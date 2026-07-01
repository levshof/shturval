import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Button, Card, Field, Input } from '../components/ui';
import { Icon } from '../components/ui/icons';
import { ApiError } from '../lib/api';

export function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, companyName || undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="sidebar__logo">
            <Icon name="helm" size={18} />
          </span>
          WB Shturval
        </div>
        <Card>
          <h2 className="card__title">{mode === 'login' ? 'Вход' : 'Регистрация'}</h2>
          <form className="stack" onSubmit={submit}>
            {mode === 'register' && (
              <Field label="Название компании (необязательно)">
                <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="ООО «Ромашка»" />
              </Field>
            )}
            <Field label="Email">
              <Input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field label="Пароль" error={error ?? undefined}>
              <Input
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </Field>
            <Button type="submit" variant="primary" block loading={busy}>
              {mode === 'login' ? 'Войти' : 'Создать аккаунт'}
            </Button>
          </form>
          <div className="muted" style={{ marginTop: 16, fontSize: 13, textAlign: 'center' }}>
            {mode === 'login' ? 'Нет аккаунта?' : 'Уже есть аккаунт?'}{' '}
            <button
              className="cell-link"
              style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              onClick={() => {
                setError(null);
                setMode(mode === 'login' ? 'register' : 'login');
              }}
            >
              {mode === 'login' ? 'Зарегистрироваться' : 'Войти'}
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}
