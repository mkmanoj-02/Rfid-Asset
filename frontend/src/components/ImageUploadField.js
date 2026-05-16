import React, { useCallback, useEffect, useRef, useState } from 'react';
import { validateImageFile } from '../utils/imageUrl';

/**
 * Reusable image picker with drag-and-drop, preview, and validation.
 */
export default function ImageUploadField({
  label = 'Image',
  previewUrl,
  sourceLabel,
  file,
  onFileChange,
  onClear,
  disabled = false,
  hint = 'JPG, PNG or WEBP · max 5MB',
}) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [blobUrl, setBlobUrl] = useState(null);

  useEffect(() => {
    if (!file) {
      setBlobUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const applyFile = useCallback(
    (nextFile) => {
      if (!nextFile) {
        setError('');
        onFileChange(null);
        return;
      }
      const msg = validateImageFile(nextFile);
      if (msg) {
        setError(msg);
        return;
      }
      setError('');
      onFileChange(nextFile);
    },
    [onFileChange]
  );

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const f = e.dataTransfer.files?.[0];
    if (f) applyFile(f);
  };

  const displayUrl = blobUrl || previewUrl;

  return (
    <div className="image-upload-field" data-skip-enter-nav>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <label style={{ fontWeight: 600, fontSize: 13, color: '#374151' }}>{label}</label>
        {sourceLabel && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '3px 8px',
              borderRadius: 999,
              background: sourceLabel === 'Custom Image' ? '#ecfdf5' : '#eff6ff',
              color: sourceLabel === 'Custom Image' ? '#047857' : '#1d4ed8',
              border: `1px solid ${sourceLabel === 'Custom Image' ? '#a7f3d0' : '#bfdbfe'}`,
            }}
          >
            {sourceLabel}
          </span>
        )}
      </div>

      <div
        role="presentation"
        tabIndex={-1}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? '#2563eb' : '#d1d5db'}`,
          borderRadius: 12,
          padding: 16,
          background: dragOver ? '#eff6ff' : '#f9fafb',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.65 : 1,
          transition: 'border-color 0.15s, background 0.15s',
        }}
      >
        <input
          ref={inputRef}
          type="file"
          tabIndex={-1}
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          disabled={disabled}
          onChange={(e) => applyFile(e.target.files?.[0] || null)}
        />

        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div
            style={{
              width: 120,
              height: 90,
              borderRadius: 10,
              overflow: 'hidden',
              background: '#e5e7eb',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid #e2e8f0',
            }}
          >
            {displayUrl ? (
              <img
                src={displayUrl}
                alt="Preview"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <span style={{ fontSize: 28, opacity: 0.35 }}>🖼️</span>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>
              Drag & drop or click to upload
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{hint}</div>
            {file && (
              <div style={{ fontSize: 12, color: '#2563eb', marginTop: 6 }}>{file.name}</div>
            )}
          </div>
        </div>
      </div>

      {(file || previewUrl) && onClear && !disabled && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          style={{ marginTop: 10 }}
          onClick={(e) => {
            e.stopPropagation();
            if (inputRef.current) inputRef.current.value = '';
            setError('');
            onClear();
          }}
        >
          {sourceLabel === 'Custom Image' ? 'Use inherited image' : 'Remove image'}
        </button>
      )}

      {error && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 8 }}>{error}</div>}
    </div>
  );
}
