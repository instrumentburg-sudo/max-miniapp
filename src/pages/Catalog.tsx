import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, fetchCatalog, type Catalog as CatalogData, type CatalogItem } from '../api';
import { hapticError, hapticTap } from '../bridge';
import { Screen } from '../components/Screen';
import { IconSearch } from '../components/icons';

const ALL = 0;

/**
 * Сравнение без регистра и без «ё»: клиент ищет «шурупов», а в каталоге
 * «Шуруповёрт». `localeCompare` тут не нужен — нужна подстрока.
 */
function haystack(item: CatalogItem): string {
  return `${item.name} ${item.article} ${item.category}`.toLowerCase().replace(/ё/g, 'е');
}

function CatalogCard({ item, onOpen }: { item: CatalogItem; onOpen: (item: CatalogItem) => void }) {
  return (
    <button type="button" className="pos" onClick={() => onOpen(item)}>
      <span className="pos__shot">
        {item.image ? (
          <img src={item.image} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="pos__shot-empty">{item.article || '—'}</span>
        )}
      </span>
      <span className="pos__body">
        <span className="pos__cat">{item.category}</span>
        <span className="pos__name">{item.name}</span>
        <span className="pos__foot">
          <span className="pos__price">
            {item.pricePerDay != null ? (
              <>
                {new Intl.NumberFormat('ru-RU').format(item.pricePerDay)} ₽
                <i>/сут</i>
              </>
            ) : (
              <i>цена по запросу</i>
            )}
          </span>
          <span className={`pos__mark${item.available ? '' : ' pos__mark--out'}`}>
            {item.available ? 'в наличии' : 'занят'}
          </span>
        </span>
      </span>
    </button>
  );
}

export function Catalog() {
  const navigate = useNavigate();
  const [data, setData] = useState<CatalogData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<number>(ALL);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    fetchCatalog()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        hapticError();
        // Пустой каталог — это сбой БД сайта, а не «нечего сдавать».
        setError(
          e instanceof ApiError && e.status === 503
            ? 'Каталог временно недоступен. Попробуйте через минуту.'
            : 'Не удалось загрузить каталог. Проверьте связь и попробуйте ещё раз.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const visible = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase().replace(/ё/g, 'е');

    return data.items.filter((item) => {
      if (category !== ALL && item.categoryId !== category) return false;
      if (needle === '') return true;
      return haystack(item).includes(needle);
    });
  }, [data, query, category]);

  // Поиск идёт по всему каталогу, поэтому чипы, где ничего не найдётся,
  // только вводят в заблуждение — прячем их вместе с пустой выдачей.
  const chips = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase().replace(/ё/g, 'е');
    if (needle === '') return data.categories;

    const hits = new Map<number, number>();
    for (const item of data.items) {
      if (!haystack(item).includes(needle)) continue;
      hits.set(item.categoryId, (hits.get(item.categoryId) ?? 0) + 1);
    }
    return data.categories
      .filter((c) => hits.has(c.id))
      .map((c) => ({ ...c, count: hits.get(c.id) ?? 0 }));
  }, [data, query]);

  const openItem = (item: CatalogItem) => {
    hapticTap();
    navigate(`/catalog/${item.id}`, { state: item });
  };

  const pickCategory = (id: number) => {
    hapticTap();
    setCategory((current) => (current === id ? ALL : id));
  };

  if (error) {
    return (
      <Screen eyebrow="Прокат инструмента" title="Каталог аренды">
        <div className="link__stack">
          <div className="note note--error">
            <span className="note__head">Не получилось</span>
            {error}
          </div>
          <button
            className="btn btn--primary"
            onClick={() => {
              hapticTap();
              setAttempt((n) => n + 1);
            }}
          >
            Повторить
          </button>
        </div>
      </Screen>
    );
  }

  if (!data) {
    return (
      <Screen eyebrow="Прокат инструмента" title="Каталог аренды">
        <div className="pos-list">
          <div className="pos-skeleton skeleton" />
          <div className="pos-skeleton skeleton" />
          <div className="pos-skeleton skeleton" />
        </div>
      </Screen>
    );
  }

  return (
    <Screen eyebrow="Прокат инструмента" title="Каталог аренды">
      <div className="field field--search">
        <IconSearch size={17} className="field__adorn" />
        <input
          className="field__input field__input--search"
          type="search"
          placeholder="Перфоратор, виброплита, 666К…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          enterKeyHint="search"
        />
      </div>

      <div className="chips">
        <button
          type="button"
          className={`chip${category === ALL ? ' chip--on' : ''}`}
          onClick={() => pickCategory(ALL)}
        >
          Все<i>{data.items.length}</i>
        </button>
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`chip${category === c.id ? ' chip--on' : ''}`}
            onClick={() => pickCategory(c.id)}
          >
            {c.name}
            <i>{c.count}</i>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="empty">
          <div className="empty__mark">00</div>
          <p className="empty__text">
            По запросу «{query.trim()}» в парке ничего нет. Позвоните — подскажем аналог
            или скажем, когда освободится.
          </p>
          <a className="btn btn--ghost" href="tel:+73432264443">
            +7 (343) 226-44-43
          </a>
        </div>
      ) : (
        <div className="pos-list stagger">
          {visible.map((item) => (
            <CatalogCard key={item.id} item={item} onOpen={openItem} />
          ))}
        </div>
      )}
    </Screen>
  );
}
