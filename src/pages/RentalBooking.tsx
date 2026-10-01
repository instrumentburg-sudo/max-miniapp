import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { fetchCatalog, type CatalogItem } from '../api';
import { getInitData, hapticTap, openExternal } from '../bridge';
import { Screen } from '../components/Screen';
import { TicketRow } from '../components/Ticket';

const money = (value: number) => new Intl.NumberFormat('ru-RU').format(value) + ' ₽';

/** Keep the deployed product card; submit only through the shared intake form. */
export function RentalBooking() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const initial = location.state as CatalogItem | null;
  const [item, setItem] = useState<CatalogItem | null>(initial && String(initial.id) === id ? initial : null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const sameOrigin = window.location.origin === 'https://zayavka.instrumentburg.ru';

  useEffect(() => {
    if (item && String(item.id) === id) return;
    let cancelled = false;
    setItem(null);
    setNotFound(false);
    setError(false);
    fetchCatalog().then(res => {
      if (cancelled) return;
      const found = res.items.find(candidate => String(candidate.id) === id);
      if (found) setItem(found);
      else setNotFound(true);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [id, item, attempt]);

  const book = () => {
    if (!item) return;
    hapticTap();
    // catalog-sync selects the same ocStore p.product_id as /max-api/catalog.
    // The shared form obtains availability, deposit and total from intake quote.
    const path = `/rent.html?product=${encodeURIComponent(String(item.id))}`;
    getInitData();
    if (sameOrigin) window.location.assign(path);
    else openExternal(`https://zayavka.instrumentburg.ru${path}`);
  };

  if (error || notFound) return <Screen eyebrow="Прокат инструмента" title={error ? 'Каталог недоступен' : 'Позиция не найдена'}>
    <div className="link__stack">
      <div className="note note--error"><span className="note__head">Не получилось</span>
        {error ? 'Не удалось загрузить каталог. Проверьте связь и попробуйте ещё раз.' : 'Позиция снята с проката или ссылка устарела.'}
      </div>
      <button className="btn btn--primary" onClick={() => error ? setAttempt(n => n + 1) : navigate('/catalog')}>
        {error ? 'Повторить' : 'Открыть каталог'}
      </button>
    </div>
  </Screen>;

  if (!item || String(item.id) !== id) return <Screen eyebrow="Прокат инструмента" title="Бронь инструмента">
    <div className="pos-list"><div className="pos-skeleton skeleton" /></div>
  </Screen>;

  return <Screen eyebrow={`Прокат · ${item.category}`} title={item.name}>
    <div className="ticket">
      <div className="ticket__head">
        <span><span className="ticket__kind">Артикул</span><span className="ticket__num">{item.article || '—'}</span></span>
        <span className={`stamp ${item.available ? 'stamp--ready' : 'stamp--action'}`}>{item.available ? 'в наличии' : 'занят'}</span>
      </div>
      {item.image && <div className="ticket__shot"><img src={item.image} alt="" decoding="async" /></div>}
      <div className="ticket__body">
        <TicketRow label="Категория">{item.category}</TicketRow>
        {item.pricePerDay != null && <TicketRow label="Сутки аренды" price>{money(item.pricePerDay)}</TicketRow>}
        <div className="ticket__note">
          <span className="ticket__note-title">Что дальше</span>
          Выберите даты в общей форме предзаявки. Итоговая стоимость и залог появятся после расчёта.
        </div>
      </div>
    </div>
    <div className="form card-gap">
      {!sameOrigin && <p className="note">Откроется сайт предзаявок. Укажите телефон в форме сайта: этот переход не передаёт ваш аккаунт MAX. Кабинет заказов остаётся доступен здесь.</p>}
      <button className="btn btn--primary" onClick={book}>Выбрать даты и оформить предзаявку</button>
      {item.url && <button className="btn btn--ghost" onClick={() => openExternal(item.url!)}>Характеристики на сайте</button>}
    </div>
  </Screen>;
}
