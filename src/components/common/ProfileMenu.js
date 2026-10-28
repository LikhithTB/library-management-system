import { useState, useRef, useEffect } from "react";

export default function ProfileMenu({ user, roleLabel, roleClass, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function handleEscape(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const displayName = user?.roll_number || "Account";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="profile-menu" ref={ref}>
      <button
        className="profile-trigger"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span className="profile-avatar">{initial}</span>
        <span className="profile-trigger-text">
          <span className="profile-trigger-name">{displayName}</span>
          <span className="profile-trigger-role">{roleLabel}</span>
        </span>
        <svg
          className={`profile-chevron ${open ? "profile-chevron-open" : ""}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="profile-dropdown">
          <div className="profile-dropdown-header">
            <span className="profile-avatar profile-avatar-lg">{initial}</span>
            <div className="profile-dropdown-identity">
              <div className="profile-dropdown-name">{displayName}</div>
              <span className={`sidebar-role ${roleClass}`}>{roleLabel}</span>
            </div>
          </div>
          <div className="profile-dropdown-divider" />
          <button className="profile-dropdown-logout" onClick={onLogout}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Logout
          </button>
        </div>
      )}
    </div>
  );
}