import { useEffect, useState } from 'react';
import { fetchRentalLoyalty, type RentalLoyalty } from '../api';
import { hasInitData } from '../bridge';

function date(value: string | number) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Дата не указана' : parsed.toLocaleDateString('ru-RU');
}

/** The server owns eligibility, identity, completeness and the completed count. */
export function RentalLoyaltyCard({ refresh }: { refresh: number }) {
  const [data, setData] = useState<RentalLoyalty | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (!hasInitData()) return;
    setFailed(false);
    fetchRentalLoyalty().then(result => {
      if (!cancelled) setData(result);
    }).catch(() => {
      // Without an enabled response, keep the default-off UI hidden.
      if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; };
  }, [refresh, attempt]);
  if (!data?.enabled || !data.linked) return null;
  const count = Math.max(0, Math.floor(data.completed_rentals));
  return (
    <section className="note loyalty" aria-labelledby="loyalty-title">
      <h2 id="loyalty-title" className="section__title">Аренда без залога</h2>
      <p><strong>Завершено аренд: {count} из 3</strong></p>
      <progress max={3} value={Math.min(count, 3)} aria-label={`Завершено аренд: ${count} из 3`} style={{ width: '100%', accentColor: 'var(--accent, #E33B00)' }} />
      {data.eligible && !failed ? (
        <p>С 4-й аренды — без залога (подтвердит сотрудник).</p>
      ) : count < 3 ? (
        <p>Для аренды без залога нужно завершить ещё {3 - count} {count === 2 ? 'аренду' : 'аренды'}.</p>
      ) : <p>Порог достигнут. Право на аренду без залога проверит сотрудник.</p>}
      {data.blocking_reasons.length > 0 && <ul>{data.blocking_reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>}
      <p>Без залога — при отсутствии просрочки, долга и невозмещённого ущерба. Для техники стоимостью от 300 000 ₽ нужен залог.</p>
      {!data.history_complete && <p><strong>История неполная.</strong> Здесь только подтверждённые данные из доступной истории. Старые аренды может проверить сотрудник.</p>}
      <p>{data.checked_at ? `Сверено: ${date(data.checked_at)}` : 'Сверка ещё не выполнена.'}</p>
      {failed && <p role="status">Не удалось обновить сверку. Показаны предыдущие данные. <button className="btn btn--ghost" onClick={() => setAttempt(n => n + 1)}>Повторить сверку</button></p>}
      <details>
        <summary>История аренд по реестру ({data.history.length})</summary>
        {data.history.length === 0 ? <p>Записей об арендах в реестре пока нет.</p> : <ol>
          {data.history.map((item, index) => <li key={item.order_id} style={{ marginBlock: '12px', overflowWrap: 'anywhere' }}>
            <strong>Аренда {index + 1}</strong> · {item.completed ? 'Зачтена' : 'Не зачтена'}
            {item.closed_at && <div>{date(item.closed_at)}</div>}
            {item.rental_amount_kopecks !== undefined && <div>Стоимость аренды (без залога): {(item.rental_amount_kopecks / 100).toLocaleString('ru-RU')} ₽</div>}
            {item.reasons.map((reason, i) => <div key={i}>{reason}</div>)}
          </li>)}
        </ol>}
      </details>
    </section>
  );
}
