import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatDateFull } from '../lib/format';
import { supplyStatusView } from '../lib/status';
import { Button, Card, EmptyState, Field, IconButton, Input, LoadingBlock, Modal, StatusBadge } from '../components/ui';
import { Icon } from '../components/ui/icons';
import { useToast } from '../components/ui/toast';

interface Supply {
  id: string;
  nmId: number;
  supplierArticle: string;
  title: string | null;
  quantity: number;
  acceptedQty: number;
  remaining: number;
  expectedDate: string;
  status: string;
  watchAfterZero: boolean;
}

export function TransitPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['transit'], queryFn: () => api.get<{ supplies: Supply[] }>('/api/supplies') });
  const [editDate, setEditDate] = useState<Supply | null>(null);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['transit'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['products'] });
  };

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/supplies/${id}`),
    onSuccess: () => {
      toast('info', 'Поставка удалена');
      invalidate();
    },
  });
  const watch = useMutation({
    mutationFn: (id: string) => api.post(`/api/supplies/${id}/watch-after-zero`, {}),
    onSuccess: () => {
      toast('info', 'Отслеживание продолжено');
      invalidate();
    },
  });

  if (isLoading || !data) {
    return (
      <Card>
        <LoadingBlock rows={4} />
      </Card>
    );
  }

  if (data.supplies.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Icon name="truck" size={30} />}
          title="Активных поставок нет"
          description="Создайте поставку из карточки товара, когда закажете партию — она появится здесь и будет учтена в рекомендациях."
        />
      </Card>
    );
  }

  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Артикул</th>
              <th className="right">Принято / план</th>
              <th className="right">Осталось</th>
              <th>Ожидается</th>
              <th>Статус</th>
              <th style={{ width: 1 }} />
            </tr>
          </thead>
          <tbody>
            {data.supplies.map((s) => (
              <tr key={s.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{s.supplierArticle}</div>
                  {s.title && <div className="muted-3" style={{ fontSize: 12 }}>{s.title}</div>}
                </td>
                <td className="cell-num">
                  {s.acceptedQty} / {s.quantity}
                </td>
                <td className="cell-num">{s.remaining}</td>
                <td className="num">{formatDateFull(s.expectedDate)}</td>
                <td>
                  <StatusBadge view={supplyStatusView(s.status)} />
                </td>
                <td>
                  <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                    {s.status === 'ZERO_NOT_FOUND' && (
                      <Button size="sm" variant="secondary" onClick={() => watch.mutate(s.id)}>
                        Продолжить отслеживание
                      </Button>
                    )}
                    <IconButton icon="calendar" label="Изменить дату" onClick={() => setEditDate(s)} />
                    <IconButton icon="trash" label="Удалить" danger onClick={() => remove.mutate(s.id)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editDate && <EditDateModal supply={editDate} onClose={() => setEditDate(null)} onSaved={invalidate} />}
    </>
  );
}

function EditDateModal({ supply, onClose, onSaved }: { supply: Supply; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState(supply.expectedDate);
  const save = useMutation({
    mutationFn: () => api.patch(`/api/supplies/${supply.id}`, { expectedDate: date }),
    onSuccess: () => {
      toast('success', 'Дата обновлена');
      onSaved();
      onClose();
    },
  });
  return (
    <Modal
      open
      title="Ожидаемая дата прихода"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
            Сохранить
          </Button>
        </>
      }
    >
      <Field label={`Поставка ${supply.supplierArticle}`}>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
    </Modal>
  );
}
