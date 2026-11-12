import { useState, useEffect } from "react";
import LoginForm from "./components/LoginForm";
import RegisterForm from "./components/RegisterForm";
import ForgotForm from "./components/ForgotForm";
import StudentDashboard from "./components/dashboards/StudentDashboard";
import LibrarianDashboard from "./components/dashboards/LibrarianDashboard";
import HODDashboard from "./components/dashboards/HODDashboard";
import StaffDashboard from "./components/dashboards/StaffDashboard";
import AdminDashboard from "./components/dashboards/AdminDashboard";
import ChatbotWidget from "./components/common/ChatbotWidget";
import GraduationYearPrompt from "./components/common/GraduationYearPrompt";
import "./App.css";
import "./chatbot-widget.css";

export default function App() {
  const [page, setPage] = useState("login");
  const [user, setUser] = useState(null);
  const [needsGradYear, setNeedsGradYear] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    const storedTheme = localStorage.getItem("lms_theme");
    return storedTheme ? storedTheme === "dark" : false;
  });

  useEffect(() => {
    const stored = localStorage.getItem("lms_user");
    const token = localStorage.getItem("lms_token");
    if (stored && token) {
      setUser(JSON.parse(stored));
      setPage("dashboard");
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("lms_theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  // needsGradYear is only ever true right after a fresh login response
  // says so (see LoginForm.js) — it is intentionally NOT persisted to
  // localStorage, so a page refresh doesn't re-trigger the prompt for a
  // student who already dismissed it earlier in the same session; the
  // backend is the actual source of truth (graduation_year is either set
  // or it isn't) and will simply omit the flag on the next real login.
  const handleAuthSuccess = (userData, token, needsGraduationYear = false) => {
    localStorage.setItem("lms_user", JSON.stringify(userData));
    localStorage.setItem("lms_token", token);
    setUser(userData);
    setNeedsGradYear(!!needsGraduationYear);
    setPage("dashboard");
  };

  const handleLogout = () => {
    localStorage.removeItem("lms_user");
    localStorage.removeItem("lms_token");
    setUser(null);
    setNeedsGradYear(false);
    setPage("login");
  };

  // The API returned 401 (session expired, revoked, or account deactivated).
  useEffect(() => {
    const onSessionExpired = () => handleLogout();
    window.addEventListener("lms:session-expired", onSessionExpired);
    return () => window.removeEventListener("lms:session-expired", onSessionExpired);
  }, []);

  if (page === "dashboard" && user) {
    if (needsGradYear) {
      return (
        <GraduationYearPrompt
          user={user}
          onComplete={() => setNeedsGradYear(false)}
        />
      );
    }

    const dashProps = { user, onLogout: handleLogout, darkMode, setDarkMode };
    let dashboard = null;
    if (user.role === "student") dashboard = <StudentDashboard {...dashProps} />;
    else if (user.role === "librarian") dashboard = <LibrarianDashboard {...dashProps} />;
    else if (user.role === "hod") dashboard = <HODDashboard {...dashProps} />;
    else if (user.role === "staff") dashboard = <StaffDashboard {...dashProps} />;
    else if (user.role === "admin") dashboard = <AdminDashboard {...dashProps} />;

    return (
      <>
        {dashboard}
        {(user.role === "librarian" || user.role === "hod" || user.role === "student") && (
          <ChatbotWidget user={user} darkMode={darkMode} />
        )}
      </>
    );
  }

  return (
    <div className={`auth-container ${darkMode ? "dark" : "light"}`}>
      <div className="auth-backdrop" />
      <div className="theme-toggle-top">
        <button
          className="theme-btn"
          onClick={() => setDarkMode(!darkMode)}
          aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
        >
          {darkMode ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
            </svg>
          )}
        </button>
      </div>
      <div className="auth-layout">
        <section className="auth-card">
          <div className="auth-brand">
            <span className="auth-brand-mark">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
            </span>
            <span className="auth-brand-name">Library MS</span>
          </div>

          {page === "login" && (
            <>
              <div className="auth-header">
                <h2>Sign in</h2>
              </div>
              <LoginForm setPage={setPage} onSuccess={handleAuthSuccess} />
              <p className="switch-text">
                Need an account?{" "}
                <button onClick={() => setPage("register")} className="link-btn">Create one</button>
              </p>
            </>
          )}
          {page === "register" && (
            <>
              <div className="auth-header">
                <h2>Create your account</h2>
                <p className="auth-subtitle">Register with your college email to access the portal.</p>
              </div>
              <RegisterForm setPage={setPage} onSuccess={handleAuthSuccess} />
              <p className="switch-text">
                Already registered?{" "}
                <button onClick={() => setPage("login")} className="link-btn">Sign in</button>
              </p>
            </>
          )}
          {page === "forgot" && (
            <>
              <div className="auth-header">
                <h2>Reset your password</h2>
                <p className="auth-subtitle">Enter your roll number to continue.</p>
              </div>
              <ForgotForm setPage={setPage} />
            </>
          )}
          {page === "message" && (
            <>
              <div className="auth-header">
                <h2>Check your inbox</h2>
              </div>
              <p className="message">Password reset instructions have been sent to your registered email.</p>
              <button onClick={() => setPage("login")} className="button">Back to Login</button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}