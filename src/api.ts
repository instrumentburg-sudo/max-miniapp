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

async function convexPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${CONVEX_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: getInitData(), ...body }),
  });

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
