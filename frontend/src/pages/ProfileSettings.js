import { Sparkles } from 'lucide-react';
import ProfileTab from './settings/ProfileTab';

export default function ProfileSettings() {
  return (
    <div className="profile-settings-page">
      <header className="profile-settings-header">
        <div className="profile-settings-header-text">
          <h1>Profile</h1>
          <p>Brand your application with a custom logo, favicon, and display name.</p>
        </div>
        <div className="profile-settings-header-badge" aria-hidden>
          <Sparkles size={14} strokeWidth={2} />
          <span>Branding</span>
        </div>
      </header>
      <ProfileTab />
    </div>
  );
}
