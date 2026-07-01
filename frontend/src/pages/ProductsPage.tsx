import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatDays, formatMoney, formatNum } from '../lib/format';
import { dataQualityView, healthView } from '../lib/status';
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  IconButton,
  Input,
  LoadingBlock,
  Modal,
  StatusBadge,
  Textarea,
} from '../components/ui';
import { Icon } from '../components/ui/icons';
import { useToast } from '../components/ui/toast';
import { ProductCardModal } from './ProductCardModal';

interface ProductItem {
  nmId: number;
  supplierArticle: string;
  title: string | null;
  category: string | null;
  archived: boolean;
  currentStock: number;
  inTransitQty: number;
  avgDailySales: number;
  daysOfStock: number | null;
  health: string;
  recommendedQty: number;
  revenue30: number;
  profit30: number | null;
  units30: number;
  dataQuality: string;
  hasCost: boolean;
}
interface ListResponse {
  items: ProductItem[];
  counts: Record<string, number>;
  missingCostCount: number;
}

const FILTERS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'Все' },
  { key: 'no_stock', label: 'Нет остатка' },
  { key: 'critical', label: 'Критично' },
  { key: 'order', label: 'Заказать' },
  { key: 'normal', label: 'Норма' },
  { key: 'overstock', label: 'Избыток' },
  { key: 'archive', label: 'Архив' },
];

// Clickable column headers drive sorting. `sortKey: null` = not sortable.
const COLUMNS: Array<{ sortKey: string | null; label: string; align: 'left' | 'center' }> = [
  { sortKey: 'article', label: 'Артикул', align: 'left' },
  { sortKey: 'stock', label: 'Остаток', align: 'center' },
  { sortKey: null, label: 'В пути', align: 'center' },
  { sortKey: 'perDay', label: 'Прод./день', align: 'center' },
  { sortKey: 'days', label: 'Запас', align: 'center' },
  { sortKey: 'profit', label: 'Прибыль 30д', align: 'center' },
  { sortKey: 'status', label: 'Статус', align: 'center' },
];

export function ProductsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('status');
  const [search, setSearch] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [openNm, setOpenNm] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['products', filter, sort, search],
    queryFn: () => api.get<ListResponse>(`/api/products?filter=${filter}&sort=${sort}&search=${encodeURIComponent(search)}`),
    placeholderData: keepPreviousData,
  });

  const archiveMut = useMutation({
    mutationFn: (vars: { nmIds: number[]; archived: boolean }) =>
      api.post('/api/products/bulk-archive', { nmIds: vars.nmIds, archived: vars.archived }),
    onSuccess: (_r, vars) => {
      toast('success', vars.archived ? 'Товары архивированы' : 'Товары возвращены из архива');
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const toggle = (nmId: number) => {
    const next = new Set(selected);
    next.has(nmId) ? next.delete(nmId) : next.add(nmId);
    setSelected(next);
  };

  const isArchive = filter === 'archive';
  const items = data?.items ?? [];
  const allSelected = items.length > 0 && items.every((p) => selected.has(p.nmId));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map((p) => p.nmId)));
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  return (
    <div className="stack">
      <Card pad="sm">
        <div className="row between wrap" style={{ gap: 10 }}>
          <div className="tabs">
            {FILTERS.map((f) => (
              <button key={f.key} className={`tab ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
                {f.label}
                {data && <span className="tab__count">{data.counts[f.key] ?? 0}</span>}
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Input placeholder="Поиск по артикулу" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 190 }} />
            {data && data.missingCostCount > 0 && (
              <Chip icon="tag" onClick={() => setImportOpen(true)}>
                Себест. <span className="chip__count">{data.missingCostCount}</span>
              </Chip>
            )}
          </div>
        </div>

        <div className="row between wrap" style={{ marginTop: 10 }}>
          <button className={`linkbtn ${selectMode ? 'active' : ''}`} onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}>
            <Icon name="check-square" size={15} />
            {selectMode ? 'Готово' : 'Выбрать несколько'}
          </button>
          {selectMode && selected.size > 0 && (
            <div className="row" style={{ gap: 10 }}>
              <span className="muted">Выбрано: {selected.size}</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => archiveMut.mutate({ nmIds: [...selected], archived: !isArchive })}
                loading={archiveMut.isPending}
              >
                {isArchive ? 'Вернуть из архива' : 'Архивировать'}
              </Button>
            </div>
          )}
        </div>
      </Card>

      {isLoading || !data ? (
        <Card>
          <LoadingBlock rows={6} />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState title="Товары не найдены" description="Измените фильтр или запустите синхронизацию." />
        </Card>
      ) : (
        <div className="table-wrap">
          <table className="table table--dense">
            <thead>
              <tr>
                {selectMode && (
                  <th style={{ width: 40 }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Выбрать все" />
                  </th>
                )}
                {COLUMNS.map((c) => {
                  const active = !!c.sortKey && sort === c.sortKey;
                  return (
                    <th
                      key={c.label}
                      className={`${c.sortKey ? 'sortable' : ''} ${c.align === 'center' ? 'center' : ''} ${active ? 'active' : ''}`}
                      onClick={c.sortKey ? () => setSort(c.sortKey!) : undefined}
                    >
                      <span className="th-inner">
                        {c.label}
                        {active && <Icon name="chevron-down" size={13} />}
                      </span>
                    </th>
                  );
                })}
                <th style={{ width: 48 }} />
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.nmId} className={selectMode && selected.has(p.nmId) ? 'selected' : ''}>
                  {selectMode && (
                    <td>
                      <input type="checkbox" checked={selected.has(p.nmId)} onChange={() => toggle(p.nmId)} />
                    </td>
                  )}
                  <td>
                    <span className="cell-link" onClick={() => setOpenNm(p.nmId)}>
                      {p.supplierArticle}
                    </span>
                  </td>
                  <td className="cell-cnum">{formatNum(p.currentStock)}</td>
                  <td className="cell-cnum">{p.inTransitQty > 0 ? formatNum(p.inTransitQty) : '—'}</td>
                  <td className="cell-cnum">{formatNum(p.avgDailySales, 1)}</td>
                  <td className="cell-cnum">{p.daysOfStock != null ? formatDays(p.daysOfStock) : '—'}</td>
                  <td className="cell-cnum">
                    {p.profit30 != null ? formatMoney(p.profit30) : <span className="muted-3">{dataQualityView(p.dataQuality).label}</span>}
                  </td>
                  <td className="center">
                    <StatusBadge view={healthView(p.health)} />
                  </td>
                  <td className="center">
                    <IconButton
                      icon="archive"
                      label={isArchive ? 'Вернуть из архива' : 'В архив'}
                      onClick={() => archiveMut.mutate({ nmIds: [p.nmId], archived: !isArchive })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openNm != null && <ProductCardModal nmId={openNm} onClose={() => setOpenNm(null)} />}
      {importOpen && <CostImportModal onClose={() => setImportOpen(false)} />}
    </div>
  );
}

interface ImportResult {
  recognized: number;
  updated: number;
  skippedUnknown: number;
  skippedUnchanged: number;
  errors: Array<{ line: string; reason: string }>;
}

function CostImportModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  const run = useMutation({
    mutationFn: () => api.post<ImportResult>('/api/products/cost-import', { text }),
    onSuccess: (r) => {
      setResult(r);
      toast('success', `Обновлено товаров: ${r.updated}`);
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  return (
    <Modal
      open
      title="Импорт себестоимости"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
          <Button variant="primary" onClick={() => run.mutate()} loading={run.isPending} disabled={text.trim().length === 0}>
            Импортировать
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="muted" style={{ fontSize: 13 }}>
          Вставьте таблицу «Артикул и Себестоимость». Разделители: табуляция, точка с запятой или запятая. Десятичная
          запятая поддерживается.
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'SKU-001\t450\nSKU-002\t510,5'}
        />
        {result && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Badge variant="success">Обновлено: {result.updated}</Badge>
              <Badge variant="neutral">Распознано: {result.recognized}</Badge>
              <Badge variant="neutral">Без изменений: {result.skippedUnchanged}</Badge>
              <Badge variant="warning">Нет товара: {result.skippedUnknown}</Badge>
            </div>
            {result.errors.length > 0 && (
              <Field label={`Строки с ошибками (${result.errors.length})`}>
                <div className="num" style={{ fontSize: 12, color: 'var(--danger)' }}>
                  {result.errors.slice(0, 10).map((e, i) => (
                    <div key={i}>
                      {e.line} — {e.reason}
                    </div>
                  ))}
                </div>
              </Field>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
