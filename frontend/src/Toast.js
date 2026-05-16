import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { setApiErrorToastSink, clearApiErrorToastSink, resetApiErrorToastDedupe } from './apiErrorHandling';

const ToastContext = createContext(null);

const ICONS = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
const COLORS = {
  success: { bg: '#f0fdf4', border: '#86efac', color: '#166534' },
  error:   { bg: '#fff5f5', border: '#fca5a5', color: '#991b1b' },
  info:    { bg: '#eff6ff', border: '#93c5fd', color: '#1e40af' },
  warning: { bg: '#fffbeb', border: '#fcd34d', color: '#92400e' },
};

/** Same message + type within this window only shows once (clicks, parallel API failures). */
const TOAST_DEDUPE_MS = 5000;

function toastKey(message, type) {
  return `${type}:${String(message || '').trim().toLowerCase()}`;
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef([]);
  const recentRef = useRef(new Map());
  const visibleKeysRef = useRef(new Set());

  const clearToasts = useCallback(() => {
    timersRef.current.forEach((tid) => clearTimeout(tid));
    timersRef.current = [];
    recentRef.current.clear();
    visibleKeysRef.current.clear();
    resetApiErrorToastDedupe();
    setToasts([]);
  }, []);

  const showToast = useCallback((message, type = 'success', duration = 3000) => {
    const msg = String(message || '').trim();
    if (!msg) return;

    const key = toastKey(msg, type);
    const now = Date.now();

    if (visibleKeysRef.current.has(key)) return;

    const last = recentRef.current.get(key);
    if (last != null && now - last < TOAST_DEDUPE_MS) return;

    recentRef.current.set(key, now);
    visibleKeysRef.current.add(key);

    const id = Date.now() + Math.random();
    setToasts((prev) => {
      if (prev.some((t) => toastKey(t.message, t.type) === key)) return prev;
      return [...prev, { id, message: msg, type }];
    });

    const tid = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timersRef.current = timersRef.current.filter((x) => x !== tid);
      visibleKeysRef.current.delete(key);
    }, duration);
    timersRef.current.push(tid);
  }, []);

  useEffect(() => {
    const duration = 5500;
    setApiErrorToastSink((msg) => showToast(msg, 'error', duration));
    return () => {
      clearApiErrorToastSink();
      timersRef.current.forEach((tid) => clearTimeout(tid));
      timersRef.current = [];
    };
  }, [showToast]);

  const removeToast = (id) => {
    setToasts((prev) => {
      const removed = prev.find((t) => t.id === id);
      if (removed) visibleKeysRef.current.delete(toastKey(removed.message, removed.type));
      return prev.filter((t) => t.id !== id);
    });
  };

  return (
    <ToastContext.Provider value={{ showToast, clearToasts }}>
      {children}
      <div style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 10, pointerEvents: 'none',
      }}>
        {toasts.map((t) => {
          const c = COLORS[t.type] || COLORS.info;
          return (
            <ToastBubble key={t.id} t={t} c={c} removeToast={removeToast} />
          );
        })}
        <style>{`
          @keyframes toast-in {
            from { opacity: 0; transform: translateY(12px); }
            to   { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    </ToastContext.Provider>
  );
}

function ToastBubble({ t, c, removeToast }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      background: c.bg, border: `1px solid ${c.border}`, color: c.color,
      borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 500,
      boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
      minWidth: 240, maxWidth: 380,
      pointerEvents: 'all',
      animation: 'toast-in 0.2s ease',
    }}>
      <span style={{ fontSize: 16 }}>{ICONS[t.type]}</span>
      <span style={{ flex: 1 }}>{t.message}</span>
      <button type="button" onClick={() => removeToast(t.id)} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: c.color, fontSize: 16, lineHeight: 1, padding: 0, opacity: 0.6,
      }}>×</button>
    </div>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

/** Prevents double-clicks from firing the same async handler twice. */
export function useSingleFlight() {
  const lockRef = useRef(false);

  const run = useCallback(async (fn) => {
    if (lockRef.current) return;
    lockRef.current = true;
    try {
      return await fn();
    } finally {
      lockRef.current = false;
    }
  }, []);

  return run;
}
