import { useEffect, useRef } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatRelative } from '../../lib/format';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../ui/toast';
import { Button, Spinner } from '../ui';
import { Icon, type IconName } from '../ui/icons';

export interface SyncStatus {
  isRunning: boolean;
  lastSyncAt: string | null;
  latest: { status: string; error: string | null } | null;
}

const NAV: Array<{ to: string; label: string; icon: IconName; end: boolean }> = [
  { to: '/', label: 'Дашборд', icon: 'dashboard', end: true },
  { to: '/products', label: 'Товары', icon: 'box', end: false },
  { to: '/transit', label: 'В пути', icon: 'truck', end: false },
  { to: '/settings', label: 'Настройки', icon: 'settings', end: false },
];

export function AppLayout() {
  const { logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__logo">
            <Icon name="helm" size={18} />
          </span>
          WB Shturval
        </div>

        <SidebarSync />

        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav__item ${isActive ? 'active' : ''}`}>
              <Icon name={n.icon} size={18} />
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="nav__spacer" />
        <button className="nav__item" onClick={() => void logout()}>
          <Icon name="logout" size={18} />
          Выход
        </button>
      </aside>

      <div className="main">
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function SidebarSync() {
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
    <div className="sync-card">
      <div className="sync-card__label">Синхронизация</div>
      {running ? (
        <>
          <span className="sync-card__running">
            <Spinner brand /> Идёт синхронизация…
          </span>
          <Button size="sm" variant="secondary" block onClick={() => reset.mutate()} loading={reset.isPending}>
            Сбросить
          </Button>
        </>
      ) : (
        <>
          <div className="sync-card__time">Обновлено: {formatRelative(data?.lastSyncAt)}</div>
          <Button size="sm" variant="primary" block onClick={() => start.mutate()} loading={start.isPending}>
            <Icon name="refresh" size={15} /> Синхронизировать
          </Button>
        </>
      )}
    </div>
  );
}
