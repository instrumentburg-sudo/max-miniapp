import { getInitData } from './bridge';

const API_BASE = import.meta.env.DEV ? '/max-api' : '/max-api';

interface ApiOptions {
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
}

/**
 * Ошибка запроса с сохранённым статусом и текстом от API. Без неё вызывающий
 * код не мог отличить «заказа нет» (404) от «сервис учёта занят» (429/503) и
 * показывал клиенту «Заказ не найден» даже когда номер был правильный.
 */
export class ApiError extends Error {
  constructor(readonly status: number, readonly apiMessage: string | null) {
    super(apiMessage ?? `API ${status}`);
    this.name = 'ApiError';
  }
}

async function apiFetch<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body } = opts;

  const headers: Record<string, string> = {
    'X-Init-Data': getInitData(),
  };

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    let apiMessage: string | null = null;
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (typeof parsed.error === 'string') apiMessage = parsed.error;
    } catch {
      // не JSON — оставляем null, покажем свой текст
    }
    throw new ApiError(res.status, apiMessage);
  }

  return res.json() as Promise<T>;
}

/* ─── Order Status ─── */

export interface OrderStatus {
  order_number: string;
  status: 'received' | 'diagnosing' | 'in_progress' | 'waiting_parts' | 'ready' | 'completed';
  status_label: string;
  date_received: string;
  device_name: string;
  estimated_cost: number | null;
  master_comment: string | null;
}

export function fetchOrderStatus(orderNumber: string): Promise<OrderStatus> {
  return apiFetch<OrderStatus>(`/order/${encodeURIComponent(orderNumber)}`);
}

/* ─── Repair Request ─── */

export interface RepairRequest {
  instrument_type: string;
  brand_model: string;
  problem: string;
  phone: string;
  user_name?: string;
  max_user_id?: number;
}

export interface RepairResponse {
  success: boolean;
  order_number?: string;
  message: string;
}

export function submitRepairRequest(data: RepairRequest): Promise<RepairResponse> {
  return apiFetch<RepairResponse>('/repair', { method: 'POST', body: data as unknown as Record<string, unknown> });
}

/* ─── Клиентский кабинет (Convex) ─── */

// PHP-ручки статуса и заявки остаются на /max-api; кабинет живёт в Convex,
// поэтому база отдельная и настраивается через окружение сборки.
const CONVEX_BASE = import.meta.env.VITE_CONVEX_SITE_URL ?? 'https://proper-wren-188.convex.site';

/** Запрос не дошёл до сервера — сеть, а не отказ бэкенда */
export class NetworkError extends Error {
  constructor(readonly cause?: unknown) {
    super('network');
    this.name = 'NetworkError';
  }
}

// WebView MAX способен потерять запрос молча: после возврата из нативного окна
// «поделиться номером» POST уходил, но до Convex не доезжал (в логах остался
// только preflight OPTIONS), и fetch без таймаута висел вечно — экран навсегда
// застывал на «Загружаем…». Поэтому: жёсткий дедлайн + один автоматический
// повтор. Обе ручки кабинета идемпотентны (linkContact перезаписывает связку,
// listOrders только читает), повтор безопасен.
const REQUEST_TIMEOUT_MS = 15_000;

async function convexPostOnce<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${CONVEX_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: getInitData(), ...body }),
      signal: controller.signal,
      // Ответы кабинета персональные: промежуточному кешу их видеть незачем,
      // а WebView не должен отдать вчерашний список заказов.
      cache: 'no-store',
    });
  } catch (e) {
    throw new NetworkError(e);
  } finally {
    window.clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text();
    let apiMessage: string | null = null;
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (typeof parsed.error === 'string') apiMessage = parsed.error;
    } catch {
      // не JSON — оставляем null
    }
    throw new ApiError(res.status, apiMessage);
  }

  return res.json() as Promise<T>;
}

async function convexPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  try {
    return await convexPostOnce<T>(path, body);
  } catch (e) {
    // Повторяем только потерю связи. ApiError — осознанный ответ сервера
    // (401/400), его повтор ничего не изменит и лишь задержит текст ошибки.
    if (!(e instanceof NetworkError)) throw e;
    return await convexPostOnce<T>(path, body);
  }
}

export interface LinkContactResponse {
  ok: boolean;
  phone: string;
}

/** Привязывает MAX-аккаунт к клиенту по телефону из requestContact() */
export function linkMaxContact(contact: {
  phone: string;
  authDate: string;
  hash: string;
}): Promise<LinkContactResponse> {
  return convexPost<LinkContactResponse>('/api/max/link', contact);
}

export interface ClientOrder {
  number: string;
  kind: 'repair' | 'rental';
  title: string;
  status: string | null;
  deadline: string | null;
  sum: number | null;
}

export interface MyOrdersResponse {
  linked: boolean;
  orders: ClientOrder[];
}

/** Заказы привязанного клиента: ремонты и аренды одним списком */
export function fetchMyOrders(): Promise<MyOrdersResponse> {
  return convexPost<MyOrdersResponse>('/api/max/orders', {});
}

/* ─── Карточка заказа ─── */

export type ClientStage =
  | 'diagnostics'
  | 'approval'
  | 'repair'
  | 'ready'
  | 'closed'
  | 'rejected';

export interface OrderItem {
  name: string;
  price: number | null;
  count: number | null;
  isWork: boolean;
}

export interface OrderDetail {
  number: string;
  kind: 'repair' | 'rental';
  title: string;
  typeDevice: string | null;
  serial: string | null;
  status: string | null;
  stage: ClientStage | null;
  problem: string[];
  receivedAt: string | null;
  deadline: string | null;
  sum: number | null;
  masterComment: string | null;
  items: OrderItem[];
  /** Публичный токен сметы: вход в /api/order, /api/outcome, /api/pay */
  estimateToken: string | null;
}

export interface OrderDetailResponse {
  linked: boolean;
  order: OrderDetail | null;
}

/** Заказ привязанного клиента целиком. 404 — чужой или несуществующий номер. */
export function fetchOrderDetail(number: string): Promise<OrderDetailResponse> {
  return convexPost<OrderDetailResponse>('/api/max/order', { number });
}

/* ─── Смета, согласование, оплата ─── */

// Те же ручки, что у публичной страницы заказа: тексты и суммы приходят с
// сервера, мини-апп их не пересчитывает — иначе клиент увидит в MAX одну
// сумму, а по SMS-ссылке другую.

export interface EstimateLine {
  name: string;
  price: number;
}

export interface UpsellOption extends EstimateLine {
  type: string;
}

export interface PublicEstimate {
  order_number: string;
  tool_name: string;
  status: string;
  works: EstimateLine[];
  parts: EstimateLine[];
  upsell_options: UpsellOption[];
  conclusion: string | null;
  client_summary: string;
  totals: { worksTotal: number; partsTotal: number; upsellTotal: number; total: number };
  stimulus: {
    type: 'discount' | 'gift';
    discountPercent: number;
    payable: number;
    gift: string | null;
  };
  settings: { stimulus_threshold: number; discount_percent: number; gift_name: string };
  page_outcome: 'approved' | 'rejected' | 'callback' | null;
}

async function convexJson<T>(path: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${CONVEX_BASE}${path}`, { ...init, signal: controller.signal, cache: 'no-store' });
  } catch (e) {
    throw new NetworkError(e);
  } finally {
    window.clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text();
    let apiMessage: string | null = null;
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (typeof parsed.error === 'string') apiMessage = parsed.error;
    } catch {
      // не JSON — оставляем null
    }
    throw new ApiError(res.status, apiMessage);
  }

  return res.json() as Promise<T>;
}

/** Смета по публичному токену — ровно то же, что видит страница заказа */
export function fetchEstimate(token: string): Promise<PublicEstimate> {
  return convexJson<PublicEstimate>(`/api/order?token=${encodeURIComponent(token)}`, { method: 'GET' });
}

export type EstimateOutcome = 'approved' | 'rejected' | 'callback';

/** Решение клиента по смете. Ручка идемпотентна, повтор безопасен. */
export function submitEstimateOutcome(token: string, outcome: EstimateOutcome): Promise<{ ok?: boolean }> {
  return convexJson<{ ok?: boolean }>('/api/outcome', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, outcome }),
  });
}

export interface SbpPayment {
  sbp_link: string;
  amount: number;
}

/**
 * Ссылка на оплату по СБП. Единственный режим — полная сумма: частичная
 * оплата на странице заказа была убрана, и бэкенд отвечает
 * `unsupported_mode` на любой другой mode.
 */
export function createSbpPayment(token: string, selectedUpsellIndexes?: number[]): Promise<SbpPayment> {
  return convexJson<SbpPayment>('/api/pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, mode: 'full', selectedUpsellIndexes }),
  });
}
