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
  requestContact(): void;
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
