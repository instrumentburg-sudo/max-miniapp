import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ContactRefused,
  hapticError,
  hapticSuccess,
  hapticTap,
  isInMax,
  requestContact,
} from '../bridge';
import { ApiError, linkMaxContact } from '../api';

/**
 * Привязка MAX-аккаунта к клиенту сервиса.
 *
 * Телефон берём только из нативного окна MAX: подпись `hash` проверяется на
 * бэкенде тем же ботовым токеном, поэтому подставить чужой номер вручную
 * нельзя. Ручной ввод здесь сознательно не предлагаем — по нему открывалась бы
 * чужая история заказов.
 */
export function LinkAccount() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLink = async () => {
    if (loading) return;

    hapticTap();
    setLoading(true);
    setError(null);

    try {
      const contact = await requestContact();
      await linkMaxContact(contact);
      hapticSuccess();
      navigate('/orders', { replace: true });
    } catch (e) {
      hapticError();
      if (e instanceof ContactRefused) {
        setError('Без номера телефона мы не найдём ваши заказы. Можно проверить статус по номеру заказа.');
      } else if (e instanceof ApiError && e.apiMessage === 'invalid_contact_hash') {
        setError('MAX прислал номер с неверной подписью. Перезапустите приложение и попробуйте снова.');
      } else if (e instanceof ApiError && e.apiMessage === 'invalid_init_data') {
        setError('Сессия устарела. Закройте и откройте мини-приложение заново.');
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError('Не удалось привязать номер. Попробуйте позже.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-enter">
      <h1 className="page-header">Мои заказы</h1>

      <p className="link-page__lead">
        Покажем ремонты и аренды, оформленные на ваш номер, и пришлём сюда, когда
        инструмент будет готов.
      </p>

      <button
        className={`btn btn--primary link-page__cta${loading ? ' btn--loading' : ''}`}
        onClick={handleLink}
        disabled={loading || !isInMax()}
      >
        {loading ? 'Привязываем…' : 'Показать мои заказы'}
      </button>

      {!isInMax() && (
        <div className="alert alert--error">Откройте приложение внутри MAX</div>
      )}

      {error && <div className="alert alert--error">{error}</div>}

      <button className="btn btn--ghost link-page__alt" onClick={() => { hapticTap(); navigate('/order'); }}>
        Проверить по номеру заказа
      </button>

      <p className="link-page__note">
        Номер телефона нужен только для поиска ваших заказов в сервисе.
      </p>
    </div>
  );
}
