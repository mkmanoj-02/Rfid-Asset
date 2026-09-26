import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ImageIcon, Upload, Type, LayoutTemplate, PanelLeft, Monitor, Palette, Globe,
} from 'lucide-react';
import { updateSiteBranding } from '../../api';
import { useBranding } from '../../BrandingContext';
import AppBrand from '../../components/AppBrand';
import { toastApiFailure } from '../../apiErrorHandling';
import {
  resolveImageUrl,
  validateBrandingImageFile,
  BRANDING_IMAGE_EXT,
} from '../../utils/imageUrl';
import { useToast } from '../../Toast';
import { THEMES, getTheme, normalizeThemeId } from '../../themes';
import './ProfileTab.css';

const ACCEPT =
  '.jpg,.jpeg,.png,.webp,.gif,.svg,image/jpeg,image/png,image/webp,image/gif,image/svg+xml';
const FORMAT_TAGS = BRANDING_IMAGE_EXT.map((e) => e.replace('.', '').toUpperCase());

function SectionHead({ icon: Icon, title, description }) {
  return (
    <div className="profile-section-head">
      <div className="profile-section-icon">
        <Icon size={16} strokeWidth={2} />
      </div>
      <div>
        <h3 className="profile-section-title">{title}</h3>
        {description && <p className="profile-section-desc">{description}</p>}
      </div>
    </div>
  );
}

function BrandingUploadZone({
  file,
  previewUrl,
  blobUrl,
  onFileChange,
  onClear,
  inputKey,
  currentLabel = 'Current logo',
  emptyTitle = 'Upload your logo',
  thumbClassName = '',
}) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');

  const displayUrl = blobUrl || previewUrl;
  const hasImage = Boolean(displayUrl);

  const pickFile = (nextFile) => {
    if (!nextFile) return;
    const msg = validateBrandingImageFile(nextFile);
    if (msg) {
      setError(msg);
      return;
    }
    setError('');
    onFileChange(nextFile);
  };

  const onInputChange = (e) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (picked) pickFile(picked);
  };

  useEffect(() => {
    if (!file && inputRef.current) inputRef.current.value = '';
  }, [file, inputKey]);

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) pickFile(f);
  };

  return (
    <div className="profile-upload-wrap">
      <input
        key={inputKey}
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="profile-upload-input"
        onChange={onInputChange}
      />
      <div
        role="button"
        tabIndex={0}
        className={`profile-upload${hasImage ? ' profile-upload--filled' : ''}${dragOver ? ' profile-upload--active' : ''}`}
        onClick={() => !hasImage && inputRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && !hasImage && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {hasImage ? (
          <div className="profile-upload-filled">
            <div className={`profile-upload-thumb${thumbClassName ? ` ${thumbClassName}` : ''}`}>
              <img src={displayUrl} alt="" />
            </div>
            <div className="profile-upload-meta">
              <span className="profile-upload-name">{file ? file.name : currentLabel}</span>
              <span className="profile-upload-hint">Stored exactly as uploaded · max 5MB</span>
              {file && <span className="profile-upload-badge">Unsaved changes</span>}
              <div className="profile-upload-btns">
                <button
                  type="button"
                  className="profile-btn profile-btn--ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    inputRef.current?.click();
                  }}
                >
                  Replace
                </button>
                <button
                  type="button"
                  className="profile-btn profile-btn--ghost profile-btn--danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (inputRef.current) inputRef.current.value = '';
                    setError('');
                    onClear();
                  }}
                >
                  {file ? 'Cancel' : 'Remove'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="profile-upload-empty">
            <div className="profile-upload-empty-icon">
              <Upload size={20} strokeWidth={2} />
            </div>
            <div className="profile-upload-empty-text">
              <span className="profile-upload-empty-title">{emptyTitle}</span>
              <span className="profile-upload-empty-sub">Drag and drop or click to browse</span>
            </div>
            <div className="profile-format-tags">
              {FORMAT_TAGS.map((tag) => (
                <span key={tag} className="profile-format-tag">{tag}</span>
              ))}
            </div>
          </div>
        )}
      </div>
      {error && <p className="profile-upload-error">{error}</p>}
    </div>
  );
}

const LOGIN_PREVIEW_BG = `${process.env.PUBLIC_URL || ''}/srmcompressed.jpeg`;

function PreviewFrame({ label, context, variant, children, sidebarBg }) {
  const Icon = variant === 'sidebar' ? PanelLeft : Monitor;
  const stageStyle = variant === 'login'
    ? {
        backgroundImage: `linear-gradient(155deg, rgba(15, 23, 42, 0.88) 0%, rgba(30, 58, 95, 0.82) 100%), url(${LOGIN_PREVIEW_BG})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : variant === 'sidebar' && sidebarBg
      ? { background: sidebarBg }
      : undefined;

  return (
    <div className="profile-frame">
      <div className="profile-frame-chrome">
        <Icon size={12} strokeWidth={2} />
        <span>{label}</span>
        <em>{context}</em>
      </div>
      <div
        className={`profile-frame-stage profile-frame-stage--${variant}`}
        style={stageStyle}
      >
        {children}
      </div>
    </div>
  );
}

export default function ProfileTab() {
  const { branding, refreshBranding } = useBranding();
  const { showToast } = useToast();

  const [appName, setAppName] = useState('');
  const [appSubtitle, setAppSubtitle] = useState('');
  const [themeId, setThemeId] = useState('blue');
  const [logoFile, setLogoFile] = useState(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [faviconFile, setFaviconFile] = useState(null);
  const [removeFavicon, setRemoveFavicon] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [blobUrl, setBlobUrl] = useState(null);
  const [faviconBlobUrl, setFaviconBlobUrl] = useState(null);
  const [uploadFieldKey, setUploadFieldKey] = useState(0);
  const [faviconFieldKey, setFaviconFieldKey] = useState(0);

  useEffect(() => {
    setAppName(branding.app_name || '');
    setAppSubtitle(branding.app_subtitle || '');
    setThemeId(normalizeThemeId(branding.theme));
    setLogoFile(null);
    setRemoveLogo(false);
    setFaviconFile(null);
    setRemoveFavicon(false);
    setError('');
  }, [branding]);

  useEffect(() => {
    if (!logoFile) {
      setBlobUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(logoFile);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  useEffect(() => {
    if (!faviconFile) {
      setFaviconBlobUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(faviconFile);
    setFaviconBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [faviconFile]);

  const savedLogoUrl = branding.logo_url && !removeLogo ? branding.logo_url : null;
  const previewLogoUrl = removeLogo ? null : savedLogoUrl;
  const storedPreviewUrl = previewLogoUrl ? resolveImageUrl(previewLogoUrl) : null;

  const savedFaviconUrl = branding.favicon_url && !removeFavicon ? branding.favicon_url : null;
  const previewFaviconUrl = removeFavicon ? null : savedFaviconUrl;
  const storedFaviconPreviewUrl = previewFaviconUrl ? resolveImageUrl(previewFaviconUrl) : null;
  const selectedTheme = getTheme(themeId);

  const dirty = useMemo(() => {
    const nameChanged = appName.trim() !== (branding.app_name || '').trim();
    const subChanged = appSubtitle.trim() !== (branding.app_subtitle || '').trim();
    const themeChanged = normalizeThemeId(themeId) !== normalizeThemeId(branding.theme);
    return (
      nameChanged
      || subChanged
      || themeChanged
      || logoFile != null
      || removeLogo
      || faviconFile != null
      || removeFavicon
    );
  }, [appName, appSubtitle, themeId, branding, logoFile, removeLogo, faviconFile, removeFavicon]);

  const resetForm = useCallback(() => {
    setAppName(branding.app_name || '');
    setAppSubtitle(branding.app_subtitle || '');
    setThemeId(normalizeThemeId(branding.theme));
    setLogoFile(null);
    setRemoveLogo(false);
    setFaviconFile(null);
    setRemoveFavicon(false);
    setError('');
    setUploadFieldKey((k) => k + 1);
    setFaviconFieldKey((k) => k + 1);
  }, [branding]);

  const save = async () => {
    const name = appName.trim();
    const subtitle = appSubtitle.trim();
    if (!name) { setError('App name is required'); return; }
    if (!subtitle) { setError('Subtitle is required'); return; }

    setSaving(true);
    setError('');
    try {
      await updateSiteBranding(
        { app_name: name, app_subtitle: subtitle, theme: normalizeThemeId(themeId) },
        logoFile,
        {
          removeLogo,
          faviconFile,
          removeFavicon,
        }
      );
      await refreshBranding();
      setLogoFile(null);
      setRemoveLogo(false);
      setFaviconFile(null);
      setRemoveFavicon(false);
      setUploadFieldKey((k) => k + 1);
      setFaviconFieldKey((k) => k + 1);
      showToast('Profile saved', 'success');
    } catch (e) {
      toastApiFailure(e, 'Profile');
      setError(e.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const faviconPreviewSrc = faviconBlobUrl || storedFaviconPreviewUrl;

  return (
    <div className="profile-page">
      <div className="profile-layout">
        <article className="profile-editor">
          <div className="profile-editor-body">
            <section className="profile-block">
              <SectionHead
                icon={Type}
                title="Application name"
                description="Displayed next to your logo in the sidebar and login screen."
              />
              <div className="profile-fields">
                <div className="profile-field">
                  <label htmlFor="profile-app-name">App name</label>
                  <input
                    id="profile-app-name"
                    value={appName}
                    onChange={(e) => setAppName(e.target.value)}
                    placeholder="RFID Asset"
                    maxLength={120}
                  />
                </div>
                <div className="profile-field">
                  <label htmlFor="profile-subtitle">Subtitle</label>
                  <input
                    id="profile-subtitle"
                    value={appSubtitle}
                    onChange={(e) => setAppSubtitle(e.target.value)}
                    placeholder="Management System"
                    maxLength={120}
                  />
                </div>
              </div>
            </section>

            <section className="profile-block">
              <SectionHead
                icon={Palette}
                title="Theme"
                description="Choose the site-wide sidebar and accent colors. Applies for all users after save."
              />
              <div className="profile-theme-grid">
                {Object.values(THEMES).map((t) => {
                  const selected = themeId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={`profile-theme-card${selected ? ' profile-theme-card--selected' : ''}`}
                      onClick={() => setThemeId(t.id)}
                      aria-pressed={selected}
                    >
                      <div
                        className="profile-theme-swatch"
                        style={{ background: t.sidebarBg }}
                      >
                        <div className="profile-theme-swatch-bar" style={{ background: t.primary }} />
                      </div>
                      <div className="profile-theme-meta">
                        <span className="profile-theme-name">{t.label}</span>
                        <span className="profile-theme-desc">{t.description}</span>
                      </div>
                      <div className="profile-theme-dots">
                        {t.swatches.map((c) => (
                          <span key={c} style={{ background: c }} />
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="profile-block">
              <SectionHead
                icon={ImageIcon}
                title="Logo"
                description="Your image is saved in its original format — no conversion."
              />
              <BrandingUploadZone
                inputKey={uploadFieldKey}
                file={logoFile}
                previewUrl={storedPreviewUrl}
                blobUrl={blobUrl}
                onFileChange={(f) => {
                  setLogoFile(f);
                  setRemoveLogo(false);
                }}
                onClear={() => {
                  if (logoFile) setLogoFile(null);
                  else if (branding.logo_url) setRemoveLogo(true);
                }}
              />
            </section>

            <section className="profile-block">
              <SectionHead
                icon={Globe}
                title="Favicon"
                description="Shown in the browser tab. Square PNG or SVG works best (32×32 or larger)."
              />
              <BrandingUploadZone
                inputKey={faviconFieldKey}
                file={faviconFile}
                previewUrl={storedFaviconPreviewUrl}
                blobUrl={faviconBlobUrl}
                currentLabel="Current favicon"
                emptyTitle="Upload a favicon"
                thumbClassName="profile-upload-thumb--favicon"
                onFileChange={(f) => {
                  setFaviconFile(f);
                  setRemoveFavicon(false);
                }}
                onClear={() => {
                  if (faviconFile) setFaviconFile(null);
                  else if (branding.favicon_url) setRemoveFavicon(true);
                }}
              />
            </section>
          </div>

          {error && <div className="profile-alert" role="alert">{error}</div>}

          <footer className="profile-editor-footer">
            <button
              type="button"
              className="profile-btn profile-btn--secondary"
              onClick={resetForm}
              disabled={saving || !dirty}
            >
              Reset
            </button>
            <button
              type="button"
              className="profile-btn profile-btn--primary"
              onClick={save}
              disabled={saving || !dirty}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </footer>
        </article>

        <aside className="profile-preview-col">
          <div className="profile-preview-head">
            <LayoutTemplate size={15} strokeWidth={2} />
            <span>Live preview</span>
            <div className="profile-preview-live">Live</div>
          </div>

          <div className="profile-preview-stack">
            <PreviewFrame
              label="Sidebar"
              context="Navigation"
              variant="sidebar"
              sidebarBg={selectedTheme.sidebarBg}
            >
              <AppBrand
                appName={appName}
                appSubtitle={appSubtitle}
                logoUrl={previewLogoUrl}
                previewFileUrl={blobUrl}
                variant="sidebar"
              />
            </PreviewFrame>

            <PreviewFrame label="Login" context="Desktop" variant="login">
              <AppBrand
                appName={appName}
                appSubtitle={appSubtitle}
                logoUrl={previewLogoUrl}
                previewFileUrl={blobUrl}
                variant="login-dark"
              />
            </PreviewFrame>

            <div className="profile-frame">
              <div className="profile-frame-chrome">
                <Globe size={12} strokeWidth={2} />
                <span>Browser tab</span>
                <em>Favicon</em>
              </div>
              <div className="profile-frame-stage profile-frame-stage--favicon">
                <div className="profile-favicon-tab">
                  <div className="profile-favicon-tab-icon">
                    {faviconPreviewSrc ? (
                      <img src={faviconPreviewSrc} alt="" />
                    ) : (
                      <span className="profile-favicon-tab-placeholder" />
                    )}
                  </div>
                  <span className="profile-favicon-tab-title">
                    {(appName || 'RFID Asset').trim() || 'RFID Asset'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
