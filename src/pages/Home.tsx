import { useNavigate } from 'react-router-dom';
import { getUser, hapticTap, openExternal } from '../bridge';

export function Home() {
  const navigate = useNavigate();
  const user = getUser();
  const firstName = user?.first_name;

  const go = (path: string) => {
    hapticTap();
    navigate(path);
  };

  // Каталог живёт на сайте: статика в приложении расходилась с ценами и
  // наличием, а источника остатков нет ни в одном API.
  const openCatalog = () => {
    hapticTap();
    openExternal('https://instrumentburg.ru/arenda-instrumenta');
  };

  return (
    <div className="page-enter">
      <div className="home__brand">
        <span className="home__logo">ИнструментБург</span>
      </div>

      {firstName ? (
        <p className="home__greeting">
          Привет, <strong>{firstName}</strong>!
        </p>
      ) : (
        <p className="home__greeting">Добро пожаловать!</p>
      )}

      <div className="home__actions stagger">
        <div className="card card--interactive" onClick={() => go('/orders')}>
          <div className="card__icon">📦</div>
          <div className="card__title">Мои заказы</div>
          <div className="card__subtitle">Ремонты и аренды на вашем номере</div>
        </div>

        <div className="card card--interactive" onClick={() => go('/order')}>
          <div className="card__icon">🔎</div>
          <div className="card__title">Статус по номеру заказа</div>
          <div className="card__subtitle">Если заказ оформлен на другой номер</div>
        </div>

        <div className="card card--interactive" onClick={openCatalog}>
          <div className="card__icon">🏗️</div>
          <div className="card__title">Каталог аренды</div>
          <div className="card__subtitle">Актуальные цены на сайте</div>
        </div>

        <div className="card card--interactive" onClick={() => go('/repair')}>
          <div className="card__icon">🔧</div>
          <div className="card__title">Запись на ремонт</div>
          <div className="card__subtitle">Бесплатная диагностика</div>
        </div>
      </div>

      <footer className="home__footer">
        <div className="home__footer-row">
          <span>📍</span>
          <span>ул. 40-летия Комсомола, 2а</span>
        </div>
        <div className="home__footer-row">
          <span>📞</span>
          <a href="tel:+73432264443">+7 (343) 226-44-43</a>
        </div>
      </footer>
    </div>
  );
}
