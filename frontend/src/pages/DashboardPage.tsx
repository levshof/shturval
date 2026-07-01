import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { formatDate, formatDateFull, formatMoney, formatMoneyShort, formatNum } from '../lib/format';
import { healthView, PROFIT_STATUS, supplyStatusView } from '../lib/status';
import { Banner, Button, Card, EmptyState, LoadingBlock, Metric, StatusBadge } from '../components/ui';
import { Icon } from '../components/ui/icons';
import { useToast } from '../components/ui/toast';
import { ProductCardModal } from './ProductCardModal';

interface DashboardData {
  setup: { hasKey: boolean; keyValid: boolean; hasData: boolean; firstRun: boolean };
  finance: { revenue30: number; profit30: number | null; missedProfit30: number; profitStatus: 'full' | 'partial' | 'none' };
  chart: Array<{ date: string; revenue: number; profit: number | null }>;
  tasks: Array<{
    date: string;
    type: 'order' | 'receive';
    nmId: number;
    supplierArticle: string;
    title: string | null;
    qty: number;
    status: string;
    expectedDate?: string;
  }>;
  hidden: Array<{ nmId: number; supplierArticle: string; title: string | null; recommendedQty: number; health: string }>;
  topProducts: Array<{ nmId: number; supplierArticle: string; category: string | null; units30: number; revenue30: number; profit30: number | null }>;
  sync?: {
    isRunning: boolean;
    lastSyncAt: string | null;
    lastStatus: string | null;
    lastError: string | null;
    steps: Record<string, { status: string; message?: string; count?: number }> | null;
  };
}

// Human-readable labels for sync steps (matches syncEngine step keys).
const SYNC_STEP_LABEL: Record<string, string> = {
  key: 'API-ключ',
  orders: 'Заказы',
  sales: 'Продажи',
  stocks: 'Остатки',
  finance: 'Финансовый отчёт (расходы WB)',
  ads: 'Реклама',
  products: 'Карточки товаров',
  supplies: 'Поставки',
  recompute: 'Пересчёт аналитики',
  fatal: 'Ошибка синхронизации',
};

function mskToday(): string {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}
function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dayLabel(offset: number, date: string): string {
  if (offset === 0) return 'Сегодня';
  if (offset === 1) return 'Завтра';
  if (offset === 2) return 'Послезавтра';
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(
    new Date(`${date}T00:00:00`),
  );
}

export function DashboardPage() {
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardData>('/api/dashboard') });
  const [openNm, setOpenNm] = useState<number | null>(null);

  if (isLoading || !data) {
    return (
      <Card>
        <LoadingBlock rows={6} />
      </Card>
    );
  }

  if (data.setup.firstRun) {
    return (
      <Card>
        <EmptyState
          icon={<Icon name="helm" size={30} />}
          title={data.setup.hasKey ? 'Запустите первую синхронизацию' : 'Подключите Wildberries'}
          description={
            data.setup.hasKey
              ? 'API-ключ подключён. Нажмите «Синхронизировать» вверху справа, чтобы загрузить товары, остатки и продажи.'
              : 'Чтобы начать работу, добавьте API-ключ Wildberries в настройках и запустите синхронизацию.'
          }
          action={
            !data.setup.hasKey && (
              <Link to="/settings">
                <Button variant="primary">Открыть настройки</Button>
              </Link>
            )
          }
        />
      </Card>
    );
  }

  return (
    <div className="stack">
      <SyncDiagnostics sync={data.sync} />

      <div className="dash-split">
        <div className="stack" style={{ gap: 16 }}>
          <Card pad="sm">
            <Metric label="Выручка за 30 дней" value={<span className="num">{formatMoney(data.finance.revenue30)}</span>} />
          </Card>
          <Card pad="sm" className="card--tint-success">
            <div className="row between">
              <Metric
                label="Прибыль за 30 дней"
                value={<span className="num">{formatMoney(data.finance.profit30)}</span>}
                trend={data.finance.profit30 != null ? (data.finance.profit30 >= 0 ? 'up' : 'down') : undefined}
              />
              <StatusBadge view={PROFIT_STATUS[data.finance.profitStatus]} dot={false} />
            </div>
          </Card>
          <Card pad="sm" className="card--tint-danger">
            <Metric
              label="Упущенная прибыль (нет товара)"
              value={<span className="num">{formatMoney(data.finance.missedProfit30)}</span>}
              trend={data.finance.missedProfit30 > 0 ? 'down' : undefined}
            />
          </Card>
        </div>

        <Card title="Выручка и прибыль, 30 дней">
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <AreaChart data={data.chart} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 11, fill: 'var(--text-3)' }} interval={4} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-3)' }} tickFormatter={(v) => formatMoneyShort(v)} width={64} />
                <Tooltip
                  formatter={(v: number, name) => [formatMoney(v), name === 'revenue' ? 'Выручка' : 'Прибыль']}
                  labelFormatter={(l) => formatDateFull(String(l))}
                />
                <Area type="monotone" dataKey="revenue" stroke="var(--brand)" strokeWidth={2} fill="url(#rev)" />
                <Area type="monotone" dataKey="profit" stroke="var(--success)" strokeWidth={2} fill="none" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <ActionPlan tasks={data.tasks} onOpen={setOpenNm} />

      {data.hidden.length > 0 && <HiddenTasks hidden={data.hidden} onOpen={setOpenNm} />}

      <TopProducts items={data.topProducts} onOpen={setOpenNm} />

      {openNm != null && <ProductCardModal nmId={openNm} onClose={() => setOpenNm(null)} />}
    </div>
  );
}

function SyncDiagnostics({ sync }: { sync: DashboardData['sync'] }) {
  if (!sync || sync.isRunning) return null;

  const steps = sync.steps ?? {};
  // Surface only the steps that need attention (warnings/errors), so a clean
  // sync stays quiet. This is where "why is advertising/expenses zero?" is
  // answered: e.g. the key is missing the "Продвижение" category.
  const problems = Object.entries(steps)
    .filter(([, s]) => s && (s.status === 'warn' || s.status === 'error'))
    .map(([key, s]) => ({ key, label: SYNC_STEP_LABEL[key] ?? key, ...s }));

  const failed = sync.lastStatus === 'FAILED';
  if (!failed && problems.length === 0) return null;

  return (
    <Card title="Состояние последней синхронизации">
      <div className="stack" style={{ gap: 8 }}>
        {failed && (
          <Banner variant="danger" title="Синхронизация завершилась с ошибкой">
            {sync.lastError ?? 'Неизвестная ошибка. Запустите синхронизацию повторно.'}
          </Banner>
        )}
        {problems.map((p) => (
          <Banner key={p.key} variant={p.status === 'error' ? 'danger' : 'warning'} title={p.label}>
            {p.message ?? 'Данные за этот раздел не загрузились.'}
            {p.key === 'ads' && (
              <div className="muted-3" style={{ fontSize: 12, marginTop: 4 }}>
                Проверьте, что в токене WB включена категория «Продвижение» и есть активные кампании за период.
              </div>
            )}
            {p.key === 'finance' && (
              <div className="muted-3" style={{ fontSize: 12, marginTop: 4 }}>
                Финансовый отчёт WB формируется по закрытым неделям — расходы WB и прибыль появятся после его загрузки.
              </div>
            )}
          </Banner>
        ))}
      </div>
    </Card>
  );
}

function ActionPlan({ tasks, onOpen }: { tasks: DashboardData['tasks']; onOpen: (n: number) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const today = mskToday();
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => ({ offset: i, date: addDays(today, i) })),
    [today],
  );
  const [sel, setSel] = useState(today);

  const hide = useMutation({
    mutationFn: (nmId: number) => api.post('/api/dashboard/hide-task', { nmIds: [nmId] }),
    onSuccess: () => {
      toast('info', 'Задача скрыта');
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const countByDate = (d: string) => tasks.filter((t) => t.date === d).length;
  const dayTasks = tasks.filter((t) => t.date === sel);
  const orders = dayTasks.filter((t) => t.type === 'order');
  const receives = dayTasks.filter((t) => t.type === 'receive');

  return (
    <Card title="Что требует внимания">
      <div className="tabs" style={{ marginBottom: 16 }}>
        {days.map((d) => (
          <button key={d.date} className={`tab ${sel === d.date ? 'active' : ''}`} onClick={() => setSel(d.date)}>
            {dayLabel(d.offset, d.date)}
            {countByDate(d.date) > 0 && <span className="tab__count">{countByDate(d.date)}</span>}
          </button>
        ))}
      </div>

      {dayTasks.length === 0 ? (
        <div className="muted" style={{ padding: '12px 0' }}>
          На этот день задач нет.
        </div>
      ) : (
        <div className="grid grid-2">
          <div>
            <div className="label" style={{ marginBottom: 8 }}>
              Заказать ({orders.length})
            </div>
            <div className="stack" style={{ gap: 8 }}>
              {orders.length === 0 && <span className="muted-3">—</span>}
              {orders.map((t) => (
                <div key={`o${t.nmId}`} className="row between">
                  <div>
                    <span className="cell-link" onClick={() => onOpen(t.nmId)}>
                      {t.supplierArticle}
                    </span>{' '}
                    <span className="num">· {formatNum(t.qty)} шт</span>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <StatusBadge view={healthView(t.status)} />
                    <Button size="sm" variant="ghost" onClick={() => hide.mutate(t.nmId)}>
                      Скрыть
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>
              Принять поставки ({receives.length})
            </div>
            <div className="stack" style={{ gap: 8 }}>
              {receives.length === 0 && <span className="muted-3">—</span>}
              {receives.map((t) => (
                <div key={`r${t.nmId}-${t.expectedDate}`} className="row between">
                  <div>
                    <span className="cell-link" onClick={() => onOpen(t.nmId)}>
                      {t.supplierArticle}
                    </span>{' '}
                    <span className="num">· {formatNum(t.qty)} шт</span>
                  </div>
                  <StatusBadge view={supplyStatusView(t.status)} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function HiddenTasks({ hidden, onOpen }: { hidden: DashboardData['hidden']; onOpen: (n: number) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const unhide = useMutation({
    mutationFn: (nmId: number) => api.post('/api/dashboard/unhide-task', { nmIds: [nmId] }),
    onSuccess: () => {
      toast('info', 'Задача возвращена');
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  return (
    <Card title={`Скрытые задачи (${hidden.length})`}>
      <div className="stack" style={{ gap: 8 }}>
        {hidden.map((h) => (
          <div key={h.nmId} className="row between">
            <div>
              <span className="cell-link" onClick={() => onOpen(h.nmId)}>
                {h.supplierArticle}
              </span>{' '}
              <span className="num muted">· заказать {formatNum(h.recommendedQty)} шт</span>
            </div>
            <Button size="sm" variant="secondary" onClick={() => unhide.mutate(h.nmId)}>
              Вернуть
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TopProducts({ items, onOpen }: { items: DashboardData['topProducts']; onOpen: (n: number) => void }) {
  if (items.length === 0) {
    return (
      <Card title="Топ товаров по прибыли">
        <div className="muted">Недостаточно данных. Заполните себестоимость и запустите синхронизацию.</div>
      </Card>
    );
  }
  return (
    <Card title="Топ товаров по прибыли" pad="sm">
      <div className="table-wrap" style={{ border: 'none' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Артикул</th>
              <th>Категория</th>
              <th className="right">Продажи 30д</th>
              <th className="right">Выручка</th>
              <th className="right">Прибыль</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.nmId}>
                <td>
                  <span className="cell-link" onClick={() => onOpen(p.nmId)}>
                    {p.supplierArticle}
                  </span>
                </td>
                <td className="muted">{p.category ?? '—'}</td>
                <td className="cell-num">{formatNum(p.units30)}</td>
                <td className="cell-num">{formatMoney(p.revenue30)}</td>
                <td className="cell-num">{formatMoney(p.profit30)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
