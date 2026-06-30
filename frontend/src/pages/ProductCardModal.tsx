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

export function ProductCardModal({ nmId, onClose }: { nmId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['product', nmId], queryFn: () => api.get<ProductCard>(`/api/products/${nmId}`) });

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ['product', nmId] });
    void qc.invalidateQueries({ queryKey: ['products'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['transit'] });
  };

  return (
    <Modal open title={data ? `${data.info.supplierArticle}` : 'Товар'} onClose={onClose} wide>
      {isLoading || !data ? (
        <LoadingBlock rows={6} />
      ) : (
        <div className="stack">
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div>
              <div className="row" style={{ gap: 8 }}>
                <StatusBadge view={healthView(data.kpis.health)} />
                {data.info.category && <span className="muted">{data.info.category}</span>}
              </div>
              <div className="muted-3" style={{ fontSize: 12, marginTop: 4 }}>
                nmID {data.info.nmId}
                {data.info.brand ? ` · ${data.info.brand}` : ''}
              </div>
            </div>
          </div>

          <Banner variant={data.kpis.health === 'NORMAL' || data.kpis.health === 'OVERSTOCK' ? 'info' : 'warning'}>
            {data.info.recommendation}
          </Banner>

          <div className="grid grid-4">
            <Metric label="Текущий остаток" value={<span className="num">{formatNum(data.kpis.currentStock)}</span>} small />
            <Metric label="В пути" value={<span className="num">{formatNum(data.kpis.inTransitQty)}</span>} small />
            <Metric label="Продажи в день" value={<span className="num">{formatNum(data.kpis.avgDailySales, 1)}</span>} small />
            <Metric
              label="Дата дефицита"
              value={<span className="num">{data.kpis.deficitDate ? formatDate(data.kpis.deficitDate) : '—'}</span>}
              sub={data.kpis.daysOfStock != null ? `запас ${formatDays(data.kpis.daysOfStock)}` : undefined}
              small
            />
          </div>

          <ChartCard card={data} />
          <EconomicsCard card={data} />

          <div className="grid grid-2">
            <SupplyActionCard nmId={nmId} card={data} onDone={invalidateAll} />
            <ParamsActionCard nmId={nmId} card={data} onDone={invalidateAll} />
          </div>

          {data.supplies.length > 0 && (
            <Card title="Поставки по товару" pad="sm">
              <div className="stack" style={{ gap: 8 }}>
                {data.supplies.map((s) => (
                  <div key={s.id} className="row between">
                    <span className="num">
                      {s.acceptedQty} / {s.quantity} шт · к {formatDateFull(s.expectedDate)}
                    </span>
                    <StatusBadge view={supplyStatusView(s.status)} />
                  </div>
                ))}
              </div>
            </Card>
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
      title="График за 30 дней"
      actions={
        <div className="tabs">
          <button className={`tab ${mode === 'sales' ? 'active' : ''}`} onClick={() => setMode('sales')}>
            Продажи
          </button>
          <button className={`tab ${mode === 'finance' ? 'active' : ''}`} onClick={() => setMode('finance')}>
            Выручка + прибыль
          </button>
        </div>
      }
    >
      <div style={{ width: '100%', height: 240 }}>
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

function EconomicsCard({ card }: { card: ProductCard }) {
  const e = card.economics;
  return (
    <Card
      title="Экономика за 30 дней"
      actions={<StatusBadge view={dataQualityView(e.dataQuality)} dot={false} />}
    >
      {(!e.flags.hasCost || !e.flags.hasFinanceReport || !e.flags.hasAds) && (
        <div className="stack" style={{ gap: 8, marginBottom: 12 }}>
          {!e.flags.hasCost && <Banner variant="warning" title="Не заполнена себестоимость">Прибыль не может быть рассчитана корректно.</Banner>}
          {!e.flags.hasFinanceReport && <Banner variant="warning">Нет финансового отчёта WB за период — выручка оценочная.</Banner>}
          {!e.flags.hasAds && <Banner variant="info">Нет данных по рекламе.</Banner>}
        </div>
      )}
      <div className="grid grid-4">
        <Metric label="Выручка" value={<span className="num">{formatMoney(e.revenue)}</span>} small />
        <Metric
          label="Прибыль"
          value={<span className="num">{formatMoney(e.profit)}</span>}
          trend={e.profit != null ? (e.profit >= 0 ? 'up' : 'down') : undefined}
          small
        />
        <Metric label="Продано" value={<span className="num">{formatUnits(e.units)}</span>} small />
        <Metric label="Средняя цена" value={<span className="num">{formatMoney(e.avgPrice)}</span>} small />
        <Metric label="Себестоимость" value={<span className="num">{formatMoney(e.cost)}</span>} small />
        <Metric label="Расходы WB" value={<span className="num">{formatMoney(e.wbExpenses)}</span>} small />
        <Metric label="Реклама" value={<span className="num">{formatMoney(e.adSpend)}</span>} small />
        <Metric label="Налог" value={<span className="num">{formatMoney(e.tax)}</span>} small />
        <Metric label="Прибыль/шт" value={<span className="num">{formatMoney(e.profitPerUnit)}</span>} small />
        <Metric label="Маржа" value={<span className="num">{formatPercent(e.marginPercent)}</span>} small />
        <Metric label="Доля расходов" value={<span className="num">{formatPercent(e.expensesSharePercent)}</span>} small />
      </div>
    </Card>
  );
}

function SupplyActionCard({ nmId, card, onDone }: { nmId: number; card: ProductCard; onDone: () => void }) {
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
      <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
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
      <div style={{ marginTop: 12 }}>
        <Button variant="primary" block onClick={() => create.mutate()} loading={create.isPending} disabled={qty <= 0}>
          Создать поставку
        </Button>
      </div>
    </Card>
  );
}

function ParamsActionCard({ nmId, card, onDone }: { nmId: number; card: ProductCard; onDone: () => void }) {
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
      <div className="grid grid-2">
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
      <div style={{ marginTop: 12 }}>
        <Button variant="primary" block onClick={() => save.mutate()} loading={save.isPending}>
          Сохранить параметры
        </Button>
      </div>
      {card.cost == null && (
        <div style={{ marginTop: 8 }}>
          <Badge variant="warning">Себестоимость не заполнена</Badge>
        </div>
      )}
    </Card>
  );
}
