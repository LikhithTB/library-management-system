import { useState } from "react";
import StudentHome from "./student/StudentHome";
import StudentSearch from "./student/StudentSearch";
import StudentNotifications from "./student/StudentNotifications";
import StudentAnalytics from "./student/StudentAnalytics";
import UserCommunications from "../common/UserCommunications";
import ProfileMenu from "../common/ProfileMenu";

const NAV = [
  { key: "home", label: "Dashboard" },
  { key: "search", label: "Search Books" },
  { key: "analytics", label: "My Analytics" },
  { key: "notifications", label: "Notifications" },
];

export default function StudentDashboard({ user, onLogout, darkMode, setDarkMode }) {
  const [activePage, setActivePage] = useState("home");

  return (
    <div className={`app-shell ${darkMode ? "dark" : "light"}`}>
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="sidebar-brand">Library Portal</div>
          <div className="sidebar-role tag-student">Student</div>
          <div className="sidebar-user">{user.roll_number}</div>
        </div>

        <nav className="sidebar-nav">
          {NAV.map(item => (
            <button
              key={item.key}
              className={`nav-item ${activePage === item.key ? "nav-item-active" : ""}`}
              onClick={() => setActivePage(item.key)}
            >
              {item.label}
            </button>
          ))}
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
          <ProfileMenu user={user} roleLabel="Student" roleClass="tag-student" onLogout={onLogout} />
        </div>
        <UserCommunications user={user} />
        {activePage === "home" && <StudentHome user={user} onNavigate={setActivePage} />}
        {activePage === "search" && <StudentSearch user={user} />}
        {activePage === "analytics" && <StudentAnalytics user={user} />}
        {activePage === "notifications" && <StudentNotifications user={user} />}
      </main>
    </div>
  );
}