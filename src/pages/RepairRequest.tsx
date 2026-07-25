import { useState, type FormEvent } from 'react';
import { getUser, hapticTap, hapticSuccess, hapticError } from '../bridge';
import { submitRepairRequest } from '../api';
import { INSTRUMENT_TYPES } from '../data/instrumentTypes';
import { Screen } from '../components/Screen';
import { IconCheck, IconPhone, IconPin, IconShield } from '../components/icons';

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
      <div className="done page-enter">
        <div className="done__stamp">Принято</div>
        {success && <div className="done__num">№ {success}</div>}
        <p className="done__text">
          {success
            ? 'Заявка у мастера. Свяжемся с вами в ближайшее время и согласуем время приёмки.'
            : 'Заявка у мастера. Свяжемся с вами в ближайшее время для уточнения деталей.'}
        </p>
        <div className="done__actions">
          <a href="tel:+73432264443" className="btn btn--ghost btn--sm">
            <IconPhone size={15} className="btn__icon" />
            Позвонить нам
          </a>
        </div>
      </div>
    );
  }

  return (
    <Screen eyebrow="Заявка в сервис" title="Запись на ремонт">
      <form className="form" onSubmit={handleSubmit}>
        <div className="field">
          <label className="field__label" htmlFor="r-type">Тип инструмента</label>
          <select
            id="r-type"
            className="field__input"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="" disabled>Выберите тип</option>
            {INSTRUMENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="r-brand">Марка и модель</label>
          <input
            id="r-brand"
            className="field__input"
            type="text"
            placeholder="Makita HR2470"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="r-problem">Что случилось</label>
          <textarea
            id="r-problem"
            className="field__input"
            placeholder="Не включается, искрит при работе, посторонний звук…"
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="r-phone">Ваш телефон</label>
          <input
            id="r-phone"
            className="field__input"
            type="tel"
            placeholder="+7 (___) ___-__-__"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            inputMode="tel"
          />
        </div>

        {error && (
          <div className="note note--error">
            <span className="note__head">Не отправилось</span>
            {error}
          </div>
        )}

        <div className="form__submit">
          <button
            type="submit"
            className={`btn btn--primary ${loading ? 'btn--loading' : ''}`}
            disabled={!isValid || loading}
          >
            Отправить заявку
          </button>

          <div className="warranty">
            <div className="warranty__item">
              <IconCheck size={17} />
              <span>Диагностика бесплатно</span>
            </div>
            <div className="warranty__item">
              <IconShield size={17} />
              <span>Гарантия на ремонт</span>
            </div>
            <div className="warranty__item">
              <IconPin size={17} />
              <span>ул. 40-летия Комсомола, 2а</span>
            </div>
          </div>
        </div>
      </form>
    </Screen>
  );
}
