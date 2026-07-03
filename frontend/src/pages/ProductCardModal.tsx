import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import { formatDate, formatDateFull, formatDays, formatMoney, formatNum, formatPercent, formatUnits } from '../lib/format';
import { dataQualityView, healthView, supplyStatusView } from '../lib/status';
import {
  Badge,
  Banner,
  Button,
  Card,
  Field,
  LoadingBlock,
  Metric,
  Modal,
  NumberInput,
  StatusBadge,
} from '../components/ui';
import { Icon } from '../components/ui/icons';
import { useToast } from '../components/ui/toast';

interface ProductCard {
  info: {
    nmId: number;
    supplierArticle: string;
    title: string | null;
    category: string | null;
    brand: string | null;
    photoUrl: string | null;
    archived: boolean;
    recommendation: string;
  };
  kpis: {
    currentStock: number;
    inTransitQty: number;
    deficitDate: string | null;
    avgDailySales: number;
    daysOfStock: number | null;
    health: string;
  };
  recommendedQty: number;
  economics: {
    revenue: number;
    profit: number | null;
    units: number;
    avgPrice: number | null;
    cost: number | null;
    wbExpenses: number | null;
    adSpend: number;
    adEstimated: boolean;
    tax: number;
    profitPerUnit: number | null;
    marginPercent: number | null;
    expensesSharePercent: number | null;
    dataQuality: string;
    flags: { hasFinanceReport: boolean; hasCost: boolean; hasAds: boolean };
  };
  settings: {
    leadTimeDays: number;
    orderBufferDays: number;
    orderQuantum: number;
    targetStockDays: number;
    taxPercent: number;
    active: boolean;
  };
  cost: { unitCost: number } | null;
  supplies: Array<{ id: string; quantity: number; acceptedQty: number; remaining: number; expectedDate: string; status: string }>;
  chart: Array<{ date: string; units: number; revenue: number; profit: number | null; projected: boolean }>;
  chartProjectedFrom: string;
}

function buildInsight(card: ProductCard): string {
  const { daysOfStock, avgDailySales } = card.kpis;
  const coverage = daysOfStock != null ? `покрытие ${formatDays(daysOfStock)}` : null;
  const detail = [coverage, `продажи ${formatNum(avgDailySales, 1)} шт/день`].filter(Boolean).join(', ');
  return `${card.info.recommendation} (${detail})`;
}

type Panel = 'supply' | 'params' | null;

export function ProductCardModal({ nmId, onClose }: { nmId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [panel, setPanel] = useState<Panel>(null);
  const { data, isLoading } = useQuery({ queryKey: ['product', nmId], queryFn: () => api.get<ProductCard>(`/api/products/${nmId}`) });

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ['product', nmId] });
    void qc.invalidateQueries({ queryKey: ['products'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['transit'] });
  };

  const togglePanel = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));

  return (
    <Modal
      open
      title={data ? '' : 'Товар'}
      onClose={onClose}
      wide
      headerActions={
        data && (
          <>
            <Button variant={panel === 'supply' ? 'primary' : 'secondary'} size="sm" onClick={() => togglePanel('supply')}>
              <Icon name="truck" size={16} /> Поставка
            </Button>
            <Button variant={panel === 'params' ? 'primary' : 'secondary'} size="sm" onClick={() => togglePanel('params')}>
              <Icon name="settings" size={16} /> Параметры
            </Button>
          </>
        )
      }
    >
      {isLoading || !data ? (
        <LoadingBlock rows={6} />
      ) : (
        <div className="stack">
          <div>
            <div className="row" style={{ gap: 8 }}>
              <h2 style={{ fontSize: 'var(--fs-h1)', fontWeight: 700 }}>{data.info.supplierArticle}</h2>
              <StatusBadge view={healthView(data.kpis.health)} />
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              {data.info.title ?? 'Без названия'} · NM {data.info.nmId}
              {data.info.brand ? ` · ${data.info.brand}` : ''}
              {data.info.category ? ` · ${data.info.category}` : ''}
            </div>
            <div className="muted-3" style={{ fontSize: 13, marginTop: 8 }}>{buildInsight(data)}</div>
          </div>

          <div className="grid grid-4">
            <Metric label="Сейчас на складе" value={<span className="num">{formatNum(data.kpis.currentStock)}</span>} small />
            <Metric label="Активная поставка" value={<span className="num">{formatNum(data.kpis.inTransitQty)}</span>} small />
            <Metric
              label="Дефицит"
              value={<span className="num">{data.kpis.deficitDate ? formatDate(data.kpis.deficitDate) : '—'}</span>}
              small
            />
            <Metric label="Продажи в день" value={<span className="num">{formatNum(data.kpis.avgDailySales, 1)}</span>} small />
          </div>

          {panel === 'supply' && <SupplyPanel nmId={nmId} card={data} onDone={invalidateAll} />}
          {panel === 'params' && <ParamsPanel nmId={nmId} card={data} onDone={invalidateAll} />}
          {panel === null && (
            <div className="grid grid-2">
              <ChartCard card={data} />
              <EconomicsCard card={data} />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function ChartCard({ card }: { card: ProductCard }) {
  const [mode, setMode] = useState<'sales' | 'finance'>('sales');
  const projectedStart = card.chart.findIndex((d) => d.projected);
  const projFrom = projectedStart >= 0 ? card.chart[projectedStart].date : null;
  const projTo = card.chart[card.chart.length - 1]?.date;

  return (
    <Card
      title="Продажи по дням"
      actions={
        <div className="tabs">
          <button className={`tab ${mode === 'sales' ? 'active' : ''}`} onClick={() => setMode('sales')}>
            <span className="tab__dot" style={{ background: mode === 'sales' ? '#fff' : 'var(--info)' }} />
            Продажи
          </button>
          <button className={`tab ${mode === 'finance' ? 'active' : ''}`} onClick={() => setMode('finance')}>
            <span className="tab__dot" style={{ background: mode === 'finance' ? '#fff' : 'var(--brand)' }} />
            Выручка + прибыль
          </button>
        </div>
      }
    >
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          {mode === 'sales' ? (
            <BarChart data={card.chart} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 11, fill: 'var(--text-3)' }} interval={4} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-3)' }} allowDecimals={false} />
              <Tooltip formatter={(v: number) => [`${v} шт`, 'Продажи']} labelFormatter={(l) => formatDateFull(String(l))} />
              {projFrom && projTo && <ReferenceArea x1={projFrom} x2={projTo} fill="var(--brand-soft)" fillOpacity={0.5} />}
              <Bar dataKey="units" fill="var(--info)" radius={[2, 2, 0, 0]} />
            </BarChart>
          ) : (
            <LineChart data={card.chart} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 11, fill: 'var(--text-3)' }} interval={4} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
              <Tooltip
                formatter={(v: number, name) => [formatMoney(v), name === 'revenue' ? 'Выручка' : 'Прибыль']}
                labelFormatter={(l) => formatDateFull(String(l))}
              />
              {projFrom && projTo && <ReferenceArea x1={projFrom} x2={projTo} fill="var(--brand-soft)" fillOpacity={0.5} />}
              <Line type="monotone" dataKey="revenue" stroke="var(--brand)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="profit" stroke="var(--success)" strokeWidth={2} dot={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      <div className="muted-3" style={{ fontSize: 12, marginTop: 4 }}>
        Заштрихованная зона — текущая (незакрытая) неделя, значения прогнозные.
      </div>
    </Card>
  );
}

function Mini({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="mini">
      <div className="mini__label">{label}</div>
      <div className="mini__value">{value}</div>
      {hint && <div className="mini__hint">{hint}</div>}
    </div>
  );
}

function EconomicsCard({ card }: { card: ProductCard }) {
  const e = card.economics;
  const missing = [
    !e.flags.hasCost && 'себестоимость',
    !e.flags.hasFinanceReport && 'финотчёт WB',
    !e.flags.hasAds && 'реклама',
  ].filter(Boolean) as string[];
  const netFromWb = e.wbExpenses != null ? e.revenue - e.wbExpenses : null;

  return (
    <Card title="Проверенная экономика" actions={<StatusBadge view={dataQualityView(e.dataQuality)} dot={false} />}>
      {missing.length > 0 && (
        <Banner variant="warning">Нет данных: {missing.join(', ')} — цифры приблизительные.</Banner>
      )}
      <div className="grid grid-2" style={{ margin: missing.length > 0 ? '12px 0 16px' : '0 0 16px' }}>
        <Metric
          label="Выручка"
          value={<span className="num">{formatMoney(e.revenue)}</span>}
          sub={netFromWb != null ? `Поступит от WB: ${formatMoney(netFromWb)}` : undefined}
        />
        <Metric
          label="Прибыль"
          value={<span className="num">{formatMoney(e.profit)}</span>}
          sub={e.marginPercent != null ? `${formatPercent(e.marginPercent)} маржа` : undefined}
          trend={e.profit != null ? (e.profit >= 0 ? 'up' : 'down') : undefined}
        />
      </div>
      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <Metric label="Продано" value={<span className="num">{formatUnits(e.units)}</span>} small />
        <Metric label="Средняя цена" value={<span className="num">{formatMoney(e.avgPrice)}</span>} small />
      </div>
      <div className="mini-grid">
        <Mini label="Себестоимость" value={formatMoney(e.cost)} />
        <Mini label="Расходы WB" value={formatMoney(e.wbExpenses)} />
        <Mini label="Реклама" value={formatMoney(e.adSpend)} hint={e.adEstimated ? 'частично оценка' : undefined} />
        <Mini label="Налог" value={formatMoney(e.tax)} />
      </div>
    </Card>
  );
}

function SupplyPanel({ nmId, card, onDone }: { nmId: number; card: ProductCard; onDone: () => void }) {
  const toast = useToast();
  const [qty, setQty] = useState(card.recommendedQty || card.settings.orderQuantum);
  const [days, setDays] = useState(card.settings.leadTimeDays);
  const create = useMutation({
    mutationFn: () => api.post('/api/supplies', { nmId, quantity: qty, expectedInDays: days }),
    onSuccess: () => {
      toast('success', 'Поставка создана');
      onDone();
    },
    onError: (e: Error) => toast('danger', e.message),
  });
  return (
    <Card title="Поставка" pad="sm">
      <div className="grid grid-2">
        <div className="stack" style={{ gap: 12 }}>
          <div className="muted" style={{ fontSize: 13 }}>
            Рекомендуем заказать: <strong className="num">{formatNum(card.recommendedQty)} шт</strong>
          </div>
          <div className="grid grid-2">
            <Field label="Количество, шт">
              <NumberInput value={qty} onChange={(e) => setQty(Number(e.target.value))} />
            </Field>
            <Field label="Придёт через, дней">
              <NumberInput value={days} onChange={(e) => setDays(Number(e.target.value))} />
            </Field>
          </div>
          <Button variant="primary" block onClick={() => create.mutate()} loading={create.isPending} disabled={qty <= 0}>
            Создать поставку
          </Button>
        </div>
        <div>
          <div className="metric__label" style={{ marginBottom: 8 }}>
            Текущие поставки
          </div>
          {card.supplies.length === 0 ? (
            <div className="muted-3" style={{ fontSize: 13 }}>
              Нет активных поставок.
            </div>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {card.supplies.map((s) => (
                <div key={s.id} className="row between">
                  <span className="num" style={{ fontSize: 13 }}>
                    {s.acceptedQty} / {s.quantity} шт · к {formatDateFull(s.expectedDate)}
                  </span>
                  <StatusBadge view={supplyStatusView(s.status)} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function ParamsPanel({ nmId, card, onDone }: { nmId: number; card: ProductCard; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    unitCost: card.cost?.unitCost ?? 0,
    taxPercent: card.settings.taxPercent,
    leadTimeDays: card.settings.leadTimeDays,
    orderBufferDays: card.settings.orderBufferDays,
    orderQuantum: card.settings.orderQuantum,
    targetStockDays: card.settings.targetStockDays,
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: Number(e.target.value) });

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, number> = {
        taxPercent: form.taxPercent,
        leadTimeDays: form.leadTimeDays,
        orderBufferDays: form.orderBufferDays,
        orderQuantum: form.orderQuantum,
        targetStockDays: form.targetStockDays,
      };
      if (form.unitCost > 0) body.unitCost = form.unitCost;
      return api.put(`/api/products/${nmId}/params`, body);
    },
    onSuccess: () => {
      toast('success', 'Параметры сохранены');
      onDone();
    },
  });

  return (
    <Card title="Параметры" pad="sm">
      <div className="grid grid-3">
        <Field label="Себестоимость, ₽/шт">
          <NumberInput value={form.unitCost} onChange={set('unitCost')} />
        </Field>
        <Field label="Налог, %">
          <NumberInput value={form.taxPercent} onChange={set('taxPercent')} />
        </Field>
        <Field label="Срок поставки, дней">
          <NumberInput value={form.leadTimeDays} onChange={set('leadTimeDays')} />
        </Field>
        <Field label="Буфер, дней">
          <NumberInput value={form.orderBufferDays} onChange={set('orderBufferDays')} />
        </Field>
        <Field label="Квант заказа">
          <NumberInput value={form.orderQuantum} onChange={set('orderQuantum')} />
        </Field>
        <Field label="Целевой запас, дней">
          <NumberInput value={form.targetStockDays} onChange={set('targetStockDays')} />
        </Field>
      </div>
      <div className="row between" style={{ marginTop: 12 }}>
        {card.cost == null ? <Badge variant="warning">Себестоимость не заполнена</Badge> : <span />}
        <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
          Сохранить параметры
        </Button>
      </div>
    </Card>
  );
}
