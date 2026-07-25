import { useNavigate } from 'react-router-dom';
import { getUser, hapticTap, openExternal } from '../bridge';
import { IconArrow, IconBox, IconCrane, IconPhone, IconPin, IconSearch, IconWrench } from '../components/icons';

const JOBS = [
  { idx: '01', title: 'Мои заказы', sub: 'Ремонты и аренды на вашем номере', icon: IconBox, to: '/orders' },
  { idx: '02', title: 'Статус по номеру', sub: 'Если заказ оформлен на другой номер', icon: IconSearch, to: '/order' },
  { idx: '03', title: 'Каталог аренды', sub: 'Актуальные цены на сайте', icon: IconCrane, to: 'https://instrumentburg.ru/arenda-instrumenta' },
  { idx: '04', title: 'Запись на ремонт', sub: 'Бесплатная диагностика', icon: IconWrench, to: '/repair' },
] as const;

export function Home() {
  const navigate = useNavigate();
  const firstName = getUser()?.first_name;

  // Каталог живёт на сайте: статика в приложении расходилась с ценами и
  // наличием, а источника остатков нет ни в одном API.
  const go = (to: string) => {
    hapticTap();
    if (to.startsWith('http')) openExternal(to);
    else navigate(to);
  };

  return (
    <div className="page-enter">
      <header className="masthead">
        <div className="masthead__kicker">
          <b>MAX</b> · мини-приложение сервиса
        </div>
        <div className="masthead__word">
          Инструмент<span>бург</span>
        </div>
        <div className="masthead__meta">
          <i />
          Ремонт
          <i />
          Аренда
          <i />
          Екатеринбург
        </div>
      </header>

      <p className="screen__eyebrow" style={{ marginBottom: 14 }}>
        <i />
        {firstName ? `Клиент: ${firstName}` : 'Гостевой вход'}
      </p>

      <nav className="jobs stagger">
        {JOBS.map(({ idx, title, sub, icon: Icon, to }) => (
          <button key={idx} type="button" className="job" onClick={() => go(to)}>
            <span className="job__idx">
              {idx}
              <Icon size={18} style={{ display: 'block', marginTop: 6, opacity: 0.85 }} />
            </span>
            <span>
              <span className="job__title">{title}</span>
              <span className="job__sub">{sub}</span>
            </span>
            <IconArrow size={20} className="job__arrow" />
          </button>
        ))}
      </nav>

      <footer className="colophon">
        <div className="colophon__row">
          <IconPin size={18} />
          <span>ул. 40-летия Комсомола, 2а</span>
        </div>
        <div className="colophon__row">
          <IconPhone size={18} />
          <a href="tel:+73432264443">+7 (343) 226-44-43</a>
        </div>
        <div className="colophon__stamp">Пн–Пт 9:00–18:00 · Сб 10:00–15:00</div>
      </footer>
    </div>
  );
}
