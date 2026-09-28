import { useState, useRef, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useNavigate, Navigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, Tag, MapPin, Users, History,
  Bell, BarChart2, ClipboardList, Upload, ChevronDown,
  Menu, X, LogOut, Settings as SettingsIcon, Truck, TrendingDown, Smartphone, Building2, ScanLine,
} from 'lucide-react';
import AppBrand from './components/AppBrand';
import { BrandingProvider, useBranding } from './BrandingContext';
import { SIDEBAR_CHROME, getTheme } from './themes';
import Dashboard         from './pages/Dashboard';
import Locations         from './pages/Locations';
import AssetTypes        from './pages/AssetTypes';
import Assets            from './pages/Assets';
import Movements         from './pages/Movements';
import Import            from './pages/Import';
import UsersPage         from './pages/Users';
import Login             from './pages/Login';
import RulesAlerts       from './pages/RulesAlerts';
import Reports           from './pages/Reports';
import AuditLog          from './pages/AuditLog';
import TagTypesSettings  from './pages/TagTypesSettings';
import VendorsSettings   from './pages/VendorsSettings';
import AppSettings       from './pages/Settings';
import ProfileSettings   from './pages/ProfileSettings';
import Depreciation      from './pages/Depreciation';
import HandheldDevices   from './pages/HandheldDevices';
import UnassignedTags    from './pages/UnassignedTags';
import { AuthProvider, useAuth } from './AuthContext';
import { ToastProvider }         from './Toast';
import ToastRouteSync            from './ToastRouteSync';
import './App.css';

/* ─── Design tokens (theme-aware sidebar chrome) ─────────────── */
const S = SIDEBAR_CHROME;

function useChromeTheme() {
  const { branding } = useBranding();
  return getTheme(branding?.theme);
}

const PROFILE_LABELS = {
  super_admin: 'Super Administrator',
  admin:       'Administrator',
  normal:      'Normal User',
};

/* ─── Avatar ─────────────────────────────────────────────────── */
function Avatar({ name = '?', size = 34 }) {
  const initials = name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'rgba(255,255,255,0.25)',
      backdropFilter: 'blur(6px)',
      border: '1.5px solid rgba(255,255,255,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.36, fontWeight: 700, color: '#fff',
      letterSpacing: '0.03em',
    }}>
      {initials}
    </div>
  );
}

/* ─── Sidebar helpers ────────────────────────────────────────── */
function SidebarDivider() {
  return <div style={{ height: 1, background: S.divider, margin: '6px 18px' }} />;
}

function SectionLabel({ label }) {
  return (
    <div style={{
      padding: '10px 20px 4px', fontSize: 10, fontWeight: 700,
      letterSpacing: '0.12em', textTransform: 'uppercase',
      color: S.muted, userSelect: 'none',
    }}>
      {label}
    </div>
  );
}

function NavItem({ to, icon: Icon, label, end, indent = false }) {
  const [hovered, setHovered] = useState(false);
  return (
    <NavLink
      to={to} end={end}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={({ isActive }) => ({
        display: 'flex', alignItems: 'center', gap: 10,
        margin: '2px 10px',
        padding: indent ? '8px 12px 8px 36px' : '9px 12px',
        borderRadius: S.radius, fontSize: 13.5,
        fontWeight: isActive ? 600 : 500, color: S.text,
        background: isActive ? S.active : hovered ? S.hover : 'transparent',
        borderLeft: isActive ? `3px solid ${S.activeBorder}` : '3px solid transparent',
        textDecoration: 'none', transition: S.transition,
        backdropFilter: isActive ? 'blur(8px)' : 'none',
        boxShadow: isActive ? 'inset 0 1px 0 rgba(255,255,255,0.15)' : 'none',
        letterSpacing: '0.01em',
      })}
    >
      {({ isActive }) => (
        <>
          <Icon size={15} strokeWidth={isActive ? 2.2 : 1.8} style={{ flexShrink: 0, opacity: isActive ? 1 : 0.85 }} />
          <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        </>
      )}
    </NavLink>
  );
}

function NavGroup({ label, icon: Icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const [hovered, setHovered] = useState(false);
  const contentRef = useRef(null);
  const [height, setHeight] = useState(defaultOpen ? 'auto' : 0);

  useEffect(() => {
    if (!contentRef.current) return;
    if (open) {
      const h = contentRef.current.scrollHeight;
      setHeight(h);
      const t = setTimeout(() => setHeight('auto'), 260);
      return () => clearTimeout(t);
    } else {
      setHeight(contentRef.current.scrollHeight);
      requestAnimationFrame(() => setHeight(0));
    }
  }, [open]);

  return (
    <div style={{ margin: '2px 0' }}>
      <button
        onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          width: 'calc(100% - 20px)', margin: '2px 10px',
          padding: '9px 12px', borderRadius: S.radius,
          background: hovered ? S.hover : 'transparent',
          border: 'none', cursor: 'pointer', color: S.text,
          fontSize: 13.5, fontWeight: 600, transition: S.transition,
          letterSpacing: '0.01em',
        }}
      >
        <Icon size={15} strokeWidth={1.8} style={{ flexShrink: 0, opacity: 0.85 }} />
        <span style={{ flex: 1, textAlign: 'left', whiteSpace: 'nowrap' }}>{label}</span>
        <ChevronDown size={13} style={{
          flexShrink: 0, opacity: 0.7,
          transition: 'transform 0.22s ease',
          transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
        }} />
      </button>
      <div ref={contentRef} style={{
        overflow: 'hidden',
        height: typeof height === 'number' ? `${height}px` : height,
        opacity: open ? 1 : 0,
        transition: 'height 0.25s ease, opacity 0.2s ease',
      }}>
        {children}
      </div>
    </div>
  );
}

function IconBtn({ onClick, title, children }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button onClick={onClick} title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? S.hover : 'transparent',
        border: 'none', cursor: 'pointer', color: S.text,
        padding: 6, borderRadius: 7,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: S.transition, flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

/* ─── Settings dropdown ──────────────────────────────────────── */
function SettingsDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const theme = useChromeTheme();

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const items = [
    { icon: Building2, label: 'Profile', path: '/settings/profile', desc: 'Logo, favicon, app name, tagline & theme' },
    { icon: Tag, label: 'Tag Management', path: '/settings', desc: 'Manage tag types & tag recommendations' },
    { icon: Truck, label: 'Vendors', path: '/settings/vendors', desc: 'Manage asset vendors & suppliers' },
  ];

  const go = (path) => { navigate(path); setOpen(false); };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Gear button */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Settings"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 36, height: 36, borderRadius: 9,
          background: open ? `${theme.accent}1f` : 'transparent',
          border: `1.5px solid ${open ? theme.accent : '#e2e8f0'}`,
          cursor: 'pointer', color: open ? theme.accent : '#64748b',
          transition: 'all 0.15s ease',
        }}
        className="settings-gear-btn"
      >
        <SettingsIcon
          size={17}
          strokeWidth={2}
          style={{
            transition: 'transform 0.4s ease',
            transform: open ? 'rotate(60deg)' : 'rotate(0deg)',
          }}
        />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          width: 240,
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
          zIndex: 200,
          animation: 'settingsDropIn 0.18s ease',
        }}>
          {/* Header */}
          <div style={{
            padding: '10px 14px 8px',
            borderBottom: '1px solid #f1f5f9',
            fontSize: 11, fontWeight: 700,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            color: '#94a3b8',
          }}>
            Settings
          </div>

          {/* Items */}
          {items.map(({ icon: Icon, label, path, desc }) => (
            <button
              key={path}
              onClick={() => go(path)}
              className="settings-dropdown-item"
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                width: '100%', padding: '10px 14px',
                background: 'none', border: 'none', cursor: 'pointer',
                textAlign: 'left', transition: 'background 0.12s',
              }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                background: `${theme.accent}18`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon size={15} strokeWidth={2} color={theme.accent} />
              </div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1e293b' }}>{label}</div>
                <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 1 }}>{desc}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Top bar (inside main content) ─────────────────────────── */
function TopBar() {
  const { currentUser } = useAuth();
  const isSuperAdmin = currentUser?.profile_type === 'super_admin';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
      padding: '10px 28px',
      borderBottom: '1px solid #e8edf2',
      background: '#fff',
      flexShrink: 0,
      gap: 8,
      boxSizing: 'border-box',
      minHeight: 56,
      height: 56,
    }}>
      <div
        style={{
          width: 36,
          height: 36,
          flexShrink: 0,
          visibility: isSuperAdmin ? 'visible' : 'hidden',
          pointerEvents: isSuperAdmin ? 'auto' : 'none',
        }}
        aria-hidden={!isSuperAdmin}
      >
        <SettingsDropdown />
      </div>
    </div>
  );
}

function SuperAdminRoute({ children }) {
  const { currentUser } = useAuth();
  if (currentUser?.profile_type !== 'super_admin') {
    return <Navigate to="/" replace />;
  }
  return children;
}

function RequireAuth({ children }) {
  const { currentUser } = useAuth();
  if (!currentUser) return <Navigate to="/login" replace />;
  return children;
}

function RedirectIfAuthenticated({ children }) {
  const { currentUser } = useAuth();
  if (currentUser) return <Navigate to="/" replace />;
  return children;
}

/* ─── Sidebar ────────────────────────────────────────────────── */
function Sidebar({ mobileOpen, onMobileClose }) {
  const { currentUser, logout } = useAuth();
  const { branding } = useBranding();
  const theme = useChromeTheme();
  const isSuperAdmin = currentUser?.profile_type === 'super_admin';
  const isAdmin      = currentUser?.profile_type === 'admin' || isSuperAdmin;

  return (
    <nav style={{
      width: S.sidebarW, minWidth: S.sidebarW, height: '100vh',
      background: theme.sidebarBg, display: 'flex', flexDirection: 'column',
      boxShadow: theme.sidebarShadow,
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: 'linear-gradient(135deg, rgba(255,255,255,0.07) 0%, transparent 60%)' }} />

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>

        {/* Logo */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 8,
          padding: '12px 12px 10px', borderBottom: '1px solid ' + S.divider, flexShrink: 0,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <AppBrand
              appName={branding.app_name}
              appSubtitle={branding.app_subtitle}
              logoUrl={branding.logo_url}
              variant="sidebar"
            />
          </div>
          {mobileOpen !== undefined && (
            <IconBtn onClick={onMobileClose} title="Close"><X size={16} /></IconBtn>
          )}
        </div>

        {/* Nav */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '10px 0 8px' }} className="sidebar-scroll">
          <NavItem to="/" icon={LayoutDashboard} label="Dashboard" end />

          <SidebarDivider />
          <SectionLabel label="Manage" />
          <NavGroup label="Assets" icon={Package} defaultOpen>
            <NavItem to="/assets"            icon={Package}   label="Assets"            indent />
            <NavItem to="/asset-types"       icon={Tag}       label="Asset Types"       indent />
            <NavItem to="/locations"         icon={MapPin}    label="Locations"         indent />
            <NavItem to="/unassigned-tags"   icon={ScanLine}  label="Unassigned Tags"   indent />
            <NavItem to="/users"             icon={Users}     label={isSuperAdmin ? 'Users' : 'My Profile'} indent />
          </NavGroup>

          <SidebarDivider />
          <SectionLabel label="Tracking" />
          <NavItem to="/movements"    icon={History} label="Trace History"  />
          <NavItem to="/rules-alerts" icon={Bell}    label="Rules & Alerts" />

          <SidebarDivider />
          <SectionLabel label="Import Manager" />
          {isAdmin && <NavItem to="/import" icon={Upload} label="Import" />}

          <SidebarDivider />
          <SectionLabel label="Mobile Readers" />
          {isAdmin && <NavItem to="/handheld-devices" icon={Smartphone} label="Reader Setup" />}

          <SidebarDivider />
          <SectionLabel label="Reports" />
          <NavItem to="/reports"       icon={BarChart2}     label="Reports"        />
          <NavItem to="/audit-log"     icon={ClipboardList} label="User Audit Log" />

          <SidebarDivider />
          <SectionLabel label="Finance" />
          <NavItem to="/depreciation"  icon={TrendingDown}  label="Depreciation"   />
        </div>

        {/* User card */}
        <div style={{ borderTop: '1px solid ' + S.divider, padding: '12px', flexShrink: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px', borderRadius: 10,
            background: S.glass, backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.12)',
          }}>
            <Avatar name={currentUser?.username} size={34} />
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {currentUser?.username}
              </div>
              <div style={{ fontSize: 10.5, color: S.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>
                {PROFILE_LABELS[currentUser?.profile_type]}
              </div>
            </div>
            <IconBtn onClick={logout} title="Sign out"><LogOut size={14} /></IconBtn>
          </div>
        </div>
      </div>
    </nav>
  );
}

/* ─── Mobile overlay ─────────────────────────────────────────── */
function MobileOverlay({ open, onClose }) {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      zIndex: 99, backdropFilter: 'blur(2px)',
    }} />
  );
}

/* ─── App Shell ──────────────────────────────────────────────── */
function AppShell() {
  const { logout } = useAuth();
  const { branding } = useBranding();
  const theme = useChromeTheme();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    let handlingPop = false;

    const onPopState = () => {
      if (handlingPop) return;
      handlingPop = true;
      logout().finally(() => {
        navigate('/login', { replace: true });
      });
    };

    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, [logout, navigate]);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: theme.contentBg }}>

      {/* Desktop sidebar */}
      <div style={{ flexShrink: 0, height: '100vh', position: 'sticky', top: 0 }} className="sidebar-desktop">
        <Sidebar />
      </div>

      {/* Mobile drawer */}
      <MobileOverlay open={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="sidebar-mobile" style={{
        position: 'fixed', top: 0, left: 0, zIndex: 100,
        transform: mobileOpen ? 'translateX(0)' : `translateX(-${S.sidebarW}px)`,
        transition: 'transform 0.25s ease',
      }}>
        <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
      </div>

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

        {/* Mobile top bar */}
        <div className="mobile-topbar" style={{
          display: 'none', alignItems: 'center', gap: 12,
          padding: '12px 16px', background: theme.sidebarBg,
          boxShadow: theme.sidebarShadow, flexShrink: 0,
        }}>
          <button onClick={() => setMobileOpen(true)} style={{
            background: 'rgba(255,255,255,0.15)', border: 'none',
            borderRadius: 8, padding: 8, cursor: 'pointer', color: '#fff', display: 'flex',
          }}>
            <Menu size={18} />
          </button>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{branding.app_name}</span>
        </div>

        {/* Desktop top bar with settings gear */}
        <TopBar />

        <main className="main-content" style={{ flex: 1, overflowY: 'auto', height: 0 }}>
          <Routes>
            <Route path="/"                      element={<Dashboard />} />
            <Route path="/assets"                element={<Assets />} />
            <Route path="/asset-types"           element={<AssetTypes />} />
            <Route path="/locations"             element={<Locations />} />
            <Route path="/unassigned-tags"       element={<UnassignedTags />} />
            <Route path="/movements"             element={<Movements />} />
            <Route path="/import"                element={<Import />} />
            <Route path="/users"                 element={<UsersPage />} />
            <Route path="/handheld-devices"      element={<HandheldDevices />} />
            <Route path="/rules-alerts"          element={<RulesAlerts />} />
            <Route path="/reports"               element={<Reports />} />
            <Route path="/audit-log"             element={<AuditLog />} />
            <Route path="/settings"             element={<SuperAdminRoute><AppSettings /></SuperAdminRoute>} />
            <Route path="/settings/profile"   element={<SuperAdminRoute><ProfileSettings /></SuperAdminRoute>} />
            <Route path="/settings/tag-types" element={<SuperAdminRoute><TagTypesSettings /></SuperAdminRoute>} />
            <Route path="/settings/vendors"   element={<SuperAdminRoute><VendorsSettings /></SuperAdminRoute>} />
            <Route path="/depreciation"          element={<Depreciation />} />
            <Route path="*"                      element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrandingProvider>
        <ToastProvider>
          <BrowserRouter>
            <ToastRouteSync />
            <Routes>
              <Route
                path="/login"
                element={(
                  <RedirectIfAuthenticated>
                    <Login />
                  </RedirectIfAuthenticated>
                )}
              />
              <Route
                path="/*"
                element={(
                  <RequireAuth>
                    <AppShell />
                  </RequireAuth>
                )}
              />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </BrandingProvider>
    </AuthProvider>
  );
}
