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

// Capture launch markers before React navigation can remove query/hash.
// They indicate a new MAX launch, but are never themselves an auth source.
const explicitMaxLaunch = [window.location.search, window.location.hash].some(part =>
  Array.from(new URLSearchParams(part.replace(/^[?#]/, '')).keys()).some(key =>
    /WebAppData|WebAppPlatform|initData|auth_date/i.test(key)));

/** Get initData string for server-side validation */
export function getInitData(): string {
  const live = getWebApp()?.initData ?? '';
  if (explicitMaxLaunch && !live) {
    try { sessionStorage.removeItem('ib_max_init'); } catch { /* storage disabled */ }
    return '';
  }
  // Only same-origin sessionStorage; raw authentication is never put in a URL.
  let value = live;
  try { value ||= sessionStorage.getItem('ib_max_init') || ''; } catch { /* storage disabled */ }
  const date = Number(new URLSearchParams(value).get('auth_date'));
  const now = Date.now() / 1000;
  if (!Number.isFinite(date) || !date || date > now + 60 || now - date > 3600) {
    try { sessionStorage.removeItem('ib_max_init'); } catch { /* storage disabled */ }
    return '';
  }
  try { sessionStorage.setItem('ib_max_init', value); } catch { /* live bridge still works */ }
  return value;
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
  const app = getWebApp();
  if (app?.openLink) app.openLink(url);
  else window.location.assign(url);
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

/**
 * Запущены ли мы в реальном клиенте MAX.
 *
 * `isInMax()` для этого не годится: библиотека с CDN создаёт `window.WebApp`
 * в любом браузере, а вот подписанный `initData` появляется только внутри
 * клиента — без него серверные ручки кабинета всё равно ответят отказом.
 */
export function hasInitData(): boolean {
  return getInitData().length > 0;
}
