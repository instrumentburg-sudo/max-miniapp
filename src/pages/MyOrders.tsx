import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { hapticError, hapticTap, hasInitData, openExternal } from '../bridge';
import { ApiError, fetchMyOrders, NetworkError, type ClientOrder } from '../api';
import { Screen } from '../components/Screen';
import { TicketRow } from '../components/Ticket';

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

function OrderTicket({ order, onOpen }: { order: ClientOrder; onOpen: (number: string) => void }) {
  const sum = formatSum(order.sum);
  // Срок показываем только у аренды: у ремонта deadline — внутренний план работ,
  // клиенту он ничего не обещает.
  const deadline = order.kind === 'rental' ? formatDeadline(order.deadline) : null;

  return (
    <article className="ticket ticket--open" onClick={() => onOpen(order.number)}>
      <div className="ticket__head">
        <span>
          <span className="ticket__kind">{order.kind === 'rental' ? 'Аренда' : 'Заказ-наряд'}</span>
          <span className="ticket__num">{order.number}</span>
        </span>
        {order.status && <span className="stamp">{order.status}</span>}
      </div>
      <div className="ticket__body">
        <TicketRow label="Инструмент">{order.title}</TicketRow>
        {deadline && <TicketRow label="Вернуть до">{deadline}</TicketRow>}
        {sum && (
          <TicketRow label="Сумма" price>
            {sum}
          </TicketRow>
        )}
      </div>
      <div className="ticket__more">Открыть заказ</div>
    </article>
  );
}

function TicketSkeleton() {
  return (
    <div className="skeleton-ticket">
      <div className="skeleton-ticket__head skeleton" />
      <div className="skeleton-ticket__line skeleton skeleton-ticket__line--mid" />
      <div className="skeleton-ticket__line skeleton skeleton-ticket__line--short" />
    </div>
  );
}

function Section({
  title,
  orders,
  onOpen,
}: {
  title: string;
  orders: ClientOrder[];
  onOpen: (number: string) => void;
}) {
  return (
    <section className="section">
      <div className="section__head">
        <h2 className="section__title">{title}</h2>
        <span className="section__line" />
        <span className="section__count">{String(orders.length).padStart(2, '0')}</span>
      </div>
      <div className="section__list">
        {orders.map((order) => (
          <OrderTicket key={order.number} order={order} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

export function MyOrders() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<ClientOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Счётчик перезапускает эффект: WebView MAX умеет терять запрос по дороге,
  // и без ручного повтора у клиента остаётся только «закрыть и открыть заново».
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    // Вне клиента MAX подписанного initData нет, и ручка ответит bad_request.
    // Ведём на /link — там честно сказано, что нужно открыть приложение в MAX.
    if (!hasInitData()) {
      navigate('/link', { replace: true });
      return;
    }

    setLoading(true);
    setError(null);

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
        } else if (e instanceof NetworkError) {
          setError('Нет связи с сервисом. Проверьте интернет и попробуйте ещё раз.');
        } else {
          setError('Не удалось загрузить заказы. Попробуйте ещё раз.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [navigate, attempt]);

  const retry = () => {
    hapticTap();
    setAttempt((n) => n + 1);
  };

  if (loading) {
    return (
      <Screen eyebrow="Личный кабинет" title="Мои заказы">
        <div className="section__list">
          <TicketSkeleton />
          <TicketSkeleton />
        </div>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen eyebrow="Личный кабинет" title="Мои заказы">
        <div className="link__stack">
          <div className="note note--error">
            <span className="note__head">Не получилось</span>
            {error}
          </div>
          <button className="btn btn--primary" onClick={retry}>
            Повторить
          </button>
        </div>
      </Screen>
    );
  }

  const repairs = orders?.filter((o) => o.kind === 'repair') ?? [];
  const rentals = orders?.filter((o) => o.kind === 'rental') ?? [];

  const openOrder = (orderNumber: string) => {
    hapticTap();
    navigate(`/orders/${encodeURIComponent(orderNumber)}`);
  };

  return (
    <Screen eyebrow="Личный кабинет" title="Мои заказы">
      {repairs.length === 0 && rentals.length === 0 && (
        <div className="empty">
          <div className="empty__mark">00</div>
          <p className="empty__text">
            На вашем номере пока нет заказов в сервисе. Как только сдадите инструмент
            или возьмёте технику в аренду — талон появится здесь.
          </p>
          <button
            className="btn btn--ghost"
            onClick={() => openExternal('https://instrumentburg.ru/arenda-instrumenta')}
          >
            Каталог аренды на сайте
          </button>
        </div>
      )}

      {repairs.length > 0 && <Section title="Ремонт" orders={repairs} onOpen={openOrder} />}
      {rentals.length > 0 && <Section title="Аренда" orders={rentals} onOpen={openOrder} />}
    </Screen>
  );
}
