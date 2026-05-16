import axios from 'axios';

let apiErrorSink = null;
const pendingToasts = [];

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
export function installUnhandledAxiosRejectionHandler() {
  if (typeof window === 'undefined') return;

  addUnhandledRejectionListener((event) => {
    const reason = event.reason;
    if (!axios.isAxiosError(reason)) return;
    event.preventDefault();
    const msg = formatAxiosErrorMessage(reason);
    if (apiErrorSink) apiErrorSink(msg);
    else pendingToasts.push(msg);
  });
}

/** Called from ToastProvider when the app can display messages. */
export function setApiErrorToastSink(fn) {
  apiErrorSink = fn;
  while (pendingToasts.length) {
    const m = pendingToasts.shift();
    fn(m);
  }
}

export function clearApiErrorToastSink() {
  apiErrorSink = null;
}
