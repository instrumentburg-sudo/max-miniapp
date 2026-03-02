import { useState, type FormEvent } from 'react';
import { hapticTap, hapticSuccess, hapticError } from '../bridge';
import { fetchOrderStatus, type OrderStatus as OrderStatusType } from '../api';

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
    } catch {
      setError('Заказ не найден. Проверьте номер и попробуйте снова.');
      hapticError();
    } finally {
      setLoading(false);
    }
  };

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('ru-RU').format(price) + ' ₽';

  return (
    <div className="page-enter">
      <h1 className="page-header">Статус заказа</h1>

      <form className="order-page__form" onSubmit={handleSubmit}>
        <div className="input-group">
          <label className="input-group__label" htmlFor="order-num">
            Номер заказа
          </label>
          <input
            id="order-num"
            className="input-group__field"
            type="text"
            placeholder="RM-2024-00350"
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
        <div className="order-page__result">
          <div className="alert alert--error">{error}</div>
        </div>
      )}

      {order && (
        <div className="order-page__result">
          <div className="status-card">
            <div className="status-card__header">
              <span className="status-card__order-num">#{order.order_number}</span>
              <span className={`badge badge--${order.status}`}>
                {STATUS_LABELS[order.status] ?? order.status_label}
              </span>
            </div>

            <div className="status-card__body">
              <div className="status-card__row">
                <span className="status-card__label">Принят</span>
                <span className="status-card__value">{order.date_received}</span>
              </div>

              <div className="status-card__row">
                <span className="status-card__label">Устройство</span>
                <span className="status-card__value">{order.device_name}</span>
              </div>

              {order.estimated_cost != null && (
                <div className="status-card__row">
                  <span className="status-card__label">Стоимость</span>
                  <span className="status-card__value status-card__value--price">
                    {formatPrice(order.estimated_cost)}
                  </span>
                </div>
              )}

              {order.master_comment && (
                <div className="status-card__comment">
                  💬 {order.master_comment}
                </div>
              )}
            </div>

            <div className="status-card__footer">
              <a href="tel:+73432264443" className="btn btn--ghost btn--sm">
                📞 Позвонить
              </a>
            </div>
          </div>
        </div>
      )}

      <p className="order-page__hint">
        Номер заказа указан в квитанции, которую вы получили при сдаче инструмента
      </p>
    </div>
  );
}
