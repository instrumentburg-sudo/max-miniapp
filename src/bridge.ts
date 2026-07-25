/**
 * MAX Bridge — typed wrapper over window.WebApp
 * https://dev.max.ru/docs/webapps/bridge
 */

interface WebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

interface WebAppData {
  query_id?: string;
  auth_date?: number;
  hash?: string;
  start_param?: string;
  user?: WebAppUser;
  chat?: {
    id: number;
    type: string;
  };
}

interface BackButton {
  isVisible: boolean;
  show(): void;
  hide(): void;
  onClick(fn: () => void): void;
  offClick(fn: () => void): void;
}

interface HapticFeedback {
  impactOccurred(style: 'soft' | 'light' | 'medium' | 'heavy' | 'rigid'): void;
  notificationOccurred(type: 'error' | 'success' | 'warning'): void;
  selectionChanged(): void;
}

/**
 * Ответ requestContact(). Клиент MAX резолвит промис либо телефоном с подписью,
 * либо объектом ошибки — реджект не гарантирован, поэтому разбираем оба поля.
 * dev.max.ru/docs/webapps/bridge, «Запрос номера телефона».
 */
interface ContactResponse {
  phone?: string;
  authDate?: string;
  hash?: string;
  error?: { code?: string };
}

interface MaxWebApp {
  initData: string;
  initDataUnsafe: WebAppData;
  platform: 'ios' | 'android' | 'desktop' | 'web';
  version: string;
  BackButton: BackButton;
  HapticFeedback: HapticFeedback;
  ready(): void;
  close(): void;
  openLink(url: string): void;
  openMaxLink(url: string): void;
  enableClosingConfirmation(): void;
  disableClosingConfirmation(): void;
  requestContact(): Promise<ContactResponse>;
  shareContent(text: string, link: string): void;
  onEvent(event: string, callback: () => void): void;
  offEvent(event: string, callback: () => void): void;
}

declare global {
  interface Window {
    WebApp?: MaxWebApp;
  }
}

/** Safe access — returns undefined outside MAX */
export function getWebApp(): MaxWebApp | undefined {
  return window.WebApp;
}

/** Get user info from initData */
export function getUser(): WebAppUser | undefined {
  return getWebApp()?.initDataUnsafe?.user;
}

/** Get initData string for server-side validation */
export function getInitData(): string {
  return getWebApp()?.initData ?? '';
}

/** Haptic tap feedback */
export function hapticTap(): void {
  getWebApp()?.HapticFeedback?.impactOccurred('light');
}

/** Haptic success feedback */
export function hapticSuccess(): void {
  getWebApp()?.HapticFeedback?.notificationOccurred('success');
}

/** Haptic error feedback */
export function hapticError(): void {
  getWebApp()?.HapticFeedback?.notificationOccurred('error');
}

/** Signal readiness to platform */
export function signalReady(): void {
  getWebApp()?.ready();
}

/** Open external link in browser */
export function openExternal(url: string): void {
  getWebApp()?.openLink(url);
}

/** Check if running inside MAX */
export function isInMax(): boolean {
  return !!window.WebApp;
}

/** Телефон из requestContact() с подписью MAX — то, что ждёт POST /api/max/link */
export interface MaxContact {
  phone: string;
  authDate: string;
  hash: string;
}

/** Отказ пользователя — не ошибка приложения, экран остаётся рабочим */
export class ContactRefused extends Error {
  constructor() {
    super('user_refused');
    this.name = 'ContactRefused';
  }
}

/**
 * Запрашивает телефон через нативное окно MAX.
 *
 * Клиент отдаёт `{ error: { code: "client.request_phone.<reason>" } }` вместо
 * данных, когда пользователь отказался (`user_refused_provide_phone_number`)
 * или запрос не прошёл (`request_error`). Промис при этом резолвится, так что
 * проверять надо поля, а не только catch.
 *
 * Таймаут обязателен: если клиент MAX не отвечает (в браузере, где библиотека
 * с CDN подгружена без транспорта, или при обрыве связи с нативной частью),
 * промис не резолвится вообще и кнопка навсегда залипает в «Привязываем…».
 */
export async function requestContact(timeoutMs = 60_000): Promise<MaxContact> {
  const webapp = getWebApp();
  if (!webapp) throw new Error('Мини-приложение открыто вне MAX');

  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error('MAX не ответил на запрос номера. Попробуйте ещё раз')), timeoutMs);
  });

  let res: ContactResponse;
  try {
    res = await Promise.race([webapp.requestContact(), timeout]);
  } finally {
    window.clearTimeout(timer);
  }

  const code = res?.error?.code ?? '';
  if (code.endsWith('user_refused_provide_phone_number')) throw new ContactRefused();
  if (code) throw new Error('MAX не смог передать номер. Попробуйте ещё раз');

  if (!res?.phone || !res.authDate || !res.hash) {
    throw new Error('MAX вернул неполные данные номера');
  }

  return { phone: res.phone, authDate: res.authDate, hash: res.hash };
}
