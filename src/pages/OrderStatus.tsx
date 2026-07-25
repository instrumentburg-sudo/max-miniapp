import { useState, type FormEvent } from 'react';
import { hapticTap, hapticSuccess, hapticError } from '../bridge';
import { ApiError, fetchOrderStatus, type OrderStatus as OrderStatusType } from '../api';
import { Screen } from '../components/Screen';
import { TicketRow } from '../components/Ticket';
import { IconPhone } from '../components/icons';

const STATUS_LABELS: Record<string, string> = {
  received: 'Принят',
  diagnosing: 'Диагностика',
  in_progress: 'В работе',
  waiting_parts: 'Ожидание запчастей',
  ready: 'Готов к выдаче',
  completed: 'Завершён',
};

export function OrderStatus() {
  const [orderNumber, setOrderNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState<OrderStatusType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!orderNumber.trim() || loading) return;

    hapticTap();
    setLoading(true);
    setError(null);
    setOrder(null);

    try {
      const result = await fetchOrderStatus(orderNumber.trim());
      setOrder(result);
      hapticSuccess();
    } catch (e) {
      // Раньше любая ошибка показывалась как «Заказ не найден», и клиент шёл
      // сверять правильный номер, когда на деле не отвечал сервис учёта.
      if (e instanceof ApiError && e.status !== 404) {
        setError(
          e.apiMessage ??
            'Не смогли проверить статус — сервис временно недоступен. Попробуйте через минуту или позвоните: +7 (343) 226-44-43.',
        );
      } else if (e instanceof ApiError) {
        setError('Заказ не найден. Сверьте номер в квитанции — он вида A023222.');
      } else {
        setError('Нет связи с сервисом. Проверьте интернет и попробуйте снова.');
      }
      hapticError();
    } finally {
      setLoading(false);
    }
  };

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('ru-RU').format(price) + ' ₽';

  return (
    <Screen eyebrow="Проверка по квитанции" title="Статус заказа">
      <form className="lookup" onSubmit={handleSubmit}>
        <div className="field">
          <label className="field__label" htmlFor="order-num">
            Номер заказа
          </label>
          <input
            id="order-num"
            className="field__input field__input--code"
            type="text"
            placeholder="A023222"
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            autoComplete="off"
            inputMode="text"
          />
        </div>

        <button
          type="submit"
          className={`btn btn--primary ${loading ? 'btn--loading' : ''}`}
          disabled={!orderNumber.trim() || loading}
        >
          Проверить
        </button>
      </form>

      {error && (
        <div className="lookup__result">
          <div className="note note--error">
            <span className="note__head">Не получилось</span>
            {error}
          </div>
        </div>
      )}

      {order && (
        <div className="lookup__result">
          <div className="ticket">
            <div className="ticket__head">
              <span>
                <span className="ticket__kind">Заказ-наряд</span>
                <span className="ticket__num">{order.order_number}</span>
              </span>
              <span className={`stamp stamp--${order.status}`}>
                {STATUS_LABELS[order.status] ?? order.status_label}
              </span>
            </div>

            <div className="ticket__body">
              <TicketRow label="Принят">{order.date_received}</TicketRow>
              <TicketRow label="Инструмент">{order.device_name}</TicketRow>
              {order.estimated_cost != null && (
                <TicketRow label="Стоимость" price>
                  {formatPrice(order.estimated_cost)}
                </TicketRow>
              )}

              {order.master_comment && (
                <div className="ticket__note">
                  <span className="ticket__note-title">Комментарий мастера</span>
                  {order.master_comment}
                </div>
              )}
            </div>

            <div className="ticket__foot">
              <a href="tel:+73432264443" className="btn btn--ghost btn--sm">
                <IconPhone size={15} className="btn__icon" />
                Позвонить в сервис
              </a>
            </div>
          </div>
        </div>
      )}

      <p className="hint">
        Номер заказа указан в квитанции, которую вы получили при сдаче инструмента.
      </p>
    </Screen>
  );
}
