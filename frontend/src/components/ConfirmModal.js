import React from 'react';

/** Delete / confirm dialog — same pattern as Assets page */
export default function ConfirmModal({
  title,
  message,
  subMessage,
  confirmLabel = 'Delete',
  confirmStyle = 'danger',
  onConfirm,
  onCancel,
}) {
  return (
    <div className="modal-overlay" style={{ zIndex: 300 }}>
      <div
        style={{
          background: '#fff',
          borderRadius: 16,
          width: 420,
          maxWidth: '92vw',
          boxShadow: '0 24px 64px rgba(0,0,0,0.22)',
          overflow: 'hidden',
          animation: 'confirmPop 0.18s ease',
        }}
      >
        <div
          style={{
            height: 5,
            background: confirmStyle === 'danger'
              ? 'linear-gradient(90deg,#ef4444,#dc2626)'
              : 'linear-gradient(90deg,#1565c0,#1976d2)',
          }}
        />

        <div style={{ padding: '28px 28px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: confirmStyle === 'danger' ? '#fef2f2' : '#eff6ff',
                fontSize: 22,
              }}
            >
              {confirmStyle === 'danger' ? '🗑️' : '⚠️'}
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: '#111827', margin: 0 }}>{title}</h3>
          </div>

          <p style={{ fontSize: 14, color: '#374151', margin: '0 0 8px', lineHeight: 1.6 }}>{message}</p>
          {subMessage && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                background: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: 8,
                padding: '10px 12px',
                marginTop: 10,
              }}
            >
              <span style={{ fontSize: 15, flexShrink: 0 }}>⚠️</span>
              <p style={{ fontSize: 13, color: '#92400e', margin: 0, lineHeight: 1.5 }}>{subMessage}</p>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
            <button type="button" className="btn btn-secondary" onClick={onCancel} style={{ minWidth: 90 }}>
              Cancel
            </button>
            <button
              type="button"
              className={`btn btn-${confirmStyle === 'danger' ? 'danger' : 'primary'}`}
              onClick={onConfirm}
              style={{ minWidth: 90 }}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
      <style>{`@keyframes confirmPop { from { opacity:0; transform:scale(0.93) translateY(10px); } to { opacity:1; transform:scale(1) translateY(0); } }`}</style>
    </div>
  );
}
