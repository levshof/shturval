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
  Select,
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

const SORTS: Array<{ key: string; label: string }> = [
  { key: 'status', label: 'По статусу' },
  { key: 'article', label: 'По артикулу' },
  { key: 'stock', label: 'По остатку' },
  { key: 'perDay', label: 'По продажам/день' },
  { key: 'days', label: 'По запасу' },
  { key: 'profit', label: 'По прибыли' },
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
        <div className="row between wrap">
          <div className="tabs">
            {FILTERS.map((f) => (
              <button key={f.key} className={`tab ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
                {f.label}
                {data && <span className="tab__count">{data.counts[f.key] ?? 0}</span>}
              </button>
            ))}
          </div>
          {data && data.missingCostCount > 0 && (
            <Chip icon="tag" onClick={() => setImportOpen(true)}>
              Себест. <span className="chip__count">{data.missingCostCount}</span>
            </Chip>
          )}
        </div>

        <div className="row between wrap" style={{ marginTop: 12 }}>
          <button className={`linkbtn ${selectMode ? 'active' : ''}`} onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}>
            <Icon name="check-square" size={15} />
            {selectMode ? 'Готово' : 'Выбрать несколько'}
          </button>
          <div className="row" style={{ gap: 8 }}>
            <Input placeholder="Поиск по артикулу" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 200 }} />
            <Select value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 170 }}>
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </Select>
            <Button variant="ghost" onClick={() => setImportOpen(true)}>
              Импорт себест.
            </Button>
          </div>
        </div>

        {selectMode && selected.size > 0 && (
          <div className="row between" style={{ marginTop: 12 }}>
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
          <table className="table">
            <thead>
              <tr>
                {selectMode && (
                  <th style={{ width: 40 }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Выбрать все" />
                  </th>
                )}
                <th>Артикул</th>
                <th className="right">Остаток</th>
                <th className="right">В пути</th>
                <th className="right">Прод./день</th>
                <th className="right">Запас</th>
                <th className="right">Прибыль 30д</th>
                <th>Статус</th>
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
                    {p.title && <div className="cell-sub">{p.title}</div>}
                  </td>
                  <td className="cell-num">{formatNum(p.currentStock)}</td>
                  <td className="cell-num">{p.inTransitQty > 0 ? formatNum(p.inTransitQty) : '—'}</td>
                  <td className="cell-num">{formatNum(p.avgDailySales, 1)}</td>
                  <td className="cell-num">{p.daysOfStock != null ? formatDays(p.daysOfStock) : '—'}</td>
                  <td className="cell-num">
                    {p.profit30 != null ? formatMoney(p.profit30) : <span className="muted-3">{dataQualityView(p.dataQuality).label}</span>}
                  </td>
                  <td>
                    <StatusBadge view={healthView(p.health)} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
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
