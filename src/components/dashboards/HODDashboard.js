import { useState, useEffect } from "react";
import config from "../../config";
import UserCommunications from "../common/UserCommunications";
import RoleNotifications from "../common/RoleNotifications";
import ProfileMenu from "../common/ProfileMenu";
import LibraryAnalytics from "../common/LibraryAnalytics";

const NAV = [
  { key: "home", label: "Dashboard" },
  { key: "notifications", label: "Notifications" },
  { key: "approvals", label: "Account Approvals" },
  { key: "overrides", label: "Override Requests" },
  { key: "requests", label: "Book Requests" },
  { key: "limits", label: "Course Book Limits" },
  { key: "analytics", label: "Analytics & Reports" },
];

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function HODDashboard({ user, onLogout, darkMode, setDarkMode }) {
  const [activePage, setActivePage] = useState("home");

  return (
    <div className={`app-shell ${darkMode ? "dark" : "light"}`}>
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="sidebar-brand">Library Portal</div>
          <div className="sidebar-role tag-hod">HOD</div>
          <div className="sidebar-user">{user.roll_number}</div>
        </div>
        <nav className="sidebar-nav">
          {NAV.map(item => (
            <button key={item.key} className={`nav-item ${activePage === item.key ? "nav-item-active" : ""}`} onClick={() => setActivePage(item.key)}>
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
          <ProfileMenu user={user} roleLabel="HOD" roleClass="tag-hod" onLogout={onLogout} />
        </div>
        <UserCommunications user={user} />
        {activePage === "home" && <HODHome user={user} />}
        {activePage === "notifications" && (
          <RoleNotifications
            user={user}
            title="Notifications"
            subtitle="Broadcasts and announcements relevant to HOD users."
          />
        )}
        {activePage === "approvals" && <HODApprovals user={user} />}
        {activePage === "overrides" && <HODOverrides user={user} />}
        {activePage === "requests" && <HODBookRequests user={user} />}
        {activePage === "analytics" && <LibraryAnalytics />}
        {activePage === "limits" && <HODCourseLimits user={user} />}
      </main>
    </div>
  );
}

function HODHome({ user }) {
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${config.API_URL}/api/analytics/summary`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setAnalytics)
      .catch(() => setError("Could not load analytics. Is the backend running?"));
  }, []);

  return (
    <div className="page-content">
      <div className="dash-welcome">
        <h1>HOD Dashboard</h1>
        <p>Monitor library performance and manage approvals.</p>
      </div>
      {error && <div className="error-box" style={{ marginBottom: "16px" }}>{error}</div>}
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-value">{analytics?.total_books ?? "—"}</div><div className="stat-label">Total Books</div></div>
        <div className="stat-card"><div className="stat-value">{analytics?.issued_copies ?? "—"}</div><div className="stat-label">Books Issued</div></div>
        <div className="stat-card"><div className="stat-value" style={{ color: analytics?.overdue_copies > 0 ? "#f87171" : "inherit" }}>{analytics?.overdue_copies ?? "—"}</div><div className="stat-label">Overdue</div></div>
        <div className="stat-card"><div className="stat-value">{analytics?.pending_overrides ?? "—"}</div><div className="stat-label">Pending Overrides</div></div>
      </div>
      {analytics?.most_borrowed?.length > 0 && (
        <>
          <p className="section-title">Most Borrowed Books</p>
          <div className="approval-list">
            {analytics.most_borrowed.map((b, i) => (
              <div className="approval-card" key={i}>
                <div className="approval-info">
                  <span className="approval-roll">#{i + 1}</span>
                  <span className="approval-email">{b.title}</span>
                  <span className="book-meta">{b.author}</span>
                </div>
                <div className="book-meta">{b.borrow_count} issue{b.borrow_count !== 1 ? "s" : ""}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function HODApprovals({ user }) {
  const [pendingUsers, setPendingUsers] = useState([]);
  const [message, setMessage] = useState("");

  useEffect(() => { fetchPending(); }, []);

  const fetchPending = async () => {
    const res = await fetch(`${config.API_URL}/api/hod/pending-users`);
    const data = await res.json();
    setPendingUsers(data);
  };

  const handleAction = async (userId, action) => {
    const res = await fetch(`${config.API_URL}/api/hod/approve-user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, action }),
    });
    const data = await res.json();
    setMessage(data.message);
    fetchPending();
  };

  return (
    <div className="page-content">
      <div className="dash-welcome">
        <h1>Account Approvals</h1>
        <p>Review and approve librarian and staff account requests.</p>
      </div>
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-value">{pendingUsers.length}</div><div className="stat-label">Pending</div></div>
      </div>
      {message && <div className="pending-box" style={{ marginBottom: "16px" }}>{message}</div>}
      {pendingUsers.length === 0 ? (
        <div className="empty-state">No pending account approvals.</div>
      ) : (
        <div className="approval-list">
          {pendingUsers.map(u => (
            <div className="approval-card" key={u.id}>
              <div className="approval-info">
                <span className="approval-roll">{u.roll_number}</span>
                <span className="approval-email">{u.email}</span>
                <span className={`dash-role-tag tag-${u.role}`}>{u.role}</span>
              </div>
              <div className="approval-actions">
                <button className="approve-btn" onClick={() => handleAction(u.id, "approve")}>Approve</button>
                <button className="reject-btn" onClick={() => handleAction(u.id, "reject")}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HODOverrides({ user }) {
  const [overrides, setOverrides] = useState([]);
  const [comment, setComment] = useState({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { fetchOverrides(); }, []);

  const fetchOverrides = async () => {
    const res = await fetch(`${config.API_URL}/api/overrides/pending`);
    const data = await res.json();
    setOverrides(data);
  };

  const handleReview = async (overrideId, action) => {
    setMessage("");
    setError("");
    if (!comment[overrideId]) { setError("A comment is required before approving or rejecting"); return; }
    const res = await fetch(`${config.API_URL}/api/overrides/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ override_id: overrideId, action, comment: comment[overrideId], reviewed_by: user.id }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.detail || "Failed"); return; }
    setMessage(data.message);
    fetchOverrides();
  };

  return (
    <div className="page-content">
      <div className="dash-welcome">
        <h1>Override Requests</h1>
        <p>Review and act on librarian override requests. A comment is required for every decision.</p>
      </div>
      {message && <div className="pending-box" style={{ marginBottom: "16px" }}>{message}</div>}
      {error && <div className="error-box" style={{ marginBottom: "16px" }}>{error}</div>}
      {overrides.length === 0 ? (
        <div className="empty-state">No pending override requests.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {overrides.map(o => (
            <div className="bm-detail-panel" key={o.id}>
              <div className="bm-detail-grid">
                <div className="detail-card"><div className="detail-label">Requested By</div><div className="detail-value">{o.requester?.roll_number || o.requested_by}</div></div>
                <div className="detail-card"><div className="detail-label">Affected Record</div><div className="detail-value code-value">{o.affected_record}</div></div>
                <div className="detail-card"><div className="detail-label">Submitted</div><div className="detail-value">{formatDate(o.created_at)}</div></div>
              </div>
              <div className="detail-card" style={{ marginTop: "12px" }}>
                <div className="detail-label">Reason</div>
                <div className="detail-value">{o.reason}</div>
              </div>
              <div className="float-field" style={{ marginTop: "12px" }}>
                <textarea
                  className="float-input"
                  placeholder=" "
                  style={{ minHeight: "70px", resize: "vertical", paddingTop: "20px" }}
                  value={comment[o.id] || ""}
                  onChange={e => setComment({ ...comment, [o.id]: e.target.value })}
                />
                <label className="float-label">Your Comment (required)</label>
              </div>
              <div className="approval-actions" style={{ marginTop: "10px" }}>
                <button className="approve-btn" onClick={() => handleReview(o.id, "approve")}>Approve</button>
                <button className="reject-btn" onClick={() => handleReview(o.id, "reject")}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HODBookRequests({ user }) {
  const [requests, setRequests] = useState([]);
  const [filter, setFilter] = useState("pending");
  const [comments, setComments] = useState({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Intentional: re-fetch only when the filter changes. Adding the helper to the list would re-run it on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchRequests(); }, [filter]);

  const fetchRequests = async () => {
    const params = new URLSearchParams({ status: filter });
    const res = await fetch(`${config.API_URL}/api/book-requests?${params}`);
    const data = await res.json();
    setRequests(Array.isArray(data) ? data : []);
  };

  const handleReview = async (requestId, action) => {
    setMessage(""); setError("");
    try {
      const res = await fetch(`${config.API_URL}/api/book-requests/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: requestId,
          action,
          comment: comments[requestId] || null,
          reviewed_by: user.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.detail || "Failed"); return; }
      setMessage(data.message);
      fetchRequests();
    } catch { setError("Could not connect"); }
  };

  const TYPE_LABELS = { new: "New Book", copies: "More Copies" };
  const STATUS_COLORS = { pending: "#fbbf24", approved: "#4ade80", rejected: "#f87171" };

  return (
    <div className="page-content">
      <div className="dash-welcome">
        <h1>Book Requests</h1>
        <p>Review book requests from students and procurement requests from librarians.</p>
      </div>

      {/* Filter tabs */}
      <div className="bm-tabs" style={{ marginBottom: "20px" }}>
        {["pending", "approved", "rejected"].map(s => (
          <button key={s} className={`bm-tab ${filter === s ? "bm-tab-active" : ""}`}
            onClick={() => setFilter(s)}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {message && <div className="pending-box" style={{ marginBottom: "12px" }}>{message}</div>}
      {error && <div className="error-box" style={{ marginBottom: "12px" }}>{error}</div>}

      {requests.length === 0 ? (
        <div className="empty-state">No {filter} requests.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {requests.map(r => (
            <div key={r.id} className="bm-detail-panel">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                <div>
                  <div className="book-title" style={{ fontSize: "15px" }}>{r.title}</div>
                  {r.author && <div className="book-meta">Author: {r.author}</div>}
                  {r.isbn && <div className="book-meta">ISBN: {r.isbn}</div>}
                  {r.reason && (
                    <div className="book-meta" style={{ marginTop: "6px" }}>
                      Reason: {r.reason}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="course-tag" style={{ marginBottom: "6px" }}>
                    {TYPE_LABELS[r.request_type] || r.request_type}
                  </div>
                  <div style={{ color: STATUS_COLORS[r.status], fontWeight: 700, fontSize: "13px" }}>
                    {r.status.toUpperCase()}
                  </div>
                </div>
              </div>

              <div className="bm-detail-grid" style={{ marginBottom: "10px" }}>
                <div className="detail-card">
                  <div className="detail-label">Requested By</div>
                  <div className="detail-value">{r.requester?.roll_number || r.requested_by}</div>
                </div>
                <div className="detail-card">
                  <div className="detail-label">Type</div>
                  <div className="detail-value">{r.requester?.role || "—"}</div>
                </div>
                <div className="detail-card">
                  <div className="detail-label">Submitted</div>
                  <div className="detail-value">
                    {new Date(r.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </div>
                </div>
              </div>

              {r.status === "pending" && (
                <>
                  <div className="float-field" style={{ marginBottom: "10px" }}>
                    <textarea
                      className="float-input"
                      placeholder=" "
                      style={{ minHeight: "60px", resize: "vertical", paddingTop: "20px" }}
                      value={comments[r.id] || ""}
                      onChange={e => setComments({ ...comments, [r.id]: e.target.value })}
                    />
                    <label className="float-label">Comment (optional)</label>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button className="approve-btn" onClick={() => handleReview(r.id, "approved")}>
                      Approve
                    </button>
                    <button className="reject-btn" onClick={() => handleReview(r.id, "rejected")}>
                      Reject
                    </button>
                  </div>
                </>
              )}

              {r.hod_comment && r.status !== "pending" && (
                <div className="book-meta" style={{ marginTop: "8px", color: "#60a5fa" }}>
                  Comment: {r.hod_comment}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HODCourseLimits({ user }) {
  const COURSE_OPTIONS = {
    CS: "Computer Science", AI: "AI/ML", EC: "ECE",
    EE: "EEE", ME: "Mechanical Engineering",
    CV: "Civil Engineering", BT: "Biotechnology",
  };

  const [limits, setLimits] = useState({});
  const [editing, setEditing] = useState({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { fetchLimits(); }, []);

  const fetchLimits = async () => {
    const res = await fetch(`${config.API_URL}/api/course-limits`);
    const data = await res.json();
    const map = {};
    data.forEach(l => { map[l.course_prefix] = l.max_books; });
    setLimits(map);
    setEditing({ ...map });
  };

  const handleSave = async (prefix) => {
    setMessage(""); setError("");
    const val = parseInt(editing[prefix]);
    if (!val || val < 1 || val > 20) { setError("Value must be between 1 and 20"); return; }
    const res = await fetch(`${config.API_URL}/api/course-limits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ course_prefix: prefix, max_books: val, set_by: user.id }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.detail || "Failed"); return; }
    setMessage(`Limit for ${prefix} set to ${val} books`);
    fetchLimits();
  };

  return (
    <div className="page-content">
      <div className="dash-welcome">
        <h1>Course Book Limits</h1>
        <p>Set the maximum number of books students of each course can borrow at one time.</p>
      </div>

      {message && <div className="pending-box" style={{ marginBottom: "16px" }}>{message}</div>}
      {error && <div className="error-box" style={{ marginBottom: "16px" }}>{error}</div>}

      <div className="course-limits-grid">
        {Object.entries(COURSE_OPTIONS).map(([prefix, label]) => (
          <div className="course-limit-card" key={prefix}>
            <div className="course-limit-header">
              <span className="course-tag" style={{ fontSize: "13px", padding: "3px 10px" }}>{prefix}</span>
              <span className="detail-value">{label}</span>
            </div>
            <div className="course-limit-body">
              <div className="float-field" style={{ flex: 1 }}>
                <input
                  type="number"
                  className="float-input"
                  min="1"
                  max="20"
                  value={editing[prefix] ?? limits[prefix] ?? 3}
                  onChange={e => setEditing({ ...editing, [prefix]: e.target.value })}
                  placeholder=" "
                />
                <label className="float-label">Max Books</label>
              </div>
              <button className="approve-btn" style={{ padding: "8px 16px" }} onClick={() => handleSave(prefix)}>
                Save
              </button>
            </div>
            <div className="book-meta" style={{ marginTop: "6px" }}>
              Current limit: <strong>{limits[prefix] ?? 3}</strong> books
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}