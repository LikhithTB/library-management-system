import { useState, useEffect } from "react";
import config from "../../config";
import ProfileMenu from "../common/ProfileMenu";

const NAV = [
  { key: "home",          label: "Dashboard" },
  { key: "approvals",     label: "Account Approvals" },
  { key: "students",      label: "Student Accounts" },
  { key: "settings",      label: "System Settings" },
  { key: "announcements", label: "Announcements" },
  { key: "broadcasts",    label: "Broadcasts & Carousel" },
];

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function timeLeft(iso) {
  if (!iso) return "";
  const diff = new Date(iso) - new Date();
  if (diff <= 0) return "Expired";
  const days = Math.floor(diff / 86400000);
  const hrs  = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `${days}d ${hrs}h left`;
  if (hrs > 0)  return `${hrs}h ${mins}m left`;
  return `${mins}m left`;
}

export default function AdminDashboard({ user, onLogout, darkMode, setDarkMode }) {
  const [activePage, setActivePage] = useState("home");
  const [pendingUsers, setPendingUsers] = useState([]);

  useEffect(() => { fetchPending(); }, []);

  const fetchPending = async () => {
    try {
      const res = await fetch(`${config.API_URL}/api/admin/pending-users`);
      const data = await res.json();
      setPendingUsers(Array.isArray(data) ? data : []);
    } catch {}
  };

  return (
    <div className={`app-shell ${darkMode ? "dark" : "light"}`}>
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="sidebar-brand">Library Portal</div>
          <div className="sidebar-role tag-admin">ADMIN</div>
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
          <ProfileMenu user={user} roleLabel="Admin" roleClass="tag-admin" onLogout={onLogout} />
        </div>
        {activePage === "home"          && <AdminHome user={user} pendingUsers={pendingUsers} onNavigate={setActivePage} />}
        {activePage === "approvals"     && <AdminApprovals user={user} onRefresh={fetchPending} />}
        {activePage === "students"      && <AdminStudentAccounts user={user} />}
        {activePage === "settings"      && <AdminSettings user={user} />}
        {activePage === "announcements" && <AdminAnnouncements user={user} />}
        {activePage === "broadcasts"    && <AdminBroadcasts user={user} />}
      </main>
    </div>
  );
}

// ── Home ─────────────────────────────────────────────────────
function AdminHome({ user, pendingUsers, onNavigate }) {
  const [fineRate, setFineRate] = useState("—");
  const [broadcastCount, setBroadcastCount] = useState(0);
  const [carouselCount, setCarouselCount] = useState(0);
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    fetch(`${config.API_URL}/api/admin/settings`)
      .then(r => r.json()).then(d => setFineRate(d.fine_per_day || "—")).catch(() => {});
    fetch(`${config.API_URL}/api/broadcasts`)
      .then(r => r.json()).then(d => setBroadcastCount(Array.isArray(d) ? d.length : 0)).catch(() => {});
    fetch(`${config.API_URL}/api/carousels`)
      .then(r => r.json()).then(d => setCarouselCount(Array.isArray(d) ? d.length : 0)).catch(() => {});
    fetchAlerts();
  }, []);

  const fetchAlerts = async () => {
    try {
      const res = await fetch(`${config.API_URL}/api/admin/system-alerts?unread_only=true`);
      const data = await res.json();
      setAlerts(Array.isArray(data) ? data : []);
    } catch {}
  };

  const markRead = async (id) => {
    try {
      await fetch(`${config.API_URL}/api/admin/system-alerts/${id}/mark-read`, { method: "POST" });
      setAlerts(prev => prev.filter(a => a.id !== id));
    } catch {}
  };

  return (
    <div className="page-content">
      <div className="dash-welcome">
        <h1>Admin Dashboard</h1>
        <p>Manage approvals, system settings, and communications.</p>
      </div>

      {alerts.length > 0 && (
        <>
          <p className="section-title">System Alerts ({alerts.length} unread)</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "24px" }}>
            {alerts.map(a => (
              <div key={a.id} className="error-box" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                <span>{a.message}</span>
                <button className="approve-btn" style={{ flexShrink: 0 }} onClick={() => markRead(a.id)}>
                  Mark read
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value" style={{ color: pendingUsers.length > 0 ? "#fbbf24" : "inherit" }}>
            {pendingUsers.length}
          </div>
          <div className="stat-label">Pending Approvals</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">Rs. {fineRate}</div>
          <div className="stat-label">Fine Rate / Day</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{broadcastCount}</div>
          <div className="stat-label">Active Broadcasts</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{carouselCount}</div>
          <div className="stat-label">Active Ticker Messages</div>
        </div>
      </div>

      <p className="section-title">Quick Actions</p>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <button className="approve-btn" onClick={() => onNavigate("approvals")}>Review Approvals</button>
        <button className="logout-btn" onClick={() => onNavigate("settings")}>System Settings</button>
        <button className="logout-btn" onClick={() => onNavigate("announcements")}>Post Announcement</button>
        <button className="logout-btn" onClick={() => onNavigate("broadcasts")}>Send Broadcast</button>
      </div>
    </div>
  );
}

// ── Account Approvals ────────────────────────────────────────
function AdminApprovals({ user, onRefresh }) {
  const [pendingUsers, setPendingUsers] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError]   = useState("");

  useEffect(() => { fetchPending(); }, []);

  const fetchPending = async () => {
    try {
      const res  = await fetch(`${config.API_URL}/api/admin/pending-users`);
      const data = await res.json();
      setPendingUsers(Array.isArray(data) ? data : []);
    } catch {}
  };

  const handleApprove = async (userId, action) => {
    setMessage(""); setError("");
    const res  = await fetch(`${config.API_URL}/api/admin/approve-user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, action }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.detail || "Failed"); return; }
    setMessage(data.message);
    fetchPending();
    if (onRefresh) onRefresh();
  };

  return (
    <div className="page-content">
      <div className="dash-welcome">
        <h1>Account Approvals</h1>
        <p>Approve or reject HOD, librarian, and staff registrations.</p>
      </div>
      {message && <div className="pending-box" style={{ marginBottom: "12px" }}>{message}</div>}
      {error   && <div className="error-box"   style={{ marginBottom: "12px" }}>{error}</div>}
      {pendingUsers.length === 0 ? (
        <div className="empty-state">No pending approvals.</div>
      ) : (
        <div className="approval-list">
          {pendingUsers.map(u => (
            <div className="approval-card" key={u.id}>
              <div className="approval-info">
                <span className="approval-roll">{u.roll_number}</span>
                <span className="approval-email">{u.email}</span>
                <span className={`sidebar-role tag-${u.role}`}>{u.role}</span>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button className="approve-btn" onClick={() => handleApprove(u.id, "approve")}>Approve</button>
                <button className="reject-btn"  onClick={() => handleApprove(u.id, "reject")}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Student Account Status (active / graduated / dropped / suspended) ──
const ACCOUNT_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "graduated", label: "Graduated" },
  { value: "dropped", label: "Dropped" },
  { value: "suspended", label: "Suspended" },
];

function AdminStudentAccounts({ user }) {
  const [rollNumber, setRollNumber] = useState("");
  const [lookup, setLookup] = useState(null); // {roll_number, user_id, account_status, graduation_year, has_dues, issued_count, unpaid_total}
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(null); // status value pending confirmation

  const handleSearch = async (e) => {
    e.preventDefault();
    setMessage(""); setError(""); setLookup(null); setConfirming(null);
    const roll = rollNumber.trim();
    if (!roll) return;
    setLoading(true);
    try {
      const res = await fetch(`${config.API_URL}/api/admin/students/${encodeURIComponent(roll)}/account-status`);
      const data = await res.json();
      if (!res.ok) { setError(data.detail || "Student not found"); return; }
      setLookup(data);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  };

  const applyStatus = async (newStatus) => {
    if (!lookup) return;
    setMessage(""); setError("");
    try {
      const res = await fetch(`${config.API_URL}/api/admin/account-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: lookup.user_id, new_status: newStatus, changed_by: user.id }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.detail || "Could not update status"); return; }
      setMessage(data.message);
      setConfirming(null);
      setLookup({ ...lookup, account_status: newStatus });
    } catch {
      setError("Could not reach the server.");
    }
  };

  const handleStatusClick = (newStatus) => {
    if (newStatus === lookup.account_status) return;
    setConfirming(newStatus);
  };

  return (
    <div className="page-content">
      <div className="dash-welcome">
        <h1>Student Accounts</h1>
        <p>Mark a student account as graduated, dropped, or suspended. Their borrowing history, fines, and reviews are kept — the account is just locked out of logging in and borrowing. Disabling always goes through, even with outstanding dues — you'll get a system alert with the amount instead.</p>
      </div>

      <form onSubmit={handleSearch} className="book-form" style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "20px" }}>
        <input
          className="input"
          placeholder="Enter student roll number"
          value={rollNumber}
          onChange={e => setRollNumber(e.target.value)}
          style={{ maxWidth: "280px" }}
        />
        <button className="button" type="submit" disabled={loading}>
          {loading ? "Searching..." : "Search"}
        </button>
      </form>

      {message && <div className="pending-box" style={{ marginBottom: "12px" }}>{message}</div>}
      {error && <div className="error-box" style={{ marginBottom: "12px" }}>{error}</div>}

      {lookup && (
        <div className="approval-card" style={{ flexDirection: "column", alignItems: "flex-start", gap: "16px" }}>
          <div className="approval-info">
            <span className="approval-roll">{lookup.roll_number}</span>
            <span className="sidebar-role tag-student">student</span>
            <span className="notif-badge notif-waiting">Current status: {lookup.account_status}</span>
            {lookup.graduation_year && (
              <span className="notif-badge notif-waiting">Graduation year: {lookup.graduation_year}</span>
            )}
          </div>

          {lookup.has_dues && (
            <div className="book-meta">
              Note: this student has {lookup.issued_count} book(s) still issued and Rs. {lookup.unpaid_total.toFixed(2)} in unpaid fines. This does not block a status change — if you disable the account, a system alert will be raised so this can be followed up on separately.
            </div>
          )}

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {ACCOUNT_STATUS_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={opt.value === lookup.account_status ? "button" : "approve-btn"}
                disabled={opt.value === lookup.account_status}
                onClick={() => handleStatusClick(opt.value)}
              >
                {opt.value === lookup.account_status ? `Currently ${opt.label}` : `Mark ${opt.label}`}
              </button>
            ))}
          </div>

          {confirming && (
            <div className="pending-box" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <span>
                Are you sure you want to mark {lookup.roll_number} as <strong>{confirming}</strong>?
                {confirming !== "active" && " They will no longer be able to log in or borrow books."}
                {confirming !== "active" && lookup.has_dues && " A system alert will be raised for the outstanding dues noted above."}
              </span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button className="approve-btn" onClick={() => applyStatus(confirming)}>Yes, confirm</button>
                <button className="reject-btn" onClick={() => setConfirming(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── System Settings ──────────────────────────────────────────
function AdminSettings({ user }) {
  const [finePerDay,  setFinePerDay]  = useState("");
  const [currentFine, setCurrentFine] = useState(null);
  const [settingMsg,  setSettingMsg]  = useState("");
  const [settingErr,  setSettingErr]  = useState("");
  const [saving,      setSaving]      = useState(false);

  useEffect(() => {
    fetch(`${config.API_URL}/api/admin/settings`)
      .then(r => r.json())
      .then(d => { setCurrentFine(d.fine_per_day); setFinePerDay(d.fine_per_day); })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setSettingMsg(""); setSettingErr(""); setSaving(true);
    try {
      const val = parseInt(finePerDay);
      if (!val || val < 1 || val > 500) { setSettingErr("Enter a value between 1 and 500"); return; }
      const params = new URLSearchParams({ key: "fine_per_day", value: String(val), updated_by: user.id });
      const res  = await fetch(`${config.API_URL}/api/admin/settings?${params}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setSettingErr(data.detail || "Failed"); return; }
      setSettingMsg(`Fine rate updated to Rs. ${val} per day.`);
      setCurrentFine(String(val));
    } catch { setSettingErr("Could not connect"); }
    finally { setSaving(false); }
  };

  return (
    <div className="page-content">
      <div className="dash-welcome">
        <h1>System Settings</h1>
        <p>Configure system-wide library policies.</p>
      </div>

      <p className="section-title">Overdue Fine Rate</p>
      <div className="bm-detail-panel" style={{ marginBottom: "28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <div className="book-title" style={{ fontSize: "15px", marginBottom: "4px" }}>Overdue Fine Rate</div>
            <div className="book-meta">Charged per day for each overdue book.</div>
            {currentFine && (
              <div className="book-meta" style={{ marginTop: "6px", color: "#60a5fa" }}>
                Current rate: <strong>Rs. {currentFine}</strong> per day
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
            <div className="float-field" style={{ width: "160px" }}>
              <input type="number" className="float-input" min="1" max="500" placeholder=" "
                value={finePerDay} onChange={e => setFinePerDay(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSave()} />
              <label className="float-label">Rs. per day</label>
            </div>
            <button className="approve-btn" onClick={handleSave} disabled={saving} style={{ padding: "10px 20px" }}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>

        {settingMsg && <div className="pending-box" style={{ marginTop: "12px" }}>{settingMsg}</div>}
        {settingErr && <div className="error-box"   style={{ marginTop: "12px" }}>{settingErr}</div>}

        <div style={{ marginTop: "16px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {[1, 2, 5, 10, 20, 50].map(p => (
            <button key={p}
              className={finePerDay == p ? "approve-btn" : "logout-btn"}
              style={{ fontSize: "12px", padding: "5px 12px" }}
              onClick={() => setFinePerDay(String(p))}>
              Rs. {p}
            </button>
          ))}
          <span className="book-meta" style={{ alignSelf: "center" }}>quick select</span>
        </div>
      </div>
    </div>
  );
}

// ── Announcements ────────────────────────────────────────────
function AdminAnnouncements({ user }) {
  const [announcements, setAnnouncements] = useState([]);
  const [form, setForm]       = useState({ title: "", body: "", expires_at: "" });
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError]     = useState("");

  useEffect(() => { fetchAnnouncements(); }, []);

  const fetchAnnouncements = async () => {
    try {
      const res  = await fetch(`${config.API_URL}/api/announcements`);
      const data = await res.json();
      setAnnouncements(Array.isArray(data) ? data : []);
    } catch {}
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setMessage(""); setError("");
    if (!form.title.trim() || !form.body.trim()) { setError("Title and body are required"); return; }
    try {
      const res = await fetch(`${config.API_URL}/api/announcements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: form.title, body: form.body, created_by: user.id, expires_at: form.expires_at || null }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.detail || "Failed"); return; }
      setMessage("Announcement posted.");
      setForm({ title: "", body: "", expires_at: "" });
      setShowForm(false);
      fetchAnnouncements();
    } catch { setError("Could not connect"); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Remove this announcement?")) return;
    await fetch(`${config.API_URL}/api/announcements/${id}`, { method: "DELETE" });
    fetchAnnouncements();
  };

  return (
    <div className="page-content">
      <div className="dash-welcome">
        <h1>Announcements</h1>
        <p>Post notices visible to all users on their Notifications page.</p>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "16px" }}>
        <button className="approve-btn" onClick={() => { setShowForm(!showForm); setMessage(""); setError(""); }}>
          {showForm ? "Cancel" : "+ New Announcement"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="book-form" style={{ marginBottom: "20px" }}>
          <div className="book-form-grid">
            <div className="float-field" style={{ gridColumn: "1 / -1" }}>
              <input className="float-input" placeholder=" " value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })} required />
              <label className="float-label">Title *</label>
            </div>
          </div>
          <div className="float-field" style={{ marginTop: "10px" }}>
            <textarea className="float-input" placeholder=" "
              style={{ minHeight: "100px", resize: "vertical", paddingTop: "20px" }}
              value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} required />
            <label className="float-label">Message *</label>
          </div>
          <div className="float-field" style={{ marginTop: "10px", maxWidth: "240px" }}>
            <input type="date" className="float-input" placeholder=" " value={form.expires_at}
              onChange={e => setForm({ ...form, expires_at: e.target.value })} />
            <label className="float-label">Expiry Date (optional)</label>
          </div>
          {error   && <div className="error-box"   style={{ marginTop: "10px" }}>{error}</div>}
          <button type="submit" className="approve-btn" style={{ marginTop: "12px" }}>Post Announcement</button>
        </form>
      )}

      {message && <div className="pending-box" style={{ marginBottom: "12px" }}>{message}</div>}

      <p className="section-title">Active Announcements</p>
      {announcements.length === 0 ? (
        <div className="empty-state">No active announcements.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {announcements.map(a => (
            <div key={a.id} className="announcement-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div className="announcement-title">{a.title}</div>
                  <div className="announcement-body">{a.body}</div>
                  <div className="announcement-meta">
                    Posted: {formatDate(a.created_at)}
                    {a.expires_at && ` · Expires: ${formatDate(a.expires_at)}`}
                  </div>
                </div>
                <button className="reject-btn" style={{ fontSize: "12px", padding: "5px 12px", marginLeft: "12px", flexShrink: 0 }}
                  onClick={() => handleDelete(a.id)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Broadcasts & Carousel ────────────────────────────────────
const ROLE_OPTIONS = [
  { value: "student",   label: "Students" },
  { value: "librarian", label: "Librarians" },
  { value: "hod",       label: "HODs" },
  { value: "staff",     label: "Staff" },
];

function AdminBroadcasts({ user }) {
  const [subTab, setSubTab] = useState("broadcast");

  // Broadcast state
  const [broadcasts, setBroadcasts]         = useState([]);
  const [bForm, setBForm]                   = useState({ title: "", body: "", target_roles: [] });
  const [showBForm, setShowBForm]           = useState(false);
  const [bMessage, setBMessage]             = useState("");
  const [bError, setBError]                 = useState("");

  // Carousel state
  const [carousels, setCarousels]           = useState([]);
  const [cMessage_text, setCMessageText]    = useState("");
  const [showCForm, setShowCForm]           = useState(false);
  const [cMessage, setCMessage]             = useState("");
  const [cError, setCError]                 = useState("");

  useEffect(() => {
    fetchBroadcasts();
    fetchCarousels();
  }, []);

  const fetchBroadcasts = async () => {
    try {
      const res  = await fetch(`${config.API_URL}/api/broadcasts/all`);
      const data = await res.json();
      setBroadcasts(Array.isArray(data) ? data : []);
    } catch {}
  };

  const fetchCarousels = async () => {
    try {
      const res  = await fetch(`${config.API_URL}/api/carousels/all`);
      const data = await res.json();
      setCarousels(Array.isArray(data) ? data : []);
    } catch {}
  };

  const toggleRole = (role) => {
    setBForm(prev => ({
      ...prev,
      target_roles: prev.target_roles.includes(role)
        ? prev.target_roles.filter(r => r !== role)
        : [...prev.target_roles, role],
    }));
  };

  const handleBroadcast = async (e) => {
    e.preventDefault();
    setBMessage(""); setBError("");
    if (!bForm.title.trim() || !bForm.body.trim()) { setBError("Title and message are required"); return; }
    if (bForm.target_roles.length === 0) { setBError("Select at least one target group"); return; }
    try {
      const res = await fetch(`${config.API_URL}/api/broadcasts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: bForm.title, body: bForm.body, target_roles: bForm.target_roles, created_by: user.id }),
      });
      const data = await res.json();
      if (!res.ok) { setBError(data.detail || "Failed"); return; }
      setBMessage("Broadcast sent! It will be visible for 7 days.");
      setBForm({ title: "", body: "", target_roles: [] });
      setShowBForm(false);
      fetchBroadcasts();
    } catch { setBError("Could not connect"); }
  };

  const handleCarousel = async (e) => {
    e.preventDefault();
    setCMessage(""); setCError("");
    if (!cMessage_text.trim()) { setCError("Message is required"); return; }
    if (cMessage_text.length > 200) { setCError("Max 200 characters"); return; }
    try {
      const res = await fetch(`${config.API_URL}/api/carousels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: cMessage_text, created_by: user.id }),
      });
      const data = await res.json();
      if (!res.ok) { setCError(data.detail || "Failed"); return; }
      setCMessage("Ticker message added! It will scroll for 24 hours.");
      setCMessageText("");
      setShowCForm(false);
      fetchCarousels();
    } catch { setCError("Could not connect"); }
  };

  const handleDeleteBroadcast = async (id) => {
    await fetch(`${config.API_URL}/api/broadcasts/${id}`, { method: "DELETE" });
    fetchBroadcasts();
  };

  const handleDeleteCarousel = async (id) => {
    await fetch(`${config.API_URL}/api/carousels/${id}`, { method: "DELETE" });
    fetchCarousels();
  };

  const activeBroadcasts  = broadcasts.filter(b => b.is_active && new Date(b.expires_at) > new Date());
  const expiredBroadcasts = broadcasts.filter(b => !b.is_active || new Date(b.expires_at) <= new Date());
  const activeCarousels   = carousels.filter(c => c.is_active && new Date(c.expires_at) > new Date());
  const expiredCarousels  = carousels.filter(c => !c.is_active || new Date(c.expires_at) <= new Date());

  return (
    <div className="page-content">
      <div className="dash-welcome">
        <h1>Broadcasts & Carousel</h1>
        <p>Send targeted messages to specific user groups, or add scrolling ticker messages for all users.</p>
      </div>

      {/* Type switcher */}
      <div className="bm-tabs" style={{ marginBottom: "24px" }}>
        <button className={`bm-tab ${subTab === "broadcast" ? "bm-tab-active" : ""}`}
          onClick={() => setSubTab("broadcast")}>
          📢 Broadcasts
        </button>
        <button className={`bm-tab ${subTab === "carousel" ? "bm-tab-active" : ""}`}
          onClick={() => setSubTab("carousel")}>
          🎠 Carousel Ticker
        </button>
      </div>

      {/* ── BROADCAST SUB-TAB ─────────────────────────────── */}
      {subTab === "broadcast" && (
        <div>
          {/* Info card */}
          <div className="broadcast-info-card" style={{ marginBottom: "20px" }}>
            <div style={{ fontWeight: 600, marginBottom: "4px" }}>📢 Broadcasts</div>
            <div className="book-meta">
              Broadcasts are detailed messages sent to specific user groups (students, librarians, HODs, or staff).
              They appear in the user's Notifications page under "Broadcasts" and remain visible for <strong>7 days</strong>.
              You can target one or more groups at once.
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "16px" }}>
            <button className="approve-btn" onClick={() => { setShowBForm(!showBForm); setBMessage(""); setBError(""); }}>
              {showBForm ? "Cancel" : "+ New Broadcast"}
            </button>
          </div>

          {showBForm && (
            <form onSubmit={handleBroadcast} className="book-form" style={{ marginBottom: "20px" }}>
              <div className="book-form-grid">
                <div className="float-field" style={{ gridColumn: "1 / -1" }}>
                  <input className="float-input" placeholder=" " value={bForm.title}
                    onChange={e => setBForm({ ...bForm, title: e.target.value })} required />
                  <label className="float-label">Broadcast Title *</label>
                </div>
              </div>
              <div className="float-field" style={{ marginTop: "10px" }}>
                <textarea className="float-input" placeholder=" "
                  style={{ minHeight: "100px", resize: "vertical", paddingTop: "20px" }}
                  value={bForm.body} onChange={e => setBForm({ ...bForm, body: e.target.value })} required />
                <label className="float-label">Message *</label>
              </div>

              {/* Target role checkboxes */}
              <div className="eligibility-section" style={{ marginTop: "12px" }}>
                <p className="eligibility-label">Send To (select one or more) *</p>
                <div className="eligibility-checks">
                  {ROLE_OPTIONS.map(({ value, label }) => (
                    <label key={value} className="check-item">
                      <input type="checkbox"
                        checked={bForm.target_roles.includes(value)}
                        onChange={() => toggleRole(value)} />
                      {label}
                    </label>
                  ))}
                </div>
                {bForm.target_roles.length > 0 && (
                  <div className="book-meta" style={{ marginTop: "8px", color: "#60a5fa" }}>
                    Will be sent to: {bForm.target_roles.map(r => r.charAt(0).toUpperCase() + r.slice(1)).join(", ")}
                  </div>
                )}
              </div>

              {bError   && <div className="error-box"   style={{ marginTop: "10px" }}>{bError}</div>}
              {bMessage && <div className="pending-box" style={{ marginTop: "10px" }}>{bMessage}</div>}
              <div className="book-meta" style={{ marginTop: "10px" }}>
                This broadcast will be visible to the selected users for 7 days.
              </div>
              <button type="submit" className="approve-btn" style={{ marginTop: "12px" }}>Send Broadcast</button>
            </form>
          )}

          {bMessage && !showBForm && <div className="pending-box" style={{ marginBottom: "12px" }}>{bMessage}</div>}

          <p className="section-title">Active Broadcasts ({activeBroadcasts.length})</p>
          {activeBroadcasts.length === 0 ? (
            <div className="empty-state" style={{ marginBottom: "20px" }}>No active broadcasts.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "24px" }}>
              {activeBroadcasts.map(b => (
                <div key={b.id} className="broadcast-card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div className="broadcast-title">{b.title}</div>
                      <div className="broadcast-body">{b.body}</div>
                      <div className="broadcast-meta">
                        <span>To: {(b.target_roles || "").split(",").map(r => r.charAt(0).toUpperCase() + r.slice(1)).join(", ")}</span>
                        <span style={{ margin: "0 8px" }}>·</span>
                        <span>Sent: {formatDate(b.created_at)}</span>
                        <span style={{ margin: "0 8px" }}>·</span>
                        <span style={{ color: "#4ade80" }}>{timeLeft(b.expires_at)}</span>
                      </div>
                    </div>
                    <button className="reject-btn" style={{ fontSize: "12px", padding: "5px 12px", marginLeft: "12px", flexShrink: 0 }}
                      onClick={() => handleDeleteBroadcast(b.id)}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {expiredBroadcasts.length > 0 && (
            <>
              <p className="section-title" style={{ color: "var(--muted)" }}>Expired / Removed ({expiredBroadcasts.length})</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {expiredBroadcasts.slice(0, 5).map(b => (
                  <div key={b.id} className="broadcast-card" style={{ opacity: 0.5 }}>
                    <div className="broadcast-title" style={{ fontSize: "13px" }}>{b.title}</div>
                    <div className="broadcast-meta">
                      Expired: {formatDateTime(b.expires_at)}
                      {" · "}To: {(b.target_roles || "").split(",").join(", ")}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── CAROUSEL SUB-TAB ──────────────────────────────── */}
      {subTab === "carousel" && (
        <div>
          {/* Info card */}
          <div className="carousel-info-card" style={{ marginBottom: "20px" }}>
            <div style={{ fontWeight: 600, marginBottom: "4px" }}>🎠 Carousel Ticker</div>
            <div className="book-meta">
              Carousel messages are short scrolling ticker messages that appear at the top of every page
              for <strong>all users</strong> (students, librarians, HODs, staff). They auto-expire after <strong>24 hours</strong>.
              Keep them short — max 200 characters. Multiple active messages scroll together.
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "16px" }}>
            <button className="approve-btn" onClick={() => { setShowCForm(!showCForm); setCMessage(""); setCError(""); }}>
              {showCForm ? "Cancel" : "+ Add Ticker Message"}
            </button>
          </div>

          {showCForm && (
            <form onSubmit={handleCarousel} className="book-form" style={{ marginBottom: "20px" }}>
              <div className="float-field">
                <input className="float-input" placeholder=" " value={cMessage_text}
                  maxLength={200}
                  onChange={e => setCMessageText(e.target.value)} required />
                <label className="float-label">Ticker Message * (max 200 chars)</label>
              </div>
              <div className="book-meta" style={{ marginTop: "6px" }}>
                {cMessage_text.length}/200 characters
                {cMessage_text.length > 0 && (
                  <span style={{ marginLeft: "12px" }}>
                    Preview: <span style={{ color: "#fbbf24" }}>📢 {cMessage_text}</span>
                  </span>
                )}
              </div>
              {cError   && <div className="error-box"   style={{ marginTop: "10px" }}>{cError}</div>}
              {cMessage && <div className="pending-box" style={{ marginTop: "10px" }}>{cMessage}</div>}
              <div className="book-meta" style={{ marginTop: "8px" }}>
                This message will scroll for all users for 24 hours.
              </div>
              <button type="submit" className="approve-btn" style={{ marginTop: "12px" }}>Add to Ticker</button>
            </form>
          )}

          {cMessage && !showCForm && <div className="pending-box" style={{ marginBottom: "12px" }}>{cMessage}</div>}

          {/* Live preview */}
          {activeCarousels.length > 0 && (
            <div style={{ marginBottom: "24px" }}>
              <p className="section-title">Live Ticker Preview</p>
              <div className="carousel-preview-bar">
                <div className="carousel-ticker">
                  {activeCarousels.map((c, i) => (
                    <span key={c.id} className="carousel-ticker-item">
                      📢 {c.message}
                      {i < activeCarousels.length - 1 && <span style={{ margin: "0 32px", opacity: 0.4 }}>•••</span>}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          <p className="section-title">Active Ticker Messages ({activeCarousels.length})</p>
          {activeCarousels.length === 0 ? (
            <div className="empty-state" style={{ marginBottom: "20px" }}>No active ticker messages.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "24px" }}>
              {activeCarousels.map(c => (
                <div key={c.id} className="carousel-msg-card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, color: "#fbbf24", fontSize: "14px" }}>📢 {c.message}</div>
                      <div className="broadcast-meta" style={{ marginTop: "4px" }}>
                        Added: {formatDateTime(c.created_at)}
                        <span style={{ margin: "0 8px" }}>·</span>
                        <span style={{ color: "#4ade80" }}>{timeLeft(c.expires_at)}</span>
                      </div>
                    </div>
                    <button className="reject-btn" style={{ fontSize: "12px", padding: "5px 12px", marginLeft: "12px", flexShrink: 0 }}
                      onClick={() => handleDeleteCarousel(c.id)}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {expiredCarousels.length > 0 && (
            <>
              <p className="section-title" style={{ color: "var(--muted)" }}>Expired / Removed ({expiredCarousels.length})</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {expiredCarousels.slice(0, 5).map(c => (
                  <div key={c.id} className="carousel-msg-card" style={{ opacity: 0.4 }}>
                    <div style={{ fontSize: "13px" }}>📢 {c.message}</div>
                    <div className="broadcast-meta">Expired: {formatDateTime(c.expires_at)}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}