import axios from 'axios';

let apiErrorSink = null;
const pendingToasts = [];

/** Same underlying error (e.g. network) within this window shows only once. */
const DEDUPE_MS = 5000;
const recentByBase = new Map();

export function formatAxiosErrorMessage(error) {
  const d = error.response?.data;
  if (typeof d === 'string') return d;
  if (d?.message != null && d.message !== '') return String(d.message);
  const st = error.response?.statusText;
  if (st) return `Request failed: ${st} (${error.response.status})`;
  if (error.code === 'ECONNABORTED') return 'Request timed out';
  if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
    return 'Network error — check your connection';
  }
  return error.message || 'Request failed';
}

function errorBase(errorLike) {
  if (typeof errorLike === 'string') return errorLike.trim();
  return formatAxiosErrorMessage(errorLike).trim();
}

function shouldShowApiToast(base) {
  if (!base) return false;
  const key = base.toLowerCase();
  const now = Date.now();
  const prev = recentByBase.get(key);
  if (prev != null && now - prev < DEDUPE_MS) return false;
  recentByBase.set(key, now);
  return true;
}

/** Reset dedupe cache (e.g. on route change so the next page can show errors again). */
export function resetApiErrorToastDedupe() {
  recentByBase.clear();
}

/** Show an API/backend failure in the global toast queue (sink set by ToastProvider). */
export function toastApiFailure(errorLike, _contextLabel) {
  const base = errorBase(errorLike);
  if (!shouldShowApiToast(base)) return;
  if (apiErrorSink) apiErrorSink(base);
  else pendingToasts.push(base);
}

/**
 * CRA dev server's overlay attaches unhandledrejection before our bundle runs and does not honor
 * preventDefault(). Bootstrap in public/index.html patches addEventListener and exposes
 * __rfidNativeAddUnhandled so only the overlay gets filtered; this path registers unfiltered listeners.
 */
function addUnhandledRejectionListener(handler, options) {
  if (
    typeof window !== 'undefined'
    && typeof window.__rfidNativeAddUnhandled === 'function'
  ) {
    window.__rfidNativeAddUnhandled(handler, options);
  } else {
    window.addEventListener('unhandledrejection', handler, options);
  }
}

/**
 * CRA dev overlay reacts to unhandled promise rejections. Register via the native bypass so Axios
 * errors surface as app toasts instead of a fullscreen webpack overlay.
 */
function isAuthClientRequest(config) {
  const url = config?.url || '';
  return (
    url.includes('/auth/login')
    || url.includes('/auth/refresh-token')
    || url.includes('/auth/logout')
  );
}

export function installUnhandledAxiosRejectionHandler() {
  if (typeof window === 'undefined') return;

  addUnhandledRejectionListener((event) => {
    const reason = event.reason;
    if (!axios.isAxiosError(reason)) return;
    event.preventDefault();
    if (isAuthClientRequest(reason.config)) return;
    toastApiFailure(reason);
  });
}

/** Called from ToastProvider when the app can display messages. */
export function setApiErrorToastSink(fn) {
  apiErrorSink = fn;
  const seen = new Set();
  while (pendingToasts.length) {
    const m = pendingToasts.shift();
    const key = m.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    fn(m);
  }
}

export function clearApiErrorToastSink() {
  apiErrorSink = null;
}
