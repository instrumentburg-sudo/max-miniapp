import { useParams, useNavigate } from 'react-router-dom';
import { hapticTap } from '../bridge';
import { CATALOG } from '../data/catalog';

export function CatalogCategory() {
  const { categoryId } = useParams<{ categoryId: string }>();
  const navigate = useNavigate();
  const category = CATALOG.find((c) => c.id === categoryId);

  if (!category) {
    return (
      <div className="page-enter">
        <h1 className="page-header">Не найдено</h1>
        <p style={{ color: 'var(--text-2)' }}>Категория не найдена</p>
        <button className="btn btn--ghost" style={{ marginTop: 24 }} onClick={() => navigate('/catalog')}>
          ← Назад к каталогу
        </button>
      </div>
    );
  }

  const handleBook = (itemName: string) => {
    hapticTap();
    const phone = '+73432264443';
    const text = `Хочу забронировать: ${itemName}`;
    window.open(`tel:${phone}`, '_self');
    // Alternatively: WebApp.shareContent(text, 'https://instrumentburg.ru');
    void text; // used for future share integration
  };

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('ru-RU').format(price);

  return (
    <div className="page-enter">
      <h1 className="page-header">
        {category.icon} {category.name}
      </h1>

      <div className="catalog-page__items stagger">
        {category.items.map((item) => (
          <div key={item.id} className="equip-card">
            {item.image ? (
              <img className="equip-card__img" src={item.image} alt={item.name} />
            ) : (
              <div
                className="equip-card__img"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 48,
                  color: 'var(--text-3)',
                }}
              >
                {category.icon}
              </div>
            )}
            <div className="equip-card__body">
              <div className="equip-card__name">{item.name}</div>
              <div className="equip-card__specs">{item.specs}</div>
            </div>
            <div className="equip-card__footer">
              <div>
                <span className="equip-card__price">{formatPrice(item.pricePerDay)}</span>
                <span className="equip-card__unit"> ₽/сут</span>
              </div>
              <button
                className="btn btn--primary btn--sm"
                style={{ width: 'auto', padding: '10px 16px' }}
                onClick={() => handleBook(item.name)}
              >
                Забронировать
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
