import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useToast } from './Toast';

/** Clears visible toasts and dedupe state when the user navigates to another page. */
export default function ToastRouteSync() {
  const { pathname } = useLocation();
  const { clearToasts } = useToast();
  const isFirst = useRef(true);

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    clearToasts();
  }, [pathname, clearToasts]);

  return null;
}
