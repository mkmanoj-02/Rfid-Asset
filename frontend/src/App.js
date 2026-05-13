import { useState, useRef, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, Tag, MapPin, Users, History,
  Bell, BarChart2, ClipboardList, Upload, ChevronDown,
  Menu, X, LogOut, Settings, Truck,
} from 'lucide-react';
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
import { AuthProvider, useAuth } from './AuthContext';
import { ToastProvider }         from './Toast';
import './App.css';

/* ─── Design tokens ──────────────────────────────────────────── */
const S = {
  sidebarW:    250,
  bg:          'linear-gradient(160deg, #0EA5E9 0%, #1296DB 40%, #2563EB 100%)',
  hover:       'rgba(255,255,255,0.12)',
  active:      'rgba(255,255,255,0.20)',
  activeBorder:'rgba(255,255,255,0.85)',
  text:        '#FFFFFF',
  muted:       'rgba(255,255,255,0.65)',
  divider:     'rgba(255,255,255,0.15)',
  glass:       'rgba(255,255,255,0.08)',
  radius:      10,
  transition:  'all 0.18s ease',
};

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

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const items = [
    { icon: Tag,   label: 'Tag Types', path: '/settings/tag-types', desc: 'Manage RFID, Barcode, QR types' },
    { icon: Truck, label: 'Vendors',   path: '/settings/vendors',   desc: 'Manage asset vendors & suppliers' },
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
          background: open ? 'rgba(37,99,235,0.12)' : 'transparent',
          border: `1.5px solid ${open ? '#2563EB' : '#e2e8f0'}`,
          cursor: 'pointer', color: open ? '#2563EB' : '#64748b',
          transition: 'all 0.15s ease',
        }}
        className="settings-gear-btn"
      >
        <Settings
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
                background: 'linear-gradient(135deg, #EFF6FF, #DBEAFE)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon size={15} strokeWidth={2} color="#2563EB" />
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
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
      padding: '10px 28px',
      borderBottom: '1px solid #e8edf2',
      background: '#fff',
      flexShrink: 0,
      gap: 8,
    }}>
      <SettingsDropdown />
    </div>
  );
}

/* ─── Sidebar ────────────────────────────────────────────────── */
function Sidebar({ mobileOpen, onMobileClose }) {
  const { currentUser, logout } = useAuth();
  const isSuperAdmin = currentUser?.profile_type === 'super_admin';
  const isAdmin      = currentUser?.profile_type === 'admin' || isSuperAdmin;

  return (
    <nav style={{
      width: S.sidebarW, minWidth: S.sidebarW, height: '100vh',
      background: S.bg, display: 'flex', flexDirection: 'column',
      boxShadow: '4px 0 32px rgba(14,165,233,0.25), 2px 0 0 rgba(255,255,255,0.06)',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: 'linear-gradient(135deg, rgba(255,255,255,0.07) 0%, transparent 60%)' }} />

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>

        {/* Logo */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 16px 14px', borderBottom: '1px solid ' + S.divider, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, flexShrink: 0,
              background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            }}>📡</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', letterSpacing: '0.01em', lineHeight: 1.2 }}>RFID Asset</div>
              <div style={{ fontSize: 10.5, color: S.muted, letterSpacing: '0.03em', marginTop: 1 }}>Management System</div>
            </div>
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
            <NavItem to="/assets"      icon={Package} label="Assets"      indent />
            <NavItem to="/asset-types" icon={Tag}     label="Asset Types" indent />
            <NavItem to="/locations"   icon={MapPin}  label="Locations"   indent />
            <NavItem to="/users"       icon={Users}   label={isSuperAdmin ? 'Users' : 'My Profile'} indent />
          </NavGroup>

          <SidebarDivider />
          <SectionLabel label="Tracking" />
          <NavItem to="/movements"    icon={History} label="Trace History"  />
          <NavItem to="/rules-alerts" icon={Bell}    label="Rules & Alerts" />

          <SidebarDivider />
          <SectionLabel label="Import Manager" />
          {isAdmin && <NavItem to="/import" icon={Upload} label="Import" />}

          <SidebarDivider />
          <SectionLabel label="Reports" />
          <NavItem to="/reports"   icon={BarChart2}     label="Reports"        />
          <NavItem to="/audit-log" icon={ClipboardList} label="User Audit Log" />
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
  const { currentUser } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!currentUser) return <Login />;

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#F1F5F9' }}>

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
          padding: '12px 16px', background: S.bg,
          boxShadow: '0 2px 12px rgba(14,165,233,0.3)', flexShrink: 0,
        }}>
          <button onClick={() => setMobileOpen(true)} style={{
            background: 'rgba(255,255,255,0.15)', border: 'none',
            borderRadius: 8, padding: 8, cursor: 'pointer', color: '#fff', display: 'flex',
          }}>
            <Menu size={18} />
          </button>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>RFID Asset</span>
        </div>

        {/* Desktop top bar with settings gear */}
        <TopBar />

        <main className="main-content" style={{ flex: 1, overflowY: 'auto', height: 0 }}>
          <Routes>
            <Route path="/"                      element={<Dashboard />} />
            <Route path="/assets"                element={<Assets />} />
            <Route path="/asset-types"           element={<AssetTypes />} />
            <Route path="/locations"             element={<Locations />} />
            <Route path="/movements"             element={<Movements />} />
            <Route path="/import"                element={<Import />} />
            <Route path="/users"                 element={<UsersPage />} />
            <Route path="/rules-alerts"          element={<RulesAlerts />} />
            <Route path="/reports"               element={<Reports />} />
            <Route path="/audit-log"             element={<AuditLog />} />
            <Route path="/settings/tag-types"    element={<TagTypesSettings />} />
            <Route path="/settings/vendors"      element={<VendorsSettings />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <AppShell />
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
