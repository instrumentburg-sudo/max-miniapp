import { useNavigate } from 'react-router-dom';
import { hapticTap, openExternal } from '../bridge';
import { CATALOG } from '../data/catalog';

export function Catalog() {
  const navigate = useNavigate();

  const goCategory = (id: string) => {
    hapticTap();
    navigate(`/catalog/${id}`);
  };

  return (
    <div className="page-enter">
      <h1 className="page-header">Каталог аренды</h1>

      <div className="cat-grid stagger">
        {CATALOG.map((cat) => (
          <div
            key={cat.id}
            className="cat-tile"
            onClick={() => goCategory(cat.id)}
          >
            <div className="cat-tile__icon">{cat.icon}</div>
            <div className="cat-tile__name">{cat.name}</div>
            <div className="cat-tile__price">от {cat.priceFrom} ₽/сут</div>
          </div>
        ))}
      </div>

      <div
        className="catalog-page__site-link"
        onClick={() => openExternal('https://instrumentburg.ru/arenda-instrumenta')}
      >
        Полный каталог на <span>instrumentburg.ru →</span>
      </div>
    </div>
  );
}
