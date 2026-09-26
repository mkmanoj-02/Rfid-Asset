import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getSiteBranding } from './api';
import { applyThemeToDocument, DEFAULT_THEME_ID, normalizeThemeId } from './themes';
import { resolveImageUrl } from './utils/imageUrl';

export const DEFAULT_BRANDING = {
  app_name: 'RFID Asset',
  app_subtitle: 'Management System',
  logo_url: null,
  favicon_url: null,
  theme: DEFAULT_THEME_ID,
};

const FAVICON_LINK_ATTR = 'data-rfid-favicon';

/** Apply or clear the browser tab favicon from a branding URL (or blob/data URL). */
export function applyFaviconToDocument(faviconUrl) {
  if (typeof document === 'undefined') return;

  const existing = document.querySelectorAll(`link[${FAVICON_LINK_ATTR}]`);
  existing.forEach((el) => el.remove());

  const href = faviconUrl ? resolveImageUrl(faviconUrl) : null;
  if (!href) return;

  const link = document.createElement('link');
  link.setAttribute(FAVICON_LINK_ATTR, '1');
  link.rel = 'icon';
  link.href = href;
  document.head.appendChild(link);
}

const BrandingContext = createContext({
  branding: DEFAULT_BRANDING,
  loading: true,
  refreshBranding: async () => {},
});

export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState(DEFAULT_BRANDING);
  const [loading, setLoading] = useState(true);

  const refreshBranding = useCallback(async () => {
    try {
      const { data } = await getSiteBranding();
      const next = {
        app_name: data?.app_name?.trim() || DEFAULT_BRANDING.app_name,
        app_subtitle: data?.app_subtitle?.trim() || DEFAULT_BRANDING.app_subtitle,
        logo_url: data?.logo_url || null,
        favicon_url: data?.favicon_url || null,
        theme: normalizeThemeId(data?.theme),
      };
      setBranding(next);
      applyThemeToDocument(next.theme);
      applyFaviconToDocument(next.favicon_url);
    } catch {
      setBranding(DEFAULT_BRANDING);
      applyThemeToDocument(DEFAULT_THEME_ID);
      applyFaviconToDocument(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    applyThemeToDocument(DEFAULT_THEME_ID);
    refreshBranding();
  }, [refreshBranding]);

  const value = useMemo(
    () => ({ branding, loading, refreshBranding }),
    [branding, loading, refreshBranding]
  );

  return (
    <BrandingContext.Provider value={value}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}
