import { useState, type FormEvent } from 'react';
import { getUser, hapticTap, hapticSuccess, hapticError } from '../bridge';
import { submitRepairRequest } from '../api';
import { INSTRUMENT_TYPES } from '../data/catalog';

export function RepairRequest() {
  const user = getUser();

  const [type, setType] = useState('');
  const [brand, setBrand] = useState('');
  const [problem, setProblem] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isValid = type && brand.trim() && problem.trim() && phone.trim().length >= 10;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isValid || loading) return;

    hapticTap();
    setLoading(true);
    setError(null);

    try {
      const result = await submitRepairRequest({
        instrument_type: type,
        brand_model: brand.trim(),
        problem: problem.trim(),
        phone: phone.trim(),
        user_name: user ? `${user.first_name}${user.last_name ? ' ' + user.last_name : ''}` : undefined,
        max_user_id: user?.id,
      });

      if (result.success) {
        setSuccess(result.order_number ?? '');
        hapticSuccess();
      } else {
        setError(result.message);
        hapticError();
      }
    } catch {
      setError('Не удалось отправить заявку. Попробуйте позвонить: +7 (343) 226-44-43');
      hapticError();
    } finally {
      setLoading(false);
    }
  };

  if (success !== null) {
    return (
      <div className="success-screen page-enter">
        <div className="success-screen__icon">✓</div>
        <div className="success-screen__title">Заявка отправлена!</div>
        <div className="success-screen__text">
          {success
            ? `Номер заявки: ${success}. Мы свяжемся с вами в ближайшее время.`
            : 'Мы свяжемся с вами в ближайшее время для уточнения деталей.'}
        </div>
        <a href="tel:+73432264443" className="btn btn--ghost" style={{ maxWidth: 240 }}>
          📞 Позвонить нам
        </a>
      </div>
    );
  }

  return (
    <div className="page-enter">
      <h1 className="page-header">Запись на ремонт</h1>

      <form className="repair-page__form" onSubmit={handleSubmit}>
        <div className="input-group">
          <label className="input-group__label" htmlFor="r-type">Тип инструмента</label>
          <select
            id="r-type"
            className="input-group__field"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="" disabled>Выберите тип</option>
            {INSTRUMENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div className="input-group">
          <label className="input-group__label" htmlFor="r-brand">Марка и модель</label>
          <input
            id="r-brand"
            className="input-group__field"
            type="text"
            placeholder="Makita HR2470"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="input-group">
          <label className="input-group__label" htmlFor="r-problem">Опишите проблему</label>
          <textarea
            id="r-problem"
            className="input-group__field"
            placeholder="Не включается, искрит при работе, посторонний звук..."
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
          />
        </div>

        <div className="input-group">
          <label className="input-group__label" htmlFor="r-phone">Ваш телефон</label>
          <input
            id="r-phone"
            className="input-group__field"
            type="tel"
            placeholder="+7 (___) ___-__-__"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            inputMode="tel"
          />
        </div>

        {error && <div className="alert alert--error">{error}</div>}

        <div className="repair-page__submit">
          <button
            type="submit"
            className={`btn btn--primary ${loading ? 'btn--loading' : ''}`}
            disabled={!isValid || loading}
          >
            Отправить заявку
          </button>
        </div>

        <div className="repair-page__trust">
          <div className="repair-page__trust-item">
            <span>✅</span>
            <span>Диагностика бесплатно</span>
          </div>
          <div className="repair-page__trust-item">
            <span>🛡️</span>
            <span>Гарантия на ремонт</span>
          </div>
          <div className="repair-page__trust-item">
            <span>📍</span>
            <span>ул. 40-летия Комсомола, 2а</span>
          </div>
        </div>
      </form>
    </div>
  );
}
