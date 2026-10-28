import { useState, useEffect } from "react";
import config from "../../../config";

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

const TABS = [
  { key: "notifications", label: "Notifications" },
  { key: "history", label: "Reading History" },
  { key: "wishlist", label: "Wishlist" },
  { key: "requests", label: "Book Requests" },
];

export default function StudentNotifications({ user }) {
  const [activeTab, setActiveTab] = useState("notifications");

  return (
    <div className="page-content">
      <div className="dash-welcome">
        <h1>Notifications & Library</h1>
        <p>Your notifications, reading history, wishlist and book requests.</p>
      </div>

      {/* Tab bar */}
      <div className="bm-tabs" style={{ marginBottom: "20px" }}>
        {TABS.map(t => (
          <button
            key={t.key}
            className={`bm-tab ${activeTab === t.key ? "bm-tab-active" : ""}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "notifications" && <NotificationsTab user={user} />}
      {activeTab === "history"       && <ReadingHistoryTab user={user} />}
      {activeTab === "wishlist"      && <WishlistTab user={user} />}
      {activeTab === "requests"      && <BookRequestsTab user={user} />}
    </div>
  );
}

// ── Notifications tab (existing + announcements) ──────────────
function NotificationsTab({ user }) {
  const [notifications, setNotifications] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [broadcasts, setBroadcasts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [notifRes, annRes, broadcastRes] = await Promise.all([
        fetch(`${config.API_URL}/api/notifications/user/${user.id}`),
        fetch(`${config.API_URL}/api/announcements`),
        fetch(`${config.API_URL}/api/broadcasts?role=${encodeURIComponent(user.role)}`),
      ]);
      const notifs = await notifRes.json();
      const anns = await annRes.json();
      const broadcastData = await broadcastRes.json();
      setNotifications(Array.isArray(notifs) ? notifs : []);
      setAnnouncements(Array.isArray(anns) ? anns : []);
      setBroadcasts(Array.isArray(broadcastData) ? broadcastData : []);
    } catch {}
    finally { setLoading(false); }
  };

  const handleCancel = async (notifId) => {
    await fetch(`${config.API_URL}/api/notifications/${notifId}`, { method: "DELETE" });
    setMessage("Removed from queue");
    fetchAll();
  };

  if (loading) return <div className="empty-state">Loading...</div>;

  return (
    <div>
      {broadcasts.length > 0 && (
        <>
          <p className="section-title">Broadcast Messages</p>
          <div className="user-broadcast-list" style={{ marginBottom: "24px" }}>
            {broadcasts.map((broadcast) => (
              <article key={broadcast.id} className="broadcast-card">
                <div className="broadcast-title">{broadcast.title}</div>
                <div className="broadcast-body">{broadcast.body}</div>
                <div className="broadcast-meta">
                  Visible until {formatDateTime(broadcast.expires_at)}
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {/* Announcements */}
      {announcements.length > 0 && (
        <>
          <p className="section-title">📢 Library Announcements</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "24px" }}>
            {announcements.map(a => (
              <div key={a.id} className="announcement-card">
                <div className="announcement-title">{a.title}</div>
                <div className="announcement-body">{a.body}</div>
                <div className="announcement-meta">
                  Posted: {formatDate(a.created_at)}
                  {a.expires_at && ` · Expires: ${formatDate(a.expires_at)}`}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Queue notifications */}
      <p className="section-title">Book Availability Queue</p>
      {message && <div className="pending-box" style={{ marginBottom: "12px" }}>{message}</div>}
      {notifications.length === 0 ? (
        <div className="empty-state">No active notifications.</div>
      ) : (
        <div className="notif-list">
          {notifications.map(n => (
            <div key={n.id} className={`notif-card ${n.status === "notified" ? "notif-card-active" : ""}`}>
              <div className="notif-book-info">
                {n.book?.cover_image ? (
                  <img src={n.book.cover_image} alt="Cover" className="book-cover-thumb" />
                ) : (
                  <div className="book-cover-thumb-placeholder">No Cover</div>
                )}
                <div>
                  <div className="book-title">{n.book?.title || "Unknown"}</div>
                  <div className="book-meta">{n.book?.author}</div>
                </div>
              </div>
              <div className="notif-status-section">
                {n.status === "notified" ? (
                  <>
                    <span className="notif-badge notif-ready">Available for You!</span>
                    <div className="book-meta" style={{ marginTop: "6px", color: "#fbbf24" }}>
                      Expires: {formatDateTime(n.expires_at)}
                    </div>
                  </>
                ) : (
                  <>
                    <span className="notif-badge notif-waiting">
                      #{n.queue_position} in Queue
                    </span>
                    <button
                      className="logout-btn"
                      style={{ marginTop: "8px", fontSize: "12px" }}
                      onClick={() => handleCancel(n.id)}
                    >
                      Leave Queue
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Reading History tab ───────────────────────────────────────
function ReadingHistoryTab({ user }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    fetch(`${config.API_URL}/api/student/history/${user.id}`)
      .then(r => r.json())
      .then(data => setHistory(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="empty-state">Loading history...</div>;
  if (history.length === 0) {
    return <div className="empty-state">No reading history yet. Borrow your first book!</div>;
  }

  const EVENT_LABELS = {
    issued: { label: "Borrowed", color: "#60a5fa" },
    returned: { label: "Returned", color: "#4ade80" },
    returned_damaged: { label: "Returned (Damaged)", color: "#fbbf24" },
    reported_lost: { label: "Reported Lost", color: "#f87171" },
    renewed: { label: "Renewed", color: "#a78bfa" },
  };

  return (
    <div>
      <p className="section-title">
        {history.length} book{history.length !== 1 ? "s" : ""} in your reading history
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {history.map(item => (
          <div key={item.book_id} className="history-book-card">
            <div className="history-book-header" onClick={() => setExpanded(expanded === item.book_id ? null : item.book_id)}>
              <div style={{ display: "flex", gap: "14px", alignItems: "center", flex: 1 }}>
                {item.cover_image ? (
                  <img src={item.cover_image} alt="Cover" className="book-cover-thumb" />
                ) : (
                  <div className="book-cover-thumb-placeholder">No Cover</div>
                )}
                <div>
                  <div className="book-title">{item.book_title}</div>
                  <div className="book-meta">{item.book_author}</div>
                  <div className="book-meta" style={{ marginTop: "4px" }}>
                    Borrowed {item.times_borrowed} time{item.times_borrowed !== 1 ? "s" : ""}
                    {item.times_renewed > 0 && ` · Renewed ${item.times_renewed} time${item.times_renewed !== 1 ? "s" : ""}`}
                    {" · "}Last activity: {formatDate(item.last_activity)}
                  </div>
                </div>
              </div>
              <button className="back-btn" style={{ fontSize: "18px", padding: "0 8px" }}>
                {expanded === item.book_id ? "▲" : "▼"}
              </button>
            </div>

            {expanded === item.book_id && (
              <div className="history-events">
                {item.events.map((ev, i) => {
                  const evMeta = EVENT_LABELS[ev.type] || { label: ev.type, color: "#9ca3af" };
                  return (
                    <div key={i} className="history-event-row">
                      <div className="history-event-dot" style={{ background: evMeta.color }} />
                      <div style={{ flex: 1 }}>
                        <span style={{ color: evMeta.color, fontWeight: 600, fontSize: "12px" }}>
                          {evMeta.label}
                        </span>
                        <span className="book-meta" style={{ marginLeft: "8px" }}>
                          {formatDate(ev.date)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Wishlist tab ──────────────────────────────────────────────
function WishlistTab({ user }) {
  const [wishlist, setWishlist] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => { fetchWishlist(); }, []);

  const fetchWishlist = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${config.API_URL}/api/wishlist/${user.id}`);
      const data = await res.json();
      setWishlist(Array.isArray(data) ? data : []);
    } catch {}
    finally { setLoading(false); }
  };

  const handleRemove = async (wishlistId, title) => {
    await fetch(`${config.API_URL}/api/wishlist/${wishlistId}`, { method: "DELETE" });
    setMessage(`'${title}' removed from wishlist`);
    fetchWishlist();
  };

  if (loading) return <div className="empty-state">Loading wishlist...</div>;

  return (
    <div>
      <p className="section-title">
        {wishlist.length === 0 ? "Your wishlist is empty" : `${wishlist.length} book${wishlist.length !== 1 ? "s" : ""} saved`}
      </p>
      {message && <div className="pending-box" style={{ marginBottom: "12px" }}>{message}</div>}
      {wishlist.length === 0 ? (
        <div className="empty-state">
          No books saved yet. While browsing books, click "Save to Wishlist" to add them here.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {wishlist.map(item => (
            <div key={item.id} className="student-book-row">
              {item.cover_image ? (
                <img src={item.cover_image} alt="Cover" className="book-cover-thumb" />
              ) : (
                <div className="book-cover-thumb-placeholder">No Cover</div>
              )}
              <div className="book-card-info">
                <div className="book-title">{item.book_title}</div>
                <div className="book-meta">{item.book_author}</div>
                <div className="book-meta">Saved: {formatDate(item.added_at)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className={`rec-avail ${item.available_copies > 0 ? "avail-yes" : "avail-no"}`}>
                  {item.available_copies > 0 ? `${item.available_copies} available` : "Not available"}
                </div>
                {item.book_type === "borrowable" && item.available_copies > 0 && (
                  <div className="book-meta" style={{ marginTop: "4px", color: "#60a5fa" }}>
                    Go to Search to reserve
                  </div>
                )}
                <button
                  className="reject-btn"
                  style={{ marginTop: "8px", fontSize: "12px", padding: "4px 12px" }}
                  onClick={() => handleRemove(item.id, item.book_title)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Book Requests tab ─────────────────────────────────────────
function BookRequestsTab({ user }) {
  const [myRequests, setMyRequests] = useState([]);
  const [form, setForm] = useState({ title: "", author: "", isbn: "", reason: "" });
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchRequests(); }, []);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${config.API_URL}/api/book-requests/user/${user.id}`);
      const data = await res.json();
      setMyRequests(Array.isArray(data) ? data : []);
    } catch {}
    finally { setLoading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(""); setError("");
    if (!form.title.trim()) { setError("Title is required"); return; }
    try {
      const res = await fetch(`${config.API_URL}/api/book-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requested_by: user.id,
          title: form.title,
          author: form.author || null,
          isbn: form.isbn || null,
          reason: form.reason || null,
          request_type: "new",
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.detail || "Failed"); return; }
      setMessage("Book request submitted! The library will review it.");
      setForm({ title: "", author: "", isbn: "", reason: "" });
      setShowForm(false);
      fetchRequests();
    } catch { setError("Could not connect"); }
  };

  const STATUS_COLORS = {
    pending: "#fbbf24",
    approved: "#4ade80",
    rejected: "#f87171",
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <p className="section-title" style={{ margin: 0 }}>Request a Book</p>
        <button
          className="approve-btn"
          onClick={() => { setShowForm(!showForm); setMessage(""); setError(""); }}
        >
          {showForm ? "Cancel" : "+ New Request"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="book-form" style={{ marginBottom: "20px" }}>
          <p className="book-meta" style={{ marginBottom: "12px" }}>
            Request a book the library doesn't currently have. The HOD will review your request.
          </p>
          <div className="book-form-grid">
            <div className="float-field">
              <input className="float-input" placeholder=" " value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })} required />
              <label className="float-label">Book Title *</label>
            </div>
            <div className="float-field">
              <input className="float-input" placeholder=" " value={form.author}
                onChange={e => setForm({ ...form, author: e.target.value })} />
              <label className="float-label">Author (optional)</label>
            </div>
            <div className="float-field">
              <input className="float-input" placeholder=" " value={form.isbn}
                onChange={e => setForm({ ...form, isbn: e.target.value })} />
              <label className="float-label">ISBN (optional)</label>
            </div>
          </div>
          <div className="float-field" style={{ marginTop: "10px" }}>
            <textarea
              className="float-input"
              placeholder=" "
              style={{ minHeight: "70px", resize: "vertical", paddingTop: "20px" }}
              value={form.reason}
              onChange={e => setForm({ ...form, reason: e.target.value })}
            />
            <label className="float-label">Why do you need this book? (optional)</label>
          </div>
          {error && <div className="error-box" style={{ marginTop: "10px" }}>{error}</div>}
          <button type="submit" className="approve-btn" style={{ marginTop: "12px" }}>
            Submit Request
          </button>
        </form>
      )}

      {message && <div className="pending-box" style={{ marginBottom: "16px" }}>{message}</div>}

      <p className="section-title">Your Previous Requests</p>
      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : myRequests.length === 0 ? (
        <div className="empty-state">No book requests yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {myRequests.map(r => (
            <div key={r.id} className="bm-detail-panel" style={{ padding: "16px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div className="book-title" style={{ fontSize: "14px" }}>{r.title}</div>
                  {r.author && <div className="book-meta">Author: {r.author}</div>}
                  {r.isbn && <div className="book-meta">ISBN: {r.isbn}</div>}
                  {r.reason && <div className="book-meta" style={{ marginTop: "4px" }}>Reason: {r.reason}</div>}
                  <div className="book-meta" style={{ marginTop: "6px" }}>
                    Submitted: {formatDate(r.created_at)}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{
                    fontWeight: 700, fontSize: "13px",
                    color: STATUS_COLORS[r.status] || "#9ca3af",
                    textTransform: "capitalize",
                  }}>
                    {r.status}
                  </div>
                  {r.hod_comment && (
                    <div className="book-meta" style={{ marginTop: "4px", maxWidth: "200px" }}>
                      Note: {r.hod_comment}
                    </div>
                  )}
                  {r.reviewed_at && (
                    <div className="book-meta">{formatDate(r.reviewed_at)}</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
