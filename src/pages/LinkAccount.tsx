import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ContactRefused,
  hapticError,
  hapticSuccess,
  hapticTap,
  hasInitData,
  requestContact,
} from '../bridge';
import { ApiError, linkMaxContact } from '../api';
import { Screen } from '../components/Screen';

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
    <Screen eyebrow="Личный кабинет" title="Мои заказы">
      <p className="link__lead">
        Покажем ремонты и аренды, оформленные на <b>ваш номер</b>, и пришлём сюда,
        когда инструмент будет готов.
      </p>

      <div className="link__stack">
        <button
          className={`btn btn--primary${loading ? ' btn--loading' : ''}`}
          onClick={handleLink}
          disabled={loading || !hasInitData()}
        >
          {loading ? 'Привязываем' : 'Показать мои заказы'}
        </button>

        {!hasInitData() && (
          <div className="note note--error">
            <span className="note__head">Нет подписи MAX</span>
            Откройте приложение внутри MAX — здесь мы не можем подтвердить, чей это номер.
          </div>
        )}

        {error && (
          <div className="note note--error">
            <span className="note__head">Не получилось</span>
            {error}
          </div>
        )}

        <button className="btn btn--ghost" onClick={() => { hapticTap(); navigate('/order'); }}>
          Проверить по номеру заказа
        </button>
      </div>

      <p className="link__note">
        Номер телефона нужен только для поиска ваших заказов в сервисе
      </p>
    </Screen>
  );
}
