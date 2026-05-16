import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { setApiErrorToastSink, clearApiErrorToastSink } from './apiErrorHandling';

const ToastContext = createContext(null);

const ICONS = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
const COLORS = {
  success: { bg: '#f0fdf4', border: '#86efac', color: '#166534' },
  error:   { bg: '#fff5f5', border: '#fca5a5', color: '#991b1b' },
  info:    { bg: '#eff6ff', border: '#93c5fd', color: '#1e40af' },
  warning: { bg: '#fffbeb', border: '#fcd34d', color: '#92400e' },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef([]);

  const clearToasts = useCallback(() => {
    timersRef.current.forEach((tid) => clearTimeout(tid));
    timersRef.current = [];
    setToasts([]);
  }, []);

  const showToast = useCallback((message, type = 'success', duration = 3000) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    const tid = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      timersRef.current = timersRef.current.filter((x) => x !== tid);
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

  const removeToast = (id) => setToasts(prev => prev.filter(t => t.id !== id));

  return (
    <ToastContext.Provider value={{ showToast, clearToasts }}>
      {children}
      {/* Toast container */}
      <div style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 10, pointerEvents: 'none',
      }}>
        {toasts.map(t => {
          const c = COLORS[t.type] || COLORS.info;
          return (
            <div key={t.id} style={{
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
              <button onClick={() => removeToast(t.id)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: c.color, fontSize: 16, lineHeight: 1, padding: 0, opacity: 0.6,
              }}>×</button>
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
