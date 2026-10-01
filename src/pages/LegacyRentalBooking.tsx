import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { fetchCatalog, submitRentalRequest, type CatalogItem } from '../api';
import { getUser, hapticError, hapticSuccess, hapticTap, openExternal } from '../bridge';
import { Screen } from '../components/Screen';
import { TicketRow } from '../components/Ticket';
import { IconPhone } from '../components/icons';

const money = (value: number) => new Intl.NumberFormat('ru-RU').format(value) + ' ₽';

export function RentalBooking() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const user = getUser();

  // Из каталога позиция приходит в state — тогда экран рисуется мгновенно.
  // Прямой заход по ссылке (или перезагрузка WebView) state теряет,
  // поэтому каталог подтягивается заново.
  const [item, setItem] = useState<CatalogItem | null>((location.state as CatalogItem | null) ?? null);
  const [notFound, setNotFound] = useState(false);
  const [days, setDays] = useState(1);
  const [phone, setPhone] = useState('');
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (item) return;
    let cancelled = false;

    fetchCatalog()
      .then((res) => {
        if (cancelled) return;
        const found = res.items.find((candidate) => String(candidate.id) === id);
        if (found) setItem(found);
        else setNotFound(true);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });

    return () => {
      cancelled = true;
    };
  }, [id, item]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!item || loading || phone.trim().length < 10) return;

    hapticTap();
    setLoading(true);
    setError(null);

    try {
      const res = await submitRentalRequest({
        product_id: item.id,
        product_name: item.name,
        article: item.article,
        days,
        phone: phone.trim(),
        comment: comment.trim() || undefined,
        user_name: user ? `${user.first_name}${user.last_name ? ' ' + user.last_name : ''}` : undefined,
        max_user_id: user?.id,
      });

      if (res.success) {
        setSent(true);
        hapticSuccess();
      } else {
        setError(res.message);
        hapticError();
      }
    } catch {
      setError('Не удалось отправить бронь. Позвоните: +7 (343) 226-44-43');
      hapticError();
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="done page-enter">
        <div className="done__stamp">Бронь принята</div>
        <p className="done__text">
          Менеджер подтвердит наличие и срок, назовёт сумму залога и документы для оформления.
          Обычно перезваниваем в течение рабочего дня.
        </p>
        <div className="done__actions">
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => {
              hapticTap();
              navigate('/catalog');
            }}
          >
            Вернуться в каталог
          </button>
          <a href="tel:+73432264443" className="btn btn--ghost btn--sm">
            <IconPhone size={15} className="btn__icon" />
            Позвонить нам
          </a>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <Screen eyebrow="Прокат инструмента" title="Позиция не найдена">
        <div className="link__stack">
          <div className="note note--error">
            <span className="note__head">Не получилось</span>
            Позиция снята с проката или ссылка устарела.
          </div>
          <button
            className="btn btn--primary"
            onClick={() => {
              hapticTap();
              navigate('/catalog');
            }}
          >
            Открыть каталог
          </button>
        </div>
      </Screen>
    );
  }

  if (!item) {
    return (
      <Screen eyebrow="Прокат инструмента" title="Бронь инструмента">
        <div className="pos-list">
          <div className="pos-skeleton skeleton" />
        </div>
      </Screen>
    );
  }

  const estimate = item.pricePerDay != null ? item.pricePerDay * days : null;

  return (
    <Screen eyebrow={`Прокат · ${item.category}`} title={item.name}>
      <div className="ticket">
        <div className="ticket__head">
          <span>
            <span className="ticket__kind">Артикул</span>
            <span className="ticket__num">{item.article || '—'}</span>
          </span>
          <span className={`stamp ${item.available ? 'stamp--ready' : 'stamp--action'}`}>
            {item.available ? 'в наличии' : 'занят'}
          </span>
        </div>
        {item.image && (
          <div className="ticket__shot">
            <img src={item.image} alt="" decoding="async" />
          </div>
        )}
        <div className="ticket__body">
          <TicketRow label="Категория">{item.category}</TicketRow>
          {item.pricePerDay != null && (
            <TicketRow label="Сутки аренды" price>
              {money(item.pricePerDay)}
            </TicketRow>
          )}
          {estimate != null && days > 1 && (
            <TicketRow label={`Ориентир за ${days} сут.`} price>
              {money(estimate)}
            </TicketRow>
          )}
          <div className="ticket__note">
            <span className="ticket__note-title">Что дальше</span>
            Итог, залог и документы подтверждает менеджер — при длительной аренде
            и по нескольким позициям условия считаются отдельно.
          </div>
        </div>
      </div>

      <form className="form card-gap" onSubmit={submit}>
        <div className="field">
          <span className="field__label">Срок аренды</span>
          <div className="stepper">
            <button
              type="button"
              className="stepper__btn"
              onClick={() => {
                hapticTap();
                setDays((d) => Math.max(1, d - 1));
              }}
              disabled={days <= 1}
              aria-label="Меньше на сутки"
            >
              −
            </button>
            <span className="stepper__value">
              {days}
              <i>сут.</i>
            </span>
            <button
              type="button"
              className="stepper__btn"
              onClick={() => {
                hapticTap();
                setDays((d) => Math.min(90, d + 1));
              }}
              disabled={days >= 90}
              aria-label="Больше на сутки"
            >
              +
            </button>
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="rent-phone">
            Телефон
          </label>
          <input
            id="rent-phone"
            className="field__input"
            type="tel"
            inputMode="tel"
            placeholder="+7 900 000-00-00"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="rent-comment">
            Комментарий
          </label>
          <input
            id="rent-comment"
            className="field__input"
            type="text"
            placeholder="Когда заберёте, нужна ли доставка"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>

        {error && (
          <div className="note note--error">
            <span className="note__head">Не получилось</span>
            {error}
          </div>
        )}

        <button
          type="submit"
          className={`btn btn--primary${loading ? ' btn--loading' : ''}`}
          disabled={phone.trim().length < 10 || loading}
        >
          Забронировать
        </button>

        {item.url && (
          <button type="button" className="btn btn--ghost" onClick={() => openExternal(item.url!)}>
            Характеристики на сайте
          </button>
        )}
      </form>
    </Screen>
  );
}
