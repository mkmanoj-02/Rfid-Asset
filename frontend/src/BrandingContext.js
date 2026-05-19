import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getSiteBranding } from './api';

export const DEFAULT_BRANDING = {
  app_name: 'RFID Asset',
  app_subtitle: 'Management System',
  logo_url: null,
};

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
      setBranding({
        app_name: data?.app_name?.trim() || DEFAULT_BRANDING.app_name,
        app_subtitle: data?.app_subtitle?.trim() || DEFAULT_BRANDING.app_subtitle,
        logo_url: data?.logo_url || null,
      });
    } catch {
      setBranding(DEFAULT_BRANDING);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
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
