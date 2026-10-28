import { useState, useEffect } from "react";
import config from "../../../config";

export default function StudentAnalytics({ user }) {
  const [issued, setIssued] = useState(null);
  const [history, setHistory] = useState(null);
  const [fines, setFines] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch(`${config.API_URL}/api/student/issued/${user.id}`).then(r => r.json()),
      fetch(`${config.API_URL}/api/student/history/${user.id}`).then(r => r.json()),
      fetch(`${config.API_URL}/api/fines/student/${encodeURIComponent(user.roll_number)}`).then(r => r.json()),
    ]).then(([i, h, f]) => {
      setIssued(i);
      setHistory(Array.isArray(h) ? h : []);
      setFines(Array.isArray(f) ? f : []);
    }).catch(() => setError("Could not load your analytics."));
  }, [user.id, user.roll_number]);

  if (error) return <div className="page-content"><div className="error-box">{error}</div></div>;
  if (!issued || !history || !fines) return <div className="page-content"><div className="empty-state">Loading...</div></div>;

  const booksRead = history.length;
  const totalBorrows = history.reduce((sum, h) => sum + (h.times_borrowed || 0), 0);
  const totalRenewals = history.reduce((sum, h) => sum + (h.times_renewed || 0), 0);
  const pendingFines = fines.reduce((sum, f) => sum + (f.remaining || 0), 0);

  // Top authors by number of times borrowed
  const authorCounts = {};
  history.forEach(h => {
    const author = h.book_author || "Unknown";
    authorCounts[author] = (authorCounts[author] || 0) + (h.times_borrowed || 1);
  });
  const topAuthors = Object.entries(authorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const topBooks = [...history]
    .sort((a, b) => (b.times_borrowed || 0) - (a.times_borrowed || 0))
    .slice(0, 8);

  return (
    <div className="page-content">
      <div className="dash-welcome">
        <h1>My Analytics</h1>
        <p>Your reading activity at a glance.</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card"><div className="stat-value">{booksRead}</div><div className="stat-label">Books Read (All-Time)</div></div>
        <div className="stat-card"><div className="stat-value">{issued.issued?.length ?? 0}</div><div className="stat-label">Currently Issued</div></div>
        <div className="stat-card"><div className="stat-value">{totalBorrows}</div><div className="stat-label">Total Times Borrowed</div></div>
        <div className="stat-card"><div className="stat-value">{totalRenewals}</div><div className="stat-label">Total Renewals</div></div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: pendingFines > 0 ? "#f87171" : "inherit" }}>
            Rs. {pendingFines}
          </div>
          <div className="stat-label">Pending Fines</div>
        </div>
      </div>

      {topAuthors.length > 0 && (
        <>
          <p className="section-title" style={{ marginTop: "28px" }}>Authors You Read Most</p>
          <div className="approval-list" style={{ marginBottom: "24px" }}>
            {topAuthors.map(([author, count], i) => (
              <div className="approval-card" key={author}>
                <div className="approval-info">
                  <span className="approval-roll">#{i + 1}</span>
                  <span className="approval-email">{author}</span>
                </div>
                <div className="notif-badge notif-waiting">{count} issue{count !== 1 ? "s" : ""}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="section-title">Your Reading History</p>
      {topBooks.length === 0 ? (
        <div className="empty-state">No borrow history yet. Once you start borrowing books, your stats will show up here.</div>
      ) : (
        <div className="approval-list">
          {topBooks.map((b, i) => (
            <div className="approval-card" key={b.book_id}>
              <div className="approval-info">
                <span className="approval-roll">#{i + 1}</span>
                <div>
                  <div className="book-title" style={{ fontSize: "14px" }}>{b.book_title}</div>
                  <div className="book-meta">{b.book_author}</div>
                </div>
              </div>
              <div className="notif-badge notif-waiting">
                {b.times_borrowed} borrow{b.times_borrowed !== 1 ? "s" : ""}
                {b.times_renewed > 0 && ` · ${b.times_renewed} renewal${b.times_renewed !== 1 ? "s" : ""}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}