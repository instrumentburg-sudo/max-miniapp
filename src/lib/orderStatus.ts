/**
 * Нормализация статуса заказа в цветовой тон штампа.
 *
 * Статусы приходят из трёх источников и в трёх разных видах:
 *  - кабинет (`POST /api/max/order|orders`) отдаёт СВОБОДНЫЙ ТЕКСТ LiveSklad
 *    («Ожидание запчастей (до 15 дней)», «ОТКАЗ ОТ РЕМОНТА И ВЫДАН»);
 *  - PHP-ручка `/order/{number}` отдаёт ключи `received|diagnosing|…`;
 *  - карточка знает клиентскую стадию `diagnostics|approval|repair|ready|closed|rejected`.
 * Раньше кабинет клеил класс только на ключи, поэтому свободный текст всегда
 * садился на серый базовый `.stamp` — все заказы выглядели одинаково.
 *
 * Тон СЕМАНТИЧЕСКИЙ, а не «этап воронки»: клиенту важно не название стадии, а
 * нужно ли ему что-то делать. Поэтому «На согласовании» и «Ожидает оплаты»
 * красные (ход за клиентом), а «Ожидание запчастей» — рабочий янтарный,
 * хотя в воронке они рядом.
 */
export type StatusTone = 'intake' | 'work' | 'action' | 'ready' | 'closed' | 'rejected';

/** Ключи PHP-ручки и клиентские стадии — точное соответствие. */
const EXACT: Record<string, StatusTone> = {
  // /order/{number}
  received: 'intake',
  new: 'intake',
  diagnosing: 'work',
  in_progress: 'work',
  waiting_parts: 'work',
  ready: 'ready',
  completed: 'closed',
  // clientStage()
  diagnostics: 'work',
  approval: 'action',
  repair: 'work',
  closed: 'closed',
  rejected: 'rejected',
};

/**
 * Правила по свободному тексту LiveSklad. Порядок значим: первое совпадение
 * побеждает, поэтому отказы и выдача идут раньше рабочих статусов —
 * «ОТКАЗ ОТ РЕМОНТА И ВЫДАН» содержит и то и другое.
 */
const TEXT_RULES: Array<[RegExp, StatusTone]> = [
  [/отказ/, 'rejected'],
  [/готов/, 'ready'],
  [/выдан|выполнен|заверш|закрыт/, 'closed'],
  [/согласован|ждет ответа|ожидает оплаты|долгий ящик|просроч/, 'action'],
  [/ожидан|заказано|закупить|оплачено|возврат товара/, 'work'],
  [/диагностик|в работе|ремонт|аренд|прокат/, 'work'],
  [/нов|принят|оформлен/, 'intake'],
];

/**
 * Возвращает тон штампа. `null` — тон неизвестен, штамп остаётся нейтральным:
 * лучше серый штамп, чем зелёный «готов» на статусе, который мы не поняли.
 */
export function statusTone(status: string | null | undefined): StatusTone | null {
  if (!status) return null;

  // ё→е: один и тот же статус в LiveSklad пишут и «ждёт», и «ждет».
  const normalized = status.trim().toLowerCase().replace(/ё/g, 'е');
  if (!normalized) return null;

  const exact = EXACT[normalized];
  if (exact) return exact;

  for (const [pattern, tone] of TEXT_RULES) {
    if (pattern.test(normalized)) return tone;
  }

  return null;
}

/** Готовый className для `<span>` со штампом. */
export function stampClass(status: string | null | undefined): string {
  const tone = statusTone(status);
  return tone ? `stamp stamp--${tone}` : 'stamp';
}
