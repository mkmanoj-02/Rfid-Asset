import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginRequest } from '../api';
import { useAuth } from '../AuthContext';
import { useBranding } from '../BrandingContext';
import AppBrand from '../components/AppBrand';
import { useToast, useSingleFlight } from '../Toast';

const CSS = `
  * { box-sizing: border-box; }

  .lp-root {
    min-height: 100vh;
    display: flex;
    font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
    background: #F1F5F9;
    overflow: hidden;
  }

  /* ── Page entrance ─────────────────────────────────────────── */
  @keyframes lpFadeIn { from { opacity:0 } to { opacity:1 } }
  @keyframes lpFadeUp {
    from { opacity:0; transform:translateY(22px) }
    to   { opacity:1; transform:translateY(0) }
  }

  /* ── Slow background zoom on left image ────────────────────── */
  @keyframes lpZoom {
    0%   { transform: scale(1); }
    50%  { transform: scale(1.04); }
    100% { transform: scale(1); }
  }

  /* ── Gentle card hover float ───────────────────────────────── */
  @keyframes lpCardFloat {
    0%,100% { transform: translateY(0); }
    50%      { transform: translateY(-5px); }
  }

  /* ── Soft ambient pulse behind card ───────────────────────── */
  @keyframes lpGlowPulse {
    0%,100% { opacity: .45; transform: scale(1); }
    50%      { opacity: .65; transform: scale(1.06); }
  }

  /* ─── LEFT PANEL ────────────────────────────────────────────── */
  .lp-left {
    display: none;
    flex: 0 0 52%;
    position: relative;
    overflow: hidden;
    animation: lpFadeIn .7s ease both;
  }
  @media (min-width: 900px) { .lp-left { display: flex; flex-direction: column; } }

  /* Image with slow zoom */
  .lp-bg {
    position: absolute; inset: 0;
    background-image: url(/srmcompressed.jpeg);
    background-size: cover;
    background-position: center 25%;
    animation: lpZoom 18s ease-in-out infinite;
    will-change: transform;
  }

  /* Clean gradient overlay — not too dark */
  .lp-overlay {
    position: absolute; inset: 0;
    background: linear-gradient(
      155deg,
      rgba(8, 16, 34, 0.60) 0%,
      rgba(8, 16, 34, 0.22) 50%,
      rgba(8, 16, 34, 0.55) 100%
    );
  }

  /* Single soft ambient light — bottom-left corner only */
  .lp-ambient {
    position: absolute;
    bottom: -80px; left: -80px;
    width: 400px; height: 400px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(37,99,235,0.18) 0%, transparent 70%);
    pointer-events: none;
  }

  .lp-left-content {
    position: relative; z-index: 1;
    display: flex; flex-direction: column;
    justify-content: space-between;
    height: 100%;
    padding: 44px 50px;
  }

  .lp-logo { display: flex; align-items: center; gap: 12px; }
  .lp-logo-icon {
    width: 40px; height: 40px; border-radius: 10px;
    background: rgba(255,255,255,0.15);
    border: 1px solid rgba(255,255,255,0.25);
    display: flex; align-items: center; justify-content: center;
    font-size: 20px;
  }
  .lp-logo-name { font-size: 15px; font-weight: 700; color: #fff; letter-spacing:.01em; }
  .lp-logo-sub  { font-size: 11px; color: rgba(255,255,255,.6); letter-spacing:.04em; margin-top:1px; }

  .lp-hero-title {
    font-size: 34px; font-weight: 800; color: #fff;
    line-height: 1.22; letter-spacing: -.02em; margin: 0 0 14px;
  }
  .lp-hero-sub {
    font-size: 14.5px; color: rgba(255,255,255,.76);
    line-height: 1.68; max-width: 360px; margin: 0;
  }
  .lp-pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 22px; }
  .lp-pill {
    background: rgba(255,255,255,0.10);
    border: 1px solid rgba(255,255,255,0.18);
    color: rgba(255,255,255,.86);
    font-size: 12px; font-weight: 500;
    padding: 5px 13px; border-radius: 20px;
    transition: background .2s;
  }
  .lp-pill:hover { background: rgba(255,255,255,0.17); }
  .lp-footer-txt { font-size: 12px; color: rgba(255,255,255,.35); }

  /* ─── RIGHT PANEL ───────────────────────────────────────────── */
  .lp-right {
    flex: 1;
    display: flex; align-items: center; justify-content: center;
    padding: 40px 24px;
    background: #fff;
    min-height: 100vh;
    position: relative;
    overflow: hidden;
  }

  /* Single very-soft ambient behind the card */
  .lp-right-glow {
    position: absolute;
    width: 480px; height: 480px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(37,99,235,0.06) 0%, transparent 68%);
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    animation: lpGlowPulse 8s ease-in-out infinite;
  }

  /* Login card — floats gently, lifts on hover */
  .lp-card {
    position: relative; z-index: 1;
    width: 100%; max-width: 390px;
    background: #fff;
    border-radius: 20px;
    padding: 42px 40px;
    border: 1px solid rgba(0,0,0,0.06);
    box-shadow:
      0 1px 3px rgba(0,0,0,0.04),
      0 8px 24px rgba(0,0,0,0.07),
      0 24px 48px rgba(0,0,0,0.04);
    animation: lpFadeUp .5s ease both, lpCardFloat 7s ease-in-out 1s infinite;
    transition: box-shadow .3s ease, transform .3s ease;
    will-change: transform;
  }
  /* Pause float on hover, apply lift instead */
  .lp-card:hover {
    animation: lpFadeUp .5s ease both;
    box-shadow:
      0 2px 6px rgba(0,0,0,0.05),
      0 16px 40px rgba(0,0,0,0.10),
      0 32px 64px rgba(0,0,0,0.06);
    transform: translateY(-4px);
  }

  .lp-heading    { font-size: 23px; font-weight: 700; color: #0F172A; letter-spacing:-.01em; margin:0 0 5px; }
  .lp-subheading { font-size: 13.5px; color: #64748B; margin: 0 0 26px; }

  .lp-label { display:block; font-size:13px; font-weight:600; color:#374151; margin-bottom:6px; }
  .lp-field { margin-bottom: 17px; }

  .lp-input {
    width: 100%;
    padding: 10px 13px;
    border: 1px solid #E5E7EB;
    border-radius: 9px;
    font-size: 14px; color: #111827;
    background: #FAFAFA;
    outline: none;
    transition: border-color .18s, background .18s;
  }
  .lp-input:focus {
    border-color: #94A3B8;
    background: #fff;
  }
  .lp-input::placeholder { color: #9CA3AF; }

  .lp-pw-wrap { position: relative; }
  .lp-pw-wrap .lp-input { padding-right: 42px; }
  .lp-pw-toggle {
    position: absolute; right: 11px; top: 50%;
    transform: translateY(-50%);
    background: none; border: none; cursor: pointer;
    color: #9CA3AF; font-size: 15px; padding: 0;
    display: flex; align-items: center;
    transition: color .15s;
  }
  .lp-pw-toggle:hover { color: #6B7280; }

  .lp-error {
    background: #FEF2F2; border: 1px solid #FECACA;
    color: #B91C1C; border-radius: 8px;
    padding: 9px 13px; font-size: 13px;
    margin-bottom: 16px; display: flex; align-items: center; gap: 7px;
  }

  /* Button — subtle scale + shadow on hover */
  .lp-btn {
    width: 100%; padding: 11px;
    background: #2563EB; color: #fff;
    border: none; border-radius: 9px;
    font-size: 14.5px; font-weight: 600;
    cursor: pointer; letter-spacing: .01em;
    box-shadow: 0 2px 6px rgba(37,99,235,0.20);
    transition: background .15s, transform .18s, box-shadow .18s;
  }
  .lp-btn:hover:not(:disabled) {
    background: #1D4ED8;
    transform: scale(1.015) translateY(-1px);
    box-shadow: 0 4px 14px rgba(37,99,235,0.28);
  }
  .lp-btn:active:not(:disabled) {
    transform: scale(0.99) translateY(0);
    box-shadow: 0 1px 4px rgba(37,99,235,0.18);
  }
  .lp-btn:disabled { opacity:.6; cursor:not-allowed; transform:none; box-shadow:none; }

  .lp-form-footer { margin-top:24px; text-align:center; font-size:12px; color:#CBD5E1; }

  /* ── Spinner ───────────────────────────────────────────────── */
  @keyframes lpSpin { to { transform: rotate(360deg); } }
  .lp-spinner {
    width: 16px; height: 16px;
    border: 2px solid rgba(255,255,255,0.4);
    border-top-color: #fff;
    border-radius: 50%;
    animation: lpSpin .8s linear infinite;
  }
`;

export default function Login() {
  const { login }      = useAuth();
  const { branding }   = useBranding();
  const navigate       = useNavigate();
  const { showToast }  = useToast();
  const runOnce        = useSingleFlight();
  const [form, setForm]       = useState({ username: '', password: '' });
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw]   = useState(false);

  useEffect(() => {
    try {
      const reason = sessionStorage.getItem('rfid_logout_reason');
      if (reason) {
        sessionStorage.removeItem('rfid_logout_reason');
        setError(reason);
        showToast(reason, 'error');
      }
    } catch {
      /* ignore */
    }
  }, [showToast]);

  const handleSubmit = (e) => {
    e.preventDefault();
    runOnce(async () => {
      setError('');
      setLoading(true);
      try {
        const res = await loginRequest(form);
        const { user, accessToken, refreshToken } = res.data;
        if (!accessToken || !refreshToken) {
          throw new Error('Login response missing tokens');
        }
        login(user, accessToken, refreshToken);
        navigate('/', { replace: true });
        showToast(`Welcome, ${user.username}!`, 'success');
      } catch (err) {
        const msg = err.response?.data?.message || 'Login failed';
        setError(msg);
        showToast(msg, 'error');
      } finally {
        setLoading(false);
      }
    });
  };

  return (
    <>
      <style>{CSS}</style>

      <div className="lp-root">

        {/* ── Left — image + branding ── */}
        <div className="lp-left">
          <div className="lp-bg" />
          <div className="lp-overlay" />
          <div className="lp-ambient" />

          <div className="lp-left-content">
            <AppBrand
              appName={branding.app_name}
              appSubtitle={branding.app_subtitle}
              logoUrl={branding.logo_url}
              variant="login-dark"
            />

            <div>
              <h2 className="lp-hero-title">
                Real-Time Asset<br />Tracking & Control
              </h2>
              <p className="lp-hero-sub">
                Monitor, manage and secure your assets with enterprise-grade RFID technology.
              </p>
              <div className="lp-pills">
                {['📦 Asset Tracking', '📍 Location Mapping', '🔔 Live Alerts', '📊 Analytics'].map(f => (
                  <span key={f} className="lp-pill">{f}</span>
                ))}
              </div>
            </div>

            <div className="lp-footer-txt">
              © 2CQR RFID Asset Management System
            </div>
          </div>
        </div>

        {/* ── Right — login form ── */}
        <div className="lp-right">
          <div className="lp-right-glow" />

          <div className="lp-card">

            <h1 className="lp-heading">Welcome back</h1>
            <p className="lp-subheading">Sign in to your account to continue</p>

            <form onSubmit={handleSubmit}>

              <div className="lp-field">
                <label className="lp-label">Username</label>
                <input
                  className="lp-input"
                  value={form.username}
                  onChange={e => setForm({ ...form, username: e.target.value })}
                  placeholder="Enter your username"
                  autoFocus
                  autoComplete="username"
                />
              </div>

              <div className="lp-field">
                <label className="lp-label">Password</label>
                <div className="lp-pw-wrap">
                  <input
                    className="lp-input"
                    type={showPw ? 'text' : 'password'}
                    value={form.password}
                    onChange={e => setForm({ ...form, password: e.target.value })}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="lp-pw-toggle"
                    onClick={() => setShowPw(v => !v)}
                    tabIndex={-1}
                  >
                    {showPw ? '🙈' : '👁'}
                  </button>
                </div>
              </div>

              {error && (
                <div className="lp-error">
                  <span>⚠</span> {error}
                </div>
              )}

          <button type="submit" disabled={loading} className="lp-btn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            {loading ? <><span className="lp-spinner" /> Signing in…</> : 'Sign In'}
              </button>

            </form>

            <div className="lp-form-footer">
              {branding.app_name} · Secure Login
            </div>
          </div>
        </div>

      </div>
    </>
  );
}
