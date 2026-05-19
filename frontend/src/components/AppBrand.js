import React from 'react';
import { resolveImageUrl } from '../utils/imageUrl';
import { DEFAULT_BRANDING } from '../BrandingContext';

const FALLBACK_ICON = '📡';

const VARIANTS = {
  sidebar: {
    logoMaxHeight: 40,
    logoMaxWidth: 160,
    iconSize: 36, iconRadius: 10, iconFontSize: 18,
    nameSize: 14, nameWeight: 800, nameColor: '#fff',
    subSize: 10.5, subColor: 'rgba(255,255,255,0.65)', gap: 10,
    iconBg: 'rgba(255,255,255,0.2)', iconBorder: '1px solid rgba(255,255,255,0.3)',
  },
  'login-dark': {
    logoMaxHeight: 48,
    logoMaxWidth: 200,
    iconSize: 40, iconRadius: 10, iconFontSize: 20,
    nameSize: 15, nameWeight: 700, nameColor: '#fff',
    subSize: 11, subColor: 'rgba(255,255,255,0.6)', gap: 12,
    iconBg: 'rgba(255,255,255,0.15)', iconBorder: '1px solid rgba(255,255,255,0.25)',
  },
  'login-light': {
    logoMaxHeight: 48,
    logoMaxWidth: 200,
    iconSize: 40, iconRadius: 10, iconFontSize: 20,
    nameSize: 15, nameWeight: 700, nameColor: '#0F172A',
    subSize: 11, subColor: '#9CA3AF', gap: 12,
    iconBg: '#F1F5F9', iconBorder: '1px solid #E2E8F0',
  },
};

function resolveLogoSrc(logoUrl, previewFileUrl) {
  if (previewFileUrl) return previewFileUrl;
  if (logoUrl) return resolveImageUrl(logoUrl);
  return null;
}

/** Shows uploaded logo at original aspect ratio — file is stored as-is (no conversion). */
export default function AppBrand({
  appName = DEFAULT_BRANDING.app_name,
  appSubtitle = DEFAULT_BRANDING.app_subtitle,
  logoUrl,
  previewFileUrl,
  variant = 'sidebar',
  className,
  style,
}) {
  const v = VARIANTS[variant] || VARIANTS.sidebar;
  const imgSrc = resolveLogoSrc(logoUrl, previewFileUrl);
  const name = (appName || DEFAULT_BRANDING.app_name).trim() || DEFAULT_BRANDING.app_name;
  const subtitle = (appSubtitle || DEFAULT_BRANDING.app_subtitle).trim() || DEFAULT_BRANDING.app_subtitle;

  return (
    <div className={className} style={{ display: 'flex', alignItems: 'center', gap: v.gap, ...style }}>
      {imgSrc ? (
        <img
          src={imgSrc}
          alt=""
          style={{
            display: 'block',
            flexShrink: 0,
            maxHeight: v.logoMaxHeight,
            maxWidth: v.logoMaxWidth,
            width: 'auto',
            height: 'auto',
            objectFit: 'contain',
          }}
        />
      ) : (
        <div
          style={{
            width: v.iconSize,
            height: v.iconSize,
            borderRadius: v.iconRadius,
            flexShrink: 0,
            background: v.iconBg,
            border: v.iconBorder,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: variant === 'sidebar' ? '0 2px 8px rgba(0,0,0,0.15)' : undefined,
            backdropFilter: variant === 'sidebar' ? 'blur(8px)' : undefined,
          }}
        >
          <span style={{ fontSize: v.iconFontSize, lineHeight: 1 }}>{FALLBACK_ICON}</span>
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: v.nameSize, fontWeight: v.nameWeight, color: v.nameColor,
          letterSpacing: '0.01em', lineHeight: 1.2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {name}
        </div>
        <div style={{
          fontSize: v.subSize, color: v.subColor, letterSpacing: '0.03em', marginTop: 1,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {subtitle}
        </div>
      </div>
    </div>
  );
}
