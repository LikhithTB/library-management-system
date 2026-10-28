import UserCommunications from "../common/UserCommunications";
import ProfileMenu from "../common/ProfileMenu";

export default function StaffDashboard({ user, onLogout, darkMode, setDarkMode }) {
  return (
    <div className={`app-shell ${darkMode ? "dark" : "light"}`}>
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="sidebar-brand">Library Portal</div>
          <div className="sidebar-role tag-staff">Teaching Staff</div>
          <div className="sidebar-user">{user.roll_number}</div>
        </div>
        <nav className="sidebar-nav">
          <button className="nav-item nav-item-active">Dashboard</button>
          <button className="nav-item" disabled>Reference Search</button>
          <button className="nav-item" disabled>Course Resources</button>
        </nav>
        <div className="sidebar-bottom">
          <button className="sidebar-theme-btn" onClick={() => setDarkMode(!darkMode)}>
            {darkMode ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
              </svg>
            )}
            {darkMode ? "Light Mode" : "Dark Mode"}
          </button>
        </div>
      </aside>
      <main className="main-content">
        <div className="dashboard-topbar">
          <ProfileMenu user={user} roleLabel="Teaching Staff" roleClass="tag-staff" onLogout={onLogout} />
        </div>
        <UserCommunications user={user} />
        <div className="page-content">
          <div className="dash-welcome">
            <h1>Staff Portal</h1>
            <p>Search books, access reference materials, and track course resources.</p>
          </div>

          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">0</div>
              <div className="stat-label">Course Books Tracked</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">0</div>
              <div className="stat-label">Requested Books</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">24/7</div>
              <div className="stat-label">Portal Availability</div>
            </div>
          </div>

          <p className="section-title">Reference Books Available</p>
          <div className="empty-state">Reference search and course-resource tools can be added here without changing the backend.</div>
        </div>
      </main>
    </div>
  );
}