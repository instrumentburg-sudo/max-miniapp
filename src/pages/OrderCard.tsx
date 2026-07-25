import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ApiError,
  NetworkError,
  createSbpPayment,
  fetchEstimate,
  fetchOrderDetail,
  submitEstimateOutcome,
  type EstimateOutcome,
  type OrderDetail,
  type PublicEstimate,
} from '../api';
import {
  hapticError,
  hapticSuccess,
  hapticTap,
  hasInitData,
  openExternal,
} from '../bridge';
import { Screen } from '../components/Screen';
import { TicketRow } from '../components/Ticket';
import { IconCheck, IconPhone } from '../components/icons';

const STAGE_FLOW = ['diagnostics', 'approval', 'repair', 'ready'] as const;

const STAGE_LABELS: Record<string, string> = {
  diagnostics: 'Диагностика',
  approval: 'Ждём решения',
  repair: 'В ремонте',
  ready: 'Готов к выдаче',
  closed: 'Выдан',
  rejected: 'Отказ от ремонта',
};

const OUTCOME_LABELS: Record<EstimateOutcome, string> = {
  approved: 'Вы согласовали ремонт',
  rejected: 'Вы отказались от ремонта',
  callback: 'Мы перезвоним вам',
};

const money = (value: number) => new Intl.NumberFormat('ru-RU').format(Math.round(value)) + ' ₽';

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

/** Шкала ремонта. У аренды стадии нет — блок не рендерится вовсе. */
function StageTrack({ stage }: { stage: string }) {
  const current = STAGE_FLOW.indexOf(stage as (typeof STAGE_FLOW)[number]);

  if (current < 0) {
    return (
      <div className={`verdict verdict--${stage === 'rejected' ? 'reject' : 'done'}`}>
        {STAGE_LABELS[stage] ?? stage}
      </div>
    );
  }

  return (
    <ol className="track">
      {STAGE_FLOW.map((step, index) => (
        <li
          key={step}
          className={`track__step${index < current ? ' track__step--past' : ''}${
            index === current ? ' track__step--now' : ''
          }`}
        >
          <span className="track__dot" />
          <span className="track__label">{STAGE_LABELS[step]}</span>
        </li>
      ))}
    </ol>
  );
}

export function OrderCard() {
  const { number = '' } = useParams();
  const navigate = useNavigate();

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [estimate, setEstimate] = useState<PublicEstimate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [upsells, setUpsells] = useState<number[]>([]);
  const [outcome, setOutcome] = useState<EstimateOutcome | null>(null);
  const [acting, setActing] = useState<EstimateOutcome | 'pay' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!hasInitData()) {
      navigate('/link', { replace: true });
      return;
    }

    setLoading(true);
    setError(null);

    fetchOrderDetail(number)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.linked) {
          navigate('/link', { replace: true });
          return;
        }
        if (!res.order) {
          setError('Заказ не найден среди ваших. Проверьте номер в квитанции.');
          return;
        }
        setOrder(res.order);
        setOutcome(null);
        // Смета живёт отдельной ручкой и есть не у всех заказов: её отсутствие
        // не должно ронять карточку — факты по заказу клиенту нужнее.
        if (res.order.estimateToken) {
          try {
            const est = await fetchEstimate(res.order.estimateToken);
            if (!cancelled) {
              setEstimate(est);
              setOutcome(est.page_outcome);
            }
          } catch {
            if (!cancelled) setEstimate(null);
          }
        } else {
          setEstimate(null);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        hapticError();
        if (e instanceof ApiError && e.status === 404) {
          setError('Заказ не найден среди ваших. Проверьте номер в квитанции.');
        } else if (e instanceof ApiError && e.apiMessage === 'invalid_init_data') {
          setError('Сессия устарела. Закройте и откройте мини-приложение заново.');
        } else if (e instanceof NetworkError) {
          setError('Нет связи с сервисом. Проверьте интернет и попробуйте ещё раз.');
        } else {
          setError('Не удалось загрузить заказ. Попробуйте ещё раз.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [number, navigate, attempt]);

  // Апселлы клиент выбирает здесь, поэтому итог и стимул пересчитываются по
  // тем же настройкам, что прислал сервер: своей математики скидок нет.
  const totals = useMemo(() => {
    if (!estimate) return null;
    const upsellTotal = upsells.reduce((sum, index) => sum + (estimate.upsell_options[index]?.price ?? 0), 0);
    const total = estimate.totals.worksTotal + estimate.totals.partsTotal + upsellTotal;
    const { stimulus_threshold, discount_percent, gift_name } = estimate.settings;
    const discounted = total >= stimulus_threshold;
    return {
      total,
      upsellTotal,
      payable: discounted ? Math.round(total * (1 - discount_percent / 100)) : total,
      discountPercent: discounted ? discount_percent : 0,
      gift: discounted ? null : gift_name,
    };
  }, [estimate, upsells]);

  const toggleUpsell = (index: number) => {
    hapticTap();
    setUpsells((prev) => (prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]));
  };

  const decide = useCallback(
    async (next: EstimateOutcome) => {
      if (!order?.estimateToken || acting) return;
      hapticTap();
      setActing(next);
      setActionError(null);
      try {
        await submitEstimateOutcome(order.estimateToken, next);
        setOutcome(next);
        hapticSuccess();
      } catch (e) {
        hapticError();
        setActionError(
          e instanceof NetworkError
            ? 'Нет связи с сервисом. Решение не сохранилось — попробуйте ещё раз.'
            : 'Не удалось сохранить решение. Попробуйте ещё раз или позвоните нам.',
        );
      } finally {
        setActing(null);
      }
    },
    [order, acting],
  );

  const pay = useCallback(async () => {
    if (!order?.estimateToken || acting) return;
    hapticTap();
    setActing('pay');
    setActionError(null);
    try {
      const payment = await createSbpPayment(order.estimateToken, upsells.length ? upsells : undefined);
      // Платёжная страница банка живёт вне WebView: открываем во внешнем
      // браузере, иначе клиент застрянет без кнопки «назад».
      openExternal(payment.sbp_link);
    } catch (e) {
      hapticError();
      setActionError(
        e instanceof ApiError && e.apiMessage
          ? e.apiMessage
          : 'Не удалось создать платёж. Попробуйте ещё раз или оплатите в сервисе.',
      );
    } finally {
      setActing(null);
    }
  }, [order, upsells, acting]);

  if (loading) {
    return (
      <Screen eyebrow="Заказ" title={number || 'Загружаем'}>
        <div className="skeleton-ticket">
          <div className="skeleton-ticket__head skeleton" />
          <div className="skeleton-ticket__line skeleton skeleton-ticket__line--mid" />
          <div className="skeleton-ticket__line skeleton skeleton-ticket__line--short" />
        </div>
      </Screen>
    );
  }

  if (error || !order) {
    return (
      <Screen eyebrow="Заказ" title={number || 'Заказ'}>
        <div className="link__stack">
          <div className="note note--error">
            <span className="note__head">Не получилось</span>
            {error ?? 'Заказ не найден.'}
          </div>
          <button className="btn btn--primary" onClick={() => { hapticTap(); setAttempt((n) => n + 1); }}>
            Повторить
          </button>
          <button className="btn btn--ghost" onClick={() => { hapticTap(); navigate('/orders'); }}>
            Ко всем заказам
          </button>
        </div>
      </Screen>
    );
  }

  const received = formatDate(order.receivedAt);
  const deadline = order.kind === 'rental' ? formatDate(order.deadline) : null;
  const showLiveskladItems = !estimate && order.items.length > 0;

  return (
    <Screen eyebrow={`${order.kind === 'rental' ? 'Аренда' : 'Заказ-наряд'} · ${order.number}`} title={order.title}>
      {order.stage && <StageTrack stage={order.stage} />}

      <div className="ticket card-gap">
        <div className="ticket__head">
          <span>
            <span className="ticket__kind">Состояние</span>
            <span className="ticket__num">{order.status ?? '—'}</span>
          </span>
        </div>
        <div className="ticket__body">
          {order.typeDevice && <TicketRow label="Тип">{order.typeDevice}</TicketRow>}
          {order.serial && <TicketRow label="Серийный номер">{order.serial}</TicketRow>}
          {received && <TicketRow label="Принят">{received}</TicketRow>}
          {deadline && <TicketRow label="Вернуть до">{deadline}</TicketRow>}
          {order.sum != null && order.sum > 0 && (
            <TicketRow label="Сумма" price>
              {money(order.sum)}
            </TicketRow>
          )}

          {order.problem.length > 0 && (
            <div className="ticket__note">
              <span className="ticket__note-title">Со слов клиента</span>
              {order.problem.join('; ')}
            </div>
          )}

          {order.masterComment && (
            <div className="ticket__note">
              <span className="ticket__note-title">Заключение мастера</span>
              {order.masterComment}
            </div>
          )}
        </div>
      </div>

      {showLiveskladItems && (
        <section className="section card-gap">
          <div className="section__head">
            <h2 className="section__title">Состав заказа</h2>
            <span className="section__line" />
          </div>
          <ul className="lines">
            {order.items.map((item, index) => (
              <li className="lines__row" key={`${item.name}-${index}`}>
                <span className="lines__name">{item.name}</span>
                <span className="lines__leader" />
                {item.count != null && item.count > 1 && <span className="lines__count">{item.count} шт</span>}
                <span className="lines__price">{item.price != null ? money(item.price) : '—'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {estimate && totals && (
        <section className="section card-gap">
          <div className="section__head">
            <h2 className="section__title">Смета</h2>
            <span className="section__line" />
          </div>

          {estimate.client_summary && <p className="estimate__summary">{estimate.client_summary}</p>}

          <ul className="lines">
            {estimate.works.map((work, index) => (
              <li className="lines__row" key={`w-${index}`}>
                <span className="lines__name">{work.name}</span>
                <span className="lines__leader" />
                <span className="lines__price">{money(work.price)}</span>
              </li>
            ))}
            {estimate.parts.map((part, index) => (
              <li className="lines__row" key={`p-${index}`}>
                <span className="lines__name">{part.name}</span>
                <span className="lines__leader" />
                <span className="lines__price">{money(part.price)}</span>
              </li>
            ))}
          </ul>

          {estimate.upsell_options.length > 0 && (
            <div className="upsell">
              <span className="upsell__title">Можно добавить</span>
              {estimate.upsell_options.map((option, index) => (
                <label className={`upsell__row${upsells.includes(index) ? ' upsell__row--on' : ''}`} key={index}>
                  <input
                    type="checkbox"
                    className="upsell__box"
                    checked={upsells.includes(index)}
                    onChange={() => toggleUpsell(index)}
                  />
                  <span className="upsell__name">{option.name}</span>
                  <span className="upsell__price">+{money(option.price)}</span>
                </label>
              ))}
            </div>
          )}

          <div className="total">
            <span className="total__label">К оплате</span>
            <span className="total__value">{money(totals.payable)}</span>
          </div>

          {totals.discountPercent > 0 ? (
            <p className="total__note">Скидка {totals.discountPercent}% за оплату онлайн уже учтена</p>
          ) : (
            totals.gift && <p className="total__note">Подарок при оплате онлайн: {totals.gift}</p>
          )}

          {estimate.conclusion && (
            <div className="ticket__note">
              <span className="ticket__note-title">Техническое заключение</span>
              {estimate.conclusion}
            </div>
          )}

          {actionError && (
            <div className="note note--error">
              <span className="note__head">Не получилось</span>
              {actionError}
            </div>
          )}

          {outcome ? (
            <div className="verdict verdict--done">{OUTCOME_LABELS[outcome]}</div>
          ) : (
            <div className="link__stack">
              <button
                className={`btn btn--primary${acting === 'approved' ? ' btn--loading' : ''}`}
                disabled={acting !== null}
                onClick={() => decide('approved')}
              >
                <IconCheck size={15} className="btn__icon" />
                Согласовать ремонт
              </button>
              <button
                className={`btn btn--ghost${acting === 'callback' ? ' btn--loading' : ''}`}
                disabled={acting !== null}
                onClick={() => decide('callback')}
              >
                Перезвоните мне
              </button>
              <button
                className={`btn btn--ghost btn--sm${acting === 'rejected' ? ' btn--loading' : ''}`}
                disabled={acting !== null}
                onClick={() => decide('rejected')}
              >
                Отказаться от ремонта
              </button>
            </div>
          )}

          {outcome !== 'rejected' && (
            <button
              className={`btn btn--primary pay${acting === 'pay' ? ' btn--loading' : ''}`}
              disabled={acting !== null}
              onClick={pay}
            >
              Оплатить {money(totals.payable)} по СБП
            </button>
          )}
        </section>
      )}

      <div className="card-gap">
        <a href="tel:+73432264443" className="btn btn--ghost btn--sm">
          <IconPhone size={15} className="btn__icon" />
          Позвонить в сервис
        </a>
      </div>
    </Screen>
  );
}
