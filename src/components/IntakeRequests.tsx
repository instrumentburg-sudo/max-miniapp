import { useEffect, useState } from 'react';
import { ApiError, fetchIntakeRequests, type IntakeRequest } from '../api';
import { getInitData, openExternal } from '../bridge';

const STATUS_LABELS: Record<string, string> = {
  new: 'Новая', confirmed: 'Подтверждена', paid: 'Оплачена', arrived: 'Клиент прибыл',
  rental_pending: 'Оформление выдачи', converted: 'Заказ оформлен', cancelled: 'Отменена',
  expired: 'Срок истёк', manual_completed: 'Завершена', no_show: 'Неявка',
};

function safeStatusUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.origin === 'https://zayavka.instrumentburg.ru' && url.pathname === '/z.html'
      && !url.username && !url.password ? url : null;
  } catch { return null; }
}

function openStatus(value: string) {
  const url = safeStatusUrl(value);
  if (!url) return;
  if (url.origin === window.location.origin) {
    getInitData();
    window.location.assign(value);
  } else openExternal(value);
}

export function useIntakeRequests() {
  const [items, setItems] = useState<IntakeRequest[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchIntakeRequests().then(result => {
      if (!cancelled) setItems(result.requests);
    }).catch((e: unknown) => {
      if (cancelled) return;
      // Keep this optional list silent in the UI; never log signed data or URLs.
      console.warn('[MAX] Не удалось загрузить предзаявки', e instanceof ApiError ? e.status : 'network');
    });
    return () => { cancelled = true; };
  }, []);
  return items;
}

export function IntakeRequests({ items }: { items: IntakeRequest[] }) {
  if (items.length === 0) return null;
  return <section className="section" aria-label="Предзаявки">
    <div className="section__head"><h2 className="section__title">Предзаявки</h2></div>
    <div className="section__list">
      {items.map(item => <article className="ticket" key={item.number}>
        <div className="ticket__head"><span className="ticket__num">{item.number}</span><span className="stamp">{STATUS_LABELS[item.status] ?? 'Статус в карточке'}</span></div>
        <div className="ticket__body"><p>{item.title}</p><p>{item.kind === 'repair' ? 'Ремонт' : 'Аренда'}</p>
          <button className="btn btn--ghost" disabled={!safeStatusUrl(item.status_url)} onClick={() => openStatus(item.status_url)}>Открыть предзаявку</button>
        </div>
      </article>)}
    </div>
  </section>;
}
