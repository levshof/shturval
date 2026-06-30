import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { Badge, Banner, Button, Card, Field, Input, LoadingBlock, NumberInput } from '../components/ui';
import { useToast } from '../components/ui/toast';

interface SettingsResponse {
  profile: { companyName: string | null; email?: string };
  supply: {
    leadTimeDays: number;
    orderBufferDays: number;
    orderQuantum: number;
    targetStockDays: number;
    taxPercent: number;
  } | null;
  wbKey: { connected: boolean; last4?: string; isValid?: boolean; categories?: string | null };
}

export function SettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsResponse>('/api/settings') });

  if (isLoading || !data) {
    return (
      <Card>
        <LoadingBlock rows={4} />
      </Card>
    );
  }

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <ProfileCard companyName={data.profile.companyName} email={data.profile.email} onSaved={() => qc.invalidateQueries({ queryKey: ['settings'] })} />
      <WbKeyCard wbKey={data.wbKey} onChanged={() => qc.invalidateQueries({ queryKey: ['settings'] })} toast={toast} />
      <SupplyCard supply={data.supply} onSaved={() => qc.invalidateQueries({ queryKey: ['settings'] })} toast={toast} />
    </div>
  );
}

function ProfileCard({ companyName, email, onSaved }: { companyName: string | null; email?: string; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(companyName ?? '');
  const save = useMutation({
    mutationFn: () => api.put('/api/settings/profile', { companyName: name || null }),
    onSuccess: () => {
      toast('success', 'Профиль сохранён');
      onSaved();
    },
  });
  return (
    <Card title="Профиль">
      <div className="stack" style={{ maxWidth: 420 }}>
        {email && (
          <Field label="Email">
            <Input value={email} disabled />
          </Field>
        )}
        <Field label="Название компании">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ООО «Ромашка»" />
        </Field>
        <div>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
            Сохранить
          </Button>
        </div>
      </div>
    </Card>
  );
}

function WbKeyCard({
  wbKey,
  onChanged,
  toast,
}: {
  wbKey: SettingsResponse['wbKey'];
  onChanged: () => void;
  toast: (t: 'success' | 'danger' | 'warning' | 'info', m: string) => void;
}) {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  const connect = useMutation({
    mutationFn: () => api.post<{ verified: boolean }>('/api/settings/wbkey', { key }),
    onSuccess: (r) => {
      setKey('');
      setError(null);
      toast(r.verified ? 'success' : 'warning', r.verified ? 'Ключ подключён и проверен' : 'Ключ сохранён (не удалось проверить онлайн)');
      onChanged();
    },
    onError: (e: Error) => setError(e instanceof ApiError ? e.message : 'Ошибка'),
  });
  const remove = useMutation({
    mutationFn: () => api.del('/api/settings/wbkey'),
    onSuccess: () => {
      toast('info', 'Ключ удалён');
      onChanged();
    },
  });

  return (
    <Card title="API-ключ Wildberries">
      {wbKey.connected ? (
        <div className="stack" style={{ maxWidth: 480 }}>
          <div className="row between">
            <div className="row" style={{ gap: 8 }}>
              <span>Ключ подключён</span>
              <span className="num muted">{wbKey.last4}</span>
              {wbKey.isValid ? <Badge variant="success">действующий</Badge> : <Badge variant="danger">невалидный</Badge>}
            </div>
            <Button variant="danger" size="sm" onClick={() => remove.mutate()} loading={remove.isPending}>
              Удалить
            </Button>
          </div>
          <Field label="Заменить ключ" error={error ?? undefined}>
            <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Вставьте новый токен" />
          </Field>
          <div>
            <Button variant="primary" onClick={() => connect.mutate()} loading={connect.isPending} disabled={key.length < 20}>
              Заменить
            </Button>
          </div>
        </div>
      ) : (
        <div className="stack" style={{ maxWidth: 480 }}>
          <Banner variant="info" title="Ключ не подключён">
            Создайте read-only токен в кабинете WB (Настройки → Доступ к API) с категориями «Статистика», «Контент» и
            «Продвижение» и вставьте его сюда.
          </Banner>
          <Field label="API-ключ Wildberries" error={error ?? undefined}>
            <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="eyJhbGciOi..." />
          </Field>
          <div>
            <Button variant="primary" onClick={() => connect.mutate()} loading={connect.isPending} disabled={key.length < 20}>
              Подключить
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

const DEFAULTS = { leadTimeDays: 14, orderBufferDays: 7, orderQuantum: 1, targetStockDays: 45, taxPercent: 0 };

function SupplyCard({
  supply,
  onSaved,
  toast,
}: {
  supply: SettingsResponse['supply'];
  onSaved: () => void;
  toast: (t: 'success' | 'danger' | 'warning' | 'info', m: string) => void;
}) {
  const [form, setForm] = useState(supply ?? DEFAULTS);
  useEffect(() => {
    if (supply) setForm(supply);
  }, [supply]);

  const save = useMutation({
    mutationFn: () => api.put('/api/settings/supply', form),
    onSuccess: () => {
      toast('success', 'Параметры снабжения сохранены');
      onSaved();
    },
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: Number(e.target.value) });

  return (
    <Card title="Параметры снабжения по умолчанию">
      <div className="grid grid-2" style={{ maxWidth: 560 }}>
        <Field label="Срок поставки, дней">
          <NumberInput value={form.leadTimeDays} onChange={set('leadTimeDays')} />
        </Field>
        <Field label="Буфер заказа, дней">
          <NumberInput value={form.orderBufferDays} onChange={set('orderBufferDays')} />
        </Field>
        <Field label="Квант заказа, шт">
          <NumberInput value={form.orderQuantum} onChange={set('orderQuantum')} />
        </Field>
        <Field label="Целевой запас, дней">
          <NumberInput value={form.targetStockDays} onChange={set('targetStockDays')} />
        </Field>
        <Field label="Налог, %">
          <NumberInput value={form.taxPercent} onChange={set('taxPercent')} />
        </Field>
      </div>
      <div style={{ marginTop: 16 }}>
        <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
          Сохранить
        </Button>
      </div>
    </Card>
  );
}
