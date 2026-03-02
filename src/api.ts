import { getInitData } from './bridge';

const API_BASE = import.meta.env.DEV ? '/max-api' : '/max-api';

interface ApiOptions {
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
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
    throw new Error(`API ${res.status}: ${text}`);
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
