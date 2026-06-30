import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatRelative } from '../../lib/format';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../ui/toast';
import { Button, Spinner } from '../ui';

export interface SyncStatus {
  isRunning: boolean;
  lastSyncAt: string | null;
  latest: { status: string; error: string | null } | null;
}

const NAV = [
  { to: '/', label: 'Дашборд', icon: '◵', end: true },
  { to: '/products', label: 'Товары', icon: '▤', end: false },
  { to: '/transit', label: 'В пути', icon: '⇉', end: false },
  { to: '/settings', label: 'Настройки', icon: '⚙', end: false },
];

const TITLES: Record<string, string> = {
  '/': 'Дашборд',
  '/products': 'Товары',
  '/transit': 'В пути',
  '/settings': 'Настройки',
};

export function AppLayout() {
  const { logout } = useAuth();
  const location = useLocation();
  const title = TITLES[location.pathname] ?? 'WB Shturval';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__logo">⎈</span>
          WB Shturval
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav__item ${isActive ? 'active' : ''}`}>
              <span aria-hidden>{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="nav__spacer" />
        <button className="nav__item" onClick={() => void logout()}>
          <span aria-hidden>⨯</span>
          Выход
        </button>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar__title">{title}</div>
          <SyncControl />
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function SyncControl() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => api.get<SyncStatus>('/api/sync/status'),
    refetchInterval: (q) => (q.state.data?.isRunning ? 4000 : false),
  });

  const start = useMutation({
    mutationFn: () => api.post('/api/sync', {}),
    onSuccess: () => {
      toast('info', 'Синхронизация запущена');
      void qc.invalidateQueries({ queryKey: ['sync-status'] });
    },
    onError: (e: Error) => toast('warning', e.message),
  });

  const reset = useMutation({
    mutationFn: () => api.post('/api/sync/reset', {}),
    onSuccess: () => {
      toast('info', 'Синхронизация сброшена');
      void qc.invalidateQueries({ queryKey: ['sync-status'] });
    },
  });

  // When a running sync finishes, refresh data views and notify.
  const running = data?.isRunning ?? false;
  const prevRunning = useRef(false);
  useEffect(() => {
    if (prevRunning.current && !running) {
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['transit'] });
      const status = data?.latest?.status;
      if (status === 'SUCCESS') toast('success', 'Синхронизация завершена');
      else if (status === 'FAILED') toast('danger', data?.latest?.error ?? 'Синхронизация завершилась с ошибкой');
    }
    prevRunning.current = running;
  }, [running, data?.latest?.status, data?.latest?.error, qc, toast]);

  return (
    <div className="row" style={{ gap: 12 }}>
      {running ? (
        <>
          <span className="row muted" style={{ gap: 6, fontSize: 13 }}>
            <Spinner brand /> Идёт синхронизация…
          </span>
          <Button size="sm" variant="ghost" onClick={() => reset.mutate()} loading={reset.isPending}>
            Сбросить
          </Button>
        </>
      ) : (
        <>
          <span className="muted" style={{ fontSize: 13 }}>
            Обновлено: {formatRelative(data?.lastSyncAt)}
          </span>
          <Button size="sm" variant="primary" onClick={() => start.mutate()} loading={start.isPending}>
            Синхронизировать
          </Button>
        </>
      )}
    </div>
  );
}
