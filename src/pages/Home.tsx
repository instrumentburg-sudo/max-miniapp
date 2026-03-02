import { useNavigate } from 'react-router-dom';
import { getUser, hapticTap } from '../bridge';

export function Home() {
  const navigate = useNavigate();
  const user = getUser();
  const firstName = user?.first_name;

  const go = (path: string) => {
    hapticTap();
    navigate(path);
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
        <div className="card card--interactive" onClick={() => go('/order')}>
          <div className="card__icon">📦</div>
          <div className="card__title">Статус заказа</div>
          <div className="card__subtitle">Проверить готовность ремонта</div>
        </div>

        <div className="card card--interactive" onClick={() => go('/catalog')}>
          <div className="card__icon">🏗️</div>
          <div className="card__title">Каталог аренды</div>
          <div className="card__subtitle">Оборудование от 250 ₽/сут</div>
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
