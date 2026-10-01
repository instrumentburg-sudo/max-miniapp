import { useParams } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { getInitData, openExternal } from '../bridge';

export function IntakeEntry({ kind }: { kind: 'repair' | 'rent' }) {
  const sameOrigin = window.location.hostname === 'zayavka.instrumentburg.ru';
  const { id } = useParams();
  const product = id && /^[A-Za-z0-9_-]{1,40}$/.test(id) ? id : '';
  const path = kind === 'repair' ? '/repair.html' : `/rent.html${product ? `?product=${encodeURIComponent(product)}` : ''}`;
  const go = () => {
    getInitData(); // Save only in same-origin sessionStorage before navigation.
    if (sameOrigin) window.location.assign(path);
    else openExternal(`https://zayavka.instrumentburg.ru${path}`);
  };
  return <Screen eyebrow="Предзаявка" title={kind === 'repair' ? 'Запись на ремонт' : 'Аренда инструмента'}>
    <div className="link__stack">
      <p className="note">{sameOrigin
        ? 'Заявка попадёт в общую очередь ИнструментБург. Её статус будет доступен в MAX.'
        : 'Откроется сайт предзаявок. Укажите телефон в форме сайта: этот переход не передаёт ваш аккаунт MAX. Кабинет заказов остаётся доступен здесь.'}</p>
      <button className="btn btn--primary" onClick={go}>Открыть форму</button>
    </div>
  </Screen>;
}
