import ProfileTab from './settings/ProfileTab';

export default function ProfileSettings() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Profile</h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: '6px 0 0', fontWeight: 400 }}>
            Customize the logo and display name shown in the sidebar and on the login page.
          </p>
        </div>
      </div>
      <ProfileTab />
    </div>
  );
}
