import React from 'react';
import { resolveImageUrl } from '../utils/imageUrl';
import { DEFAULT_BRANDING } from '../BrandingContext';
import './AppBrand.css';

const FALLBACK_ICON = '📡';

const VARIANT_CLASS = {
  sidebar: 'app-brand--sidebar',
  'login-dark': 'app-brand--login-dark',
  'login-light': 'app-brand--login-light',
};

function resolveLogoSrc(logoUrl, previewFileUrl) {
  if (previewFileUrl) return previewFileUrl;
  if (logoUrl) return resolveImageUrl(logoUrl);
  return null;
}

/** Logo + app name; logo is contained in a fixed slot so wide images do not break layout. */
export default function AppBrand({
  appName = DEFAULT_BRANDING.app_name,
  appSubtitle = DEFAULT_BRANDING.app_subtitle,
  logoUrl,
  previewFileUrl,
  variant = 'sidebar',
  className,
  style,
}) {
  const variantClass = VARIANT_CLASS[variant] || VARIANT_CLASS.sidebar;
  const imgSrc = resolveLogoSrc(logoUrl, previewFileUrl);
  const name = (appName || DEFAULT_BRANDING.app_name).trim() || DEFAULT_BRANDING.app_name;
  const subtitle = (appSubtitle ?? DEFAULT_BRANDING.app_subtitle).trim();

  const rootClass = ['app-brand', variantClass, className].filter(Boolean).join(' ');

  return (
    <div className={rootClass} style={style}>
      <div className="app-brand__mark" aria-hidden={imgSrc ? undefined : true}>
        {imgSrc ? (
          <img src={imgSrc} alt="" />
        ) : (
          <span className="app-brand__fallback">{FALLBACK_ICON}</span>
        )}
      </div>
      <div className="app-brand__text">
        <div className="app-brand__name" title={name}>
          {name}
        </div>
        {subtitle ? (
          <div className="app-brand__subtitle" title={subtitle}>
            {subtitle}
          </div>
        ) : null}
      </div>
    </div>
  );
}
