import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { hapticError, openExternal } from '../bridge';
import { ApiError, fetchMyOrders, type ClientOrder } from '../api';

function formatSum(sum: number | null): string | null {
  if (sum === null || !Number.isFinite(sum) || sum <= 0) return null;
  return new Intl.NumberFormat('ru-RU').format(sum) + ' ₽';
}

function formatDeadline(deadline: string | null): string | null {
  if (!deadline) return null;
  const date = new Date(deadline);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(date);
}

function OrderCard({ order }: { order: ClientOrder }) {
  const sum = formatSum(order.sum);
  // Срок показываем только у аренды: у ремонта deadline — внутренний план работ,
  // клиенту он ничего не обещает.
  const deadline = order.kind === 'rental' ? formatDeadline(order.deadline) : null;

  return (
    <div className="status-card">
      <div className="status-card__header">
        <span className="status-card__order-num">{order.number}</span>
        {order.status && <span className="badge">{order.status}</span>}
      </div>
      <div className="status-card__body">
        <div className="status-card__row">
          <span className="status-card__label">Инструмент</span>
          <span className="status-card__value">{order.title}</span>
        </div>
        {deadline && (
          <div className="status-card__row">
            <span className="status-card__label">Вернуть до</span>
            <span className="status-card__value">{deadline}</span>
          </div>
        )}
        {sum && (
          <div className="status-card__row">
            <span className="status-card__label">Сумма</span>
            <span className="status-card__value status-card__value--price">{sum}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function MyOrders() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<ClientOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchMyOrders()
      .then((res) => {
        if (cancelled) return;
        // Связки нет — показывать нечего, отправляем привязываться.
        if (!res.linked) {
          navigate('/link', { replace: true });
          return;
        }
        setOrders(res.orders);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        hapticError();
        if (e instanceof ApiError && e.apiMessage === 'invalid_init_data') {
          setError('Сессия устарела. Закройте и откройте мини-приложение заново.');
        } else {
          setError('Не удалось загрузить заказы. Попробуйте позже.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (loading) {
    return (
      <div className="page-enter">
        <h1 className="page-header">Мои заказы</h1>
        <p className="orders-page__hint">Загружаем…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-enter">
        <h1 className="page-header">Мои заказы</h1>
        <div className="alert alert--error">{error}</div>
      </div>
    );
  }

  const repairs = orders?.filter((o) => o.kind === 'repair') ?? [];
  const rentals = orders?.filter((o) => o.kind === 'rental') ?? [];

  return (
    <div className="page-enter">
      <h1 className="page-header">Мои заказы</h1>

      {repairs.length === 0 && rentals.length === 0 && (
        <>
          <p className="orders-page__hint">
            На вашем номере пока нет заказов в сервисе.
          </p>
          <button
            className="btn btn--ghost"
            onClick={() => openExternal('https://instrumentburg.ru/arenda-instrumenta')}
          >
            Каталог аренды на сайте
          </button>
        </>
      )}

      {repairs.length > 0 && (
        <section className="orders-page__section">
          <h2 className="orders-page__section-title">Ремонт</h2>
          {repairs.map((order) => (
            <OrderCard key={order.number} order={order} />
          ))}
        </section>
      )}

      {rentals.length > 0 && (
        <section className="orders-page__section">
          <h2 className="orders-page__section-title">Аренда</h2>
          {rentals.map((order) => (
            <OrderCard key={order.number} order={order} />
          ))}
        </section>
      )}
    </div>
  );
}
