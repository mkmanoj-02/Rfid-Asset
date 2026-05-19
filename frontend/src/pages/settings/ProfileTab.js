import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { updateSiteBranding } from '../../api';
import { useBranding } from '../../BrandingContext';
import AppBrand from '../../components/AppBrand';
import ImageUploadField from '../../components/ImageUploadField';
import { toastApiFailure } from '../../apiErrorHandling';
import { resolveImageUrl, validateBrandingImageFile, BRANDING_IMAGE_EXT } from '../../utils/imageUrl';
import { useToast } from '../../Toast';

const SIDEBAR_BG = 'linear-gradient(160deg, #0EA5E9 0%, #1296DB 40%, #2563EB 100%)';

function PreviewCard({ title, description, children }) {
  return (
    <div
      style={{
        borderRadius: 14,
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
        background: '#fff',
        boxShadow: '0 1px 3px rgba(15,23,42,0.06)',
      }}
    >
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', background: '#fafbfc' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>{title}</div>
        {description && (
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{description}</div>
        )}
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  );
}

export default function ProfileTab() {
  const { branding, refreshBranding } = useBranding();
  const { showToast } = useToast();

  const [appName, setAppName] = useState('');
  const [appSubtitle, setAppSubtitle] = useState('');
  const [logoFile, setLogoFile] = useState(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [blobUrl, setBlobUrl] = useState(null);
  const [uploadFieldKey, setUploadFieldKey] = useState(0);

  useEffect(() => {
    setAppName(branding.app_name || '');
    setAppSubtitle(branding.app_subtitle || '');
    setLogoFile(null);
    setRemoveLogo(false);
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

  const savedLogoUrl = branding.logo_url && !removeLogo ? branding.logo_url : null;
  const previewLogoUrl = removeLogo ? null : savedLogoUrl;

  const dirty = useMemo(() => {
    const nameChanged = appName.trim() !== (branding.app_name || '').trim();
    const subChanged = appSubtitle.trim() !== (branding.app_subtitle || '').trim();
    return nameChanged || subChanged || logoFile != null || removeLogo;
  }, [appName, appSubtitle, branding, logoFile, removeLogo]);

  const resetForm = useCallback(() => {
    setAppName(branding.app_name || '');
    setAppSubtitle(branding.app_subtitle || '');
    setLogoFile(null);
    setRemoveLogo(false);
    setError('');
    setUploadFieldKey((k) => k + 1);
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
        { app_name: name, app_subtitle: subtitle },
        logoFile,
        { removeLogo }
      );
      await refreshBranding();
      setLogoFile(null);
      setRemoveLogo(false);
      showToast('Profile saved', 'success');
    } catch (e) {
      toastApiFailure(e, 'Profile');
      setError(e.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="profile-branding-layout" style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 28, alignItems: 'start' }}>
      <div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontWeight: 600, fontSize: 13, color: '#374151' }}>App name</label>
            <input
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              placeholder="e.g. RFID Asset"
              maxLength={120}
              style={{ marginTop: 6 }}
            />
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Main title next to the logo</div>
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontWeight: 600, fontSize: 13, color: '#374151' }}>Subtitle</label>
            <input
              value={appSubtitle}
              onChange={(e) => setAppSubtitle(e.target.value)}
              placeholder="e.g. Management System"
              maxLength={120}
              style={{ marginTop: 6 }}
            />
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Secondary line below the name</div>
          </div>

          <ImageUploadField
            key={uploadFieldKey}
            label="Website logo"
            hint={`Your file is saved as-is (no conversion) · ${BRANDING_IMAGE_EXT.map((e) => e.replace('.', '').toUpperCase()).join(', ')} · max 5MB`}
            exactPreview
            accept=".jpg,.jpeg,.png,.webp,.gif,.svg,image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
            validateFn={validateBrandingImageFile}
            previewUrl={removeLogo ? null : (previewLogoUrl ? resolveImageUrl(previewLogoUrl) : null)}
            file={logoFile}
            onFileChange={(f) => {
              setLogoFile(f);
              if (f) setRemoveLogo(false);
            }}
            onClear={() => {
              if (logoFile) {
                setLogoFile(null);
              } else if (branding.logo_url) {
                setRemoveLogo(true);
              }
            }}
            clearLabel={logoFile ? 'Cancel upload' : 'Remove logo'}
          />

          {error && (
            <p style={{ color: '#dc2626', fontSize: 13, margin: 0 }}>⚠ {error}</p>
          )}

          <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={save}
              disabled={saving || !dirty}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={resetForm}
              disabled={saving || !dirty}
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <div style={{ position: 'sticky', top: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#94a3b8' }}>
          Live preview
        </div>

        <PreviewCard title="Sidebar" description="Navigation header">
          <div
            style={{
              borderRadius: 12,
              padding: '14px 16px',
              background: SIDEBAR_BG,
              borderBottom: '1px solid rgba(255,255,255,0.15)',
            }}
          >
            <AppBrand
              appName={appName}
              appSubtitle={appSubtitle}
              logoUrl={previewLogoUrl}
              previewFileUrl={blobUrl}
              variant="sidebar"
            />
          </div>
        </PreviewCard>

        <PreviewCard title="Login page" description="Dark panel (desktop)">
          <div
            style={{
              borderRadius: 12,
              padding: 16,
              background: 'linear-gradient(155deg, #0f172a 0%, #1e3a5f 100%)',
            }}
          >
            <AppBrand
              appName={appName}
              appSubtitle={appSubtitle}
              logoUrl={previewLogoUrl}
              previewFileUrl={blobUrl}
              variant="login-dark"
            />
          </div>
        </PreviewCard>

      </div>

      <style>{`
        @media (max-width: 960px) {
          .profile-branding-layout {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
