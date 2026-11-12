import { useState, useEffect } from "react";
import config from "../../../config";

const COURSE_MAP = {
  CS: "Computer Science", AI: "AI/ML", EC: "ECE",
  EE: "EEE", ME: "Mechanical Engineering",
  CV: "Civil Engineering", BT: "Biotechnology",
};

function detectCourse(rollNumber) {
  const roll = rollNumber.toUpperCase();
  const sorted = Object.entries(COURSE_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [prefix, name] of sorted) {
    if (roll.includes(prefix)) return { prefix, name };
  }
  return null;
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function calcFrontendFine(due_date) {
  if (!due_date) return 0;
  const now = new Date();
  const due = new Date(due_date);
  if (due >= now) return 0;
  const days = Math.max(1, Math.floor((now - due) / (1000 * 60 * 60 * 24)));
  return days * 5;
}

function StarRating({ value, onChange, readonly }) {
  return (
    <div className="star-rating">
      {[1, 2, 3, 4, 5].map(star => (
        <span
          key={star}
          className={`star ${star <= value ? "star-filled" : "star-empty"}`}
          onClick={() => !readonly && onChange && onChange(star)}
          style={{ cursor: readonly ? "default" : "pointer" }}
        >
          ★
        </span>
      ))}
    </div>
  );
}

function WishlistButton({ bookId, userId }) {
  const [inWishlist, setInWishlist] = useState(false);
  const [wishlistId, setWishlistId] = useState(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch(`${config.API_URL}/api/wishlist/${userId}/check/${bookId}`)
      .then(r => r.json())
      .then(data => {
        setInWishlist(data.in_wishlist);
        setWishlistId(data.wishlist_id);
      })
      .catch(() => {});
  }, [bookId, userId]);

  const handleToggle = async () => {
    setMsg("");
    if (inWishlist) {
      await fetch(`${config.API_URL}/api/wishlist/${wishlistId}`, { method: "DELETE" });
      setInWishlist(false);
      setWishlistId(null);
      setMsg("Removed from wishlist");
    } else {
      const res = await fetch(
        `${config.API_URL}/api/wishlist?user_id=${userId}&book_id=${bookId}`,
        { method: "POST" }
      );
      const data = await res.json();
      if (res.ok) {
        setInWishlist(true);
        setWishlistId(data.id);
        setMsg("Added to wishlist");
      }
    }
  };

  return (
    <div style={{ marginTop: "10px" }}>
      <button
        className={inWishlist ? "reject-btn" : "logout-btn"}
        style={{ fontSize: "13px", padding: "7px 16px" }}
        onClick={handleToggle}
      >
        {inWishlist ? "♥ Remove from Wishlist" : "♡ Save to Wishlist"}
      </button>
      {msg && <div className="book-meta" style={{ marginTop: "4px", color: "#60a5fa" }}>{msg}</div>}
    </div>
  );
}

function BookCard({ book, onClick }) {
  return (
    <div className="rec-card" onClick={() => onClick(book)}>
      {book.cover_image ? (
        <img src={book.cover_image} alt="Cover" className="rec-cover" />
      ) : (
        <div className="rec-cover-placeholder">No Cover</div>
      )}
      <div className="rec-info">
        <div className="rec-title">{book.title}</div>
        <div className="rec-meta">{book.author}</div>
        <div className="rec-meta">{book.subject}</div>
        <div className={`rec-avail ${book.available_copies > 0 ? "avail-yes" : "avail-no"}`}>
          {book.available_copies > 0 ? `${book.available_copies} available` : "Not available"}
        </div>
      </div>
    </div>
  );
}

function RenewButton({ item, userId, onRenewed }) {
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRenew = async () => {
    setMsg(""); setErr(""); setLoading(true);
    try {
      const res = await fetch(`${config.API_URL}/api/books/renew`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ copy_code: item.copy_code, user_id: userId }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.detail || "Failed to renew"); return; }
      setMsg(data.message);
      onRenewed();
    } catch { setErr("Could not connect to server"); }
    finally { setLoading(false); }
  };

  const fineToShow = Math.max(item.fine_amount || 0, calcFrontendFine(item.due_date));

  if (item.renew_status === "overdue") {
    return (
      <div style={{ textAlign: "right" }}>
        <div style={{ color: "#f87171", fontSize: "12px", fontWeight: 700 }}>OVERDUE</div>
        <div style={{ color: "#f87171", fontSize: "11px" }}>Fine: Rs. {fineToShow}</div>
        <div style={{ color: "#9ca3af", fontSize: "11px" }}>Return the book to clear fine</div>
      </div>
    );
  }

  if (item.renew_status === "too_early") {
    return (
      <div style={{ textAlign: "right" }}>
        <div className="book-meta">Renewal opens 3 days before due date</div>
      </div>
    );
  }

  if (item.renew_status === "can_renew") {
    return (
      <div style={{ textAlign: "right" }}>
        {msg ? (
          <div className="pending-box" style={{ padding: "6px 10px", fontSize: "12px" }}>{msg}</div>
        ) : err ? (
          <div className="error-box" style={{ padding: "6px 10px", fontSize: "12px" }}>{err}</div>
        ) : (
          <button
            className="approve-btn"
            style={{ fontSize: "12px", padding: "6px 14px" }}
            onClick={handleRenew}
            disabled={loading}
          >
            {loading ? "Renewing..." : "Renew (+14 days)"}
          </button>
        )}
        <div className="book-meta" style={{ marginTop: "4px" }}>
          Renewal #{item.renewal_count}
        </div>
      </div>
    );
  }

  return null;
}

function ReviewSection({ bookId, userId }) {
  const [reviews, setReviews] = useState([]);
  const [myReview, setMyReview] = useState(null);
  const [rating, setRating] = useState(0);
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    fetchReviews();
    fetchMyReview();
  // Intentional: re-fetch only when the book changes. Adding the helper to the list would re-run it on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  const fetchReviews = async () => {
    try {
      const res = await fetch(`${config.API_URL}/api/books/${bookId}/reviews`);
      const data = await res.json();
      setReviews(Array.isArray(data) ? data : []);
    } catch { setReviews([]); }
  };

  const fetchMyReview = async () => {
    try {
      const res = await fetch(`${config.API_URL}/api/books/${bookId}/my-review?user_id=${userId}`);
      if (res.ok) {
        const data = await res.json();
        if (data) {
          setMyReview(data);
          setRating(data.rating);
          setNotes(data.notes || "");
        }
      }
    } catch {}
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMsg(""); setErr("");
    if (!rating) { setErr("Please select a star rating"); return; }
    try {
      const res = await fetch(`${config.API_URL}/api/books/${bookId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId, user_id: userId, rating, notes }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.detail || "Failed to submit review"); return; }
      setMsg(myReview ? "Review updated!" : "Review submitted!");
      setMyReview(data);
      fetchReviews();
    } catch { setErr("Could not connect to server"); }
  };

  const avgRating = reviews.length > 0
    ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
    : null;

  return (
    <div className="review-section">
      <div className="review-header">
        <p className="section-title" style={{ margin: 0 }}>Reviews</p>
        {avgRating && (
          <div className="review-avg">
            <StarRating value={Math.round(parseFloat(avgRating))} readonly />
            <span className="review-avg-num">
              {avgRating} / 5 ({reviews.length} review{reviews.length !== 1 ? "s" : ""})
            </span>
          </div>
        )}
      </div>

      <div className="review-form-card">
        <p className="eligibility-label">{myReview ? "Update Your Review" : "Write a Review"}</p>
        <p className="book-meta" style={{ marginBottom: "8px" }}>
          Anonymous — other students will not see your identity
        </p>
        <form onSubmit={handleSubmit}>
          <StarRating value={rating} onChange={setRating} />
          <textarea
            className="review-textarea"
            placeholder="Share your thoughts about this book (optional)..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
          />
          {msg && <div className="pending-box" style={{ marginTop: "8px", padding: "8px 12px", fontSize: "13px" }}>{msg}</div>}
          {err && <div className="error-box" style={{ marginTop: "8px", padding: "8px 12px", fontSize: "13px" }}>{err}</div>}
          <button type="submit" className="approve-btn" style={{ marginTop: "10px", fontSize: "13px" }}>
            {myReview ? "Update Review" : "Submit Review"}
          </button>
        </form>
      </div>

      {reviews.length === 0 ? (
        <div className="empty-state" style={{ padding: "20px" }}>No reviews yet. Be the first!</div>
      ) : (
        <div className="reviews-list">
          {reviews.map(r => (
            <div className="review-card" key={r.id}>
              <div className="review-card-header">
                <StarRating value={r.rating} readonly />
                <span className="review-anon">Anonymous Student</span>
                <span className="review-date">{formatDate(r.created_at)}</span>
              </div>
              {r.notes && <p className="review-notes">{r.notes}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FineBreakdown({ fineRecords, liveFines }) {
  if (fineRecords.length === 0 && liveFines.length === 0) return null;

  return (
    <div className="fine-breakdown">
      <p className="section-title" style={{ margin: "0 0 10px 0" }}>Fine Breakdown</p>

      {liveFines.map((item, i) => (
        <div className="fine-row" key={`live-${i}`}>
          <div>
            <div className="fine-book-title">{item.book_title}</div>
            <div className="book-meta">Copy: {item.copy_code} — Overdue (not yet returned)</div>
          </div>
          <div className="fine-amount-col">
            <div className="fine-amount">Rs. {item.fine}</div>
            <div className="fine-status fine-status-pending">Pending</div>
          </div>
        </div>
      ))}

      {fineRecords.map(f => (
        <div className="fine-row" key={f.id}>
          <div>
            <div className="fine-book-title">{f.book_title}</div>
            <div className="book-meta">Copy: {f.copy_code}</div>
            <div className="book-meta">Total: Rs. {f.total_fine} | Paid: Rs. {f.amount_paid}</div>
          </div>
          <div className="fine-amount-col">
            <div className="fine-amount" style={{ color: "#f87171" }}>Rs. {f.remaining} remaining</div>
            <div className="fine-status fine-status-partial">Partial Payment</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function StudentHome({ user, onNavigate }) {
  const [studentData, setStudentData] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [selectedBook, setSelectedBook] = useState(null);
  const [bookStatus, setBookStatus] = useState(null);
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedReview, setExpandedReview] = useState(null);
  const [showFineBreakdown, setShowFineBreakdown] = useState(false);

  const detectedCourse = detectCourse(user.roll_number);

  useEffect(() => {
    fetchStudentData();
    fetchRecommendations();
  // Intentional: load once on mount. Adding the helper to the list would re-run it on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchStudentData = async () => {
    setLoading(true);
    try {
      await fetch(`${config.API_URL}/api/maintenance/expire-reservations`, { method: "POST" });
      const res = await fetch(`${config.API_URL}/api/student/issued/${user.id}`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setStudentData(data);
    } catch (err) {
      console.error("Could not load student data:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchRecommendations = async () => {
    try {
      const res = await fetch(
        `${config.API_URL}/api/books/recommendations?roll_number=${encodeURIComponent(user.roll_number)}&limit=6`
      );
      const data = await res.json();
      setRecommendations(Array.isArray(data) ? data : []);
    } catch {}
  };

  const handleSelectBook = async (book) => {
    setSelectedBook(book);
    setActionMessage(""); setActionError("");
    try {
      const res = await fetch(`${config.API_URL}/api/books/${book.id}/student-status?user_id=${user.id}`);
      const data = await res.json();
      setBookStatus(data);
    } catch { setBookStatus(null); }
  };

  // Compute pending fines — combine live overdue + uncleared fine records
  const liveFines = (studentData?.issued || [])
    .filter(item => item.is_overdue)
    .map(item => ({
      book_title: item.book_title,
      copy_code: item.copy_code,
      fine: Math.max(item.fine_amount || 0, calcFrontendFine(item.due_date)),
    }));

  const fineRecords = studentData?.fine_records || [];
  const fineRecordTotal = fineRecords.reduce((sum, f) => sum + f.remaining, 0);
  const liveFineTotal = liveFines.reduce((sum, f) => sum + f.fine, 0);
  const totalPendingFines = fineRecordTotal + liveFineTotal;
  const hasPendingFines = totalPendingFines > 0;

  const handleReserve = async () => {
    setActionMessage(""); setActionError("");
    if (hasPendingFines) {
      setActionError(`You have pending fines of Rs. ${totalPendingFines}. Please pay your fines at the library counter before reserving books.`);
      return;
    }
    const res = await fetch(`${config.API_URL}/api/books/reserve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ book_id: selectedBook.id, user_id: user.id, roll_number: user.roll_number }),
    });
    const data = await res.json();
    if (!res.ok) { setActionError(data.detail || "Could not reserve"); return; }
    setActionMessage(data.message);
    handleSelectBook(selectedBook);
    fetchStudentData();
  };

  const handleNotifyMe = async () => {
    setActionMessage(""); setActionError("");
    const res = await fetch(`${config.API_URL}/api/notifications/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ book_id: selectedBook.id, user_id: user.id }),
    });
    const data = await res.json();
    if (!res.ok) { setActionError(data.detail || "Could not add to queue"); return; }
    setActionMessage(data.message);
    handleSelectBook(selectedBook);
  };

  // ── Book detail view ──────────────────────────────────────
  if (selectedBook) {
    return (
      <div className="page-content">
        <button className="back-btn" onClick={() => {
          setSelectedBook(null); setBookStatus(null);
          setActionMessage(""); setActionError("");
        }}>
          ← Back
        </button>

        <div className="bm-detail-panel" style={{ marginTop: "16px" }}>
          <div style={{ display: "flex", gap: "20px", alignItems: "flex-start" }}>
            {selectedBook.cover_image ? (
              <img src={selectedBook.cover_image} alt="Cover" className="book-cover-large" />
            ) : (
              <div className="book-cover-placeholder-large">No Cover</div>
            )}
            <div style={{ flex: 1 }}>
              <h3 className="bm-detail-title">{selectedBook.title}</h3>
              <p className="book-meta">
                {selectedBook.author} &bull; {selectedBook.subject} &bull; Ed. {selectedBook.edition}
              </p>
              <p className="book-meta" style={{ marginTop: "6px" }}>ISBN: {selectedBook.isbn}</p>
              <p className="book-meta">Type: {selectedBook.media_type} — {selectedBook.book_type}</p>
              <p className="book-meta">MRP: Rs. {selectedBook.mrp}</p>
              {selectedBook.courses && (
                <p className="book-meta">
                  Courses: {selectedBook.courses.split(",").map(c => (
                    <span key={c} className="course-tag">{c}</span>
                  ))}
                </p>
              )}

              <div style={{ marginTop: "16px" }}>
                {actionMessage && (
                  <div className="pending-box" style={{ marginBottom: "10px" }}>{actionMessage}</div>
                )}
                {actionError && (
                  <div className="error-box" style={{ marginBottom: "10px" }}>{actionError}</div>
                )}

                {bookStatus?.status === "available" && !actionMessage && (
                  hasPendingFines ? (
                    <div className="fine-block-notice">
                      <div style={{ fontWeight: 600, marginBottom: "4px" }}>
                        Cannot Reserve — Pending Fines: Rs. {totalPendingFines}
                      </div>
                      <div style={{ fontSize: "13px" }}>
                        Please pay your outstanding fines at the library counter to reserve books.
                      </div>
                    </div>
                  ) : (
                    <button className="approve-btn" onClick={handleReserve}>
                      Reserve This Book
                    </button>
                  )
                )}

                {bookStatus?.status === "reserved" && (
                  <div className="pending-box">
                    You have reserved this book. Visit the library within 24 hours to collect it.
                    {bookStatus.expires_at && (
                      <div style={{ marginTop: "4px", color: "#fbbf24" }}>
                        Expires: {new Date(bookStatus.expires_at).toLocaleString()}
                      </div>
                    )}
                  </div>
                )}

                {bookStatus?.status === "issued" && (
                  <div className="role-warning">
                    You currently have this book. Due: {formatDate(bookStatus.due_date)}
                  </div>
                )}

                {bookStatus?.status === "limit_reached" && (
                  <div className="role-warning">{bookStatus.message}</div>
                )}

                {bookStatus?.status === "unavailable" && !actionMessage &&
                  selectedBook.book_type !== "reference" && (
                    <button className="approve-btn" onClick={handleNotifyMe}>
                      Notify Me When Available
                    </button>
                  )
                }

                {bookStatus?.status === "queued" && (
                  <div className="role-warning">{bookStatus.message}</div>
                )}

                {bookStatus?.message && !actionMessage && (
                  <p className="book-meta" style={{ marginTop: "8px" }}>{bookStatus.message}</p>
                )}

                {/* Wishlist button */}
                <WishlistButton bookId={selectedBook.id} userId={user.id} />
              </div>
            </div>
          </div>

          <ReviewSection bookId={selectedBook.id} userId={user.id} />
        </div>
      </div>
    );
  }

  const stats = studentData?.stats || {
    total_issued: 0, total_reserved: 0, due_soon: 0,
    pending_fines: 0, book_limit: 3, slots_remaining: 3,
  };
  const issuedBooks = studentData?.issued || [];
  const reservedBooks = studentData?.reserved || [];

  // ── Main dashboard view ───────────────────────────────────
  return (
    <div className="page-content">
      {user.is_blocked && (
        <div className="notice-card" style={{ marginBottom: "20px" }}>
          Your account is blocked due to unpaid fines. Please visit the library to resolve.
        </div>
      )}

      <div className="dash-welcome">
        <h1>Welcome, {user.roll_number}</h1>
        <p>Manage your borrowed books, renewals, and fines here.</p>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{loading ? "—" : stats.total_issued}</div>
          <div className="stat-label">Books Borrowed</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: stats.due_soon > 0 ? "#fbbf24" : "inherit" }}>
            {loading ? "—" : stats.due_soon}
          </div>
          <div className="stat-label">Due Soon</div>
        </div>
        <div className="stat-card"
          style={{ cursor: totalPendingFines > 0 ? "pointer" : "default" }}
          onClick={() => totalPendingFines > 0 && setShowFineBreakdown(!showFineBreakdown)}
        >
          <div className="stat-value" style={{ color: totalPendingFines > 0 ? "#f87171" : "inherit" }}>
            {loading ? "—" : `Rs. ${totalPendingFines}`}
          </div>
          <div className="stat-label">
            Pending Fines {totalPendingFines > 0 ? "(click for details)" : ""}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{loading ? "—" : `${stats.slots_remaining} / ${stats.book_limit}`}</div>
          <div className="stat-label">Slots Available</div>
        </div>
      </div>

      {/* Fine breakdown — expandable */}
      {showFineBreakdown && (
        <FineBreakdown fineRecords={fineRecords} liveFines={liveFines} />
      )}

      {/* Fine warning banner */}
      {hasPendingFines && (
        <div className="fine-block-notice" style={{ marginBottom: "16px" }}>
          <div style={{ fontWeight: 600 }}>
            Outstanding Fines: Rs. {totalPendingFines}
          </div>
          <div style={{ fontSize: "13px", marginTop: "4px" }}>
            You cannot reserve new books until all fines are paid. Visit the library counter to pay.
          </div>
        </div>
      )}

      {/* Currently borrowed */}
      <p className="section-title">Currently Borrowed</p>
      {loading ? (
        <div className="empty-state" style={{ marginBottom: "24px" }}>Loading...</div>
      ) : issuedBooks.length === 0 ? (
        <div className="empty-state" style={{ marginBottom: "24px" }}>No books currently borrowed.</div>
      ) : (
        <div className="student-books-list" style={{ marginBottom: "8px" }}>
          {issuedBooks.map((item, i) => (
            <div key={i}>
              <div className={`student-book-row ${
                item.is_overdue ? "book-row-overdue" :
                item.is_due_soon ? "book-row-due-soon" : ""
              }`}>
                {item.cover_image ? (
                  <img src={item.cover_image} alt="Cover" className="book-cover-thumb" />
                ) : (
                  <div className="book-cover-thumb-placeholder">No Cover</div>
                )}
                <div className="book-card-info">
                  <div className="book-title">{item.book_title}</div>
                  <div className="book-meta">{item.book_author}</div>
                  <div className="book-meta">
                    Copy: <span className="code-value" style={{ fontSize: "11px" }}>{item.copy_code}</span>
                  </div>
                  <button
                    className="back-btn"
                    style={{ fontSize: "12px", marginTop: "4px" }}
                    onClick={() => setExpandedReview(expandedReview === item.book_id ? null : item.book_id)}
                  >
                    {expandedReview === item.book_id ? "Hide Review" : "Leave a Review"}
                  </button>
                </div>
                <div style={{ textAlign: "right", minWidth: "140px" }}>
                  <div className="book-meta">Issued: {formatDate(item.issued_at)}</div>
                  <div className="book-meta" style={{
                    color: item.is_overdue ? "#f87171" : item.is_due_soon ? "#fbbf24" : "inherit",
                    fontWeight: (item.is_overdue || item.is_due_soon) ? 600 : "normal"
                  }}>
                    Due: {formatDate(item.due_date)}
                  </div>
                  <RenewButton item={item} userId={user.id} onRenewed={fetchStudentData} />
                </div>
              </div>

              {expandedReview === item.book_id && (
                <div style={{ marginBottom: "12px" }}>
                  <ReviewSection bookId={item.book_id} userId={user.id} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Reserved */}
      {reservedBooks.length > 0 && (
        <>
          <p className="section-title" style={{ marginTop: "8px" }}>Reserved — Pending Collection</p>
          <div className="student-books-list" style={{ marginBottom: "24px" }}>
            {reservedBooks.map((item, i) => (
              <div key={i} className="student-book-row">
                {item.cover_image ? (
                  <img src={item.cover_image} alt="Cover" className="book-cover-thumb" />
                ) : (
                  <div className="book-cover-thumb-placeholder">No Cover</div>
                )}
                <div className="book-card-info">
                  <div className="book-title">{item.book_title}</div>
                  <div className="book-meta">{item.book_author}</div>
                  <div className="book-meta">
                    Copy: <span className="code-value" style={{ fontSize: "11px" }}>{item.copy_code}</span>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="pending-box" style={{ padding: "6px 12px", fontSize: "12px" }}>
                    Visit library to collect
                  </div>
                  {item.reservation_expires_at && (
                    <div className="book-meta" style={{ marginTop: "4px", color: "#fbbf24" }}>
                      Expires: {new Date(item.reservation_expires_at).toLocaleString()}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Recommendations */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
        <p className="section-title" style={{ margin: 0 }}>Recommended for You</p>
        <button className="back-btn" onClick={() => onNavigate("search")}>Browse all →</button>
      </div>
      {detectedCourse && (
        <p className="book-meta" style={{ marginBottom: "14px" }}>
          Based on your course: {detectedCourse.name}
        </p>
      )}
      {recommendations.length === 0 ? (
        <div className="empty-state">No recommendations yet.</div>
      ) : (
        <div className="rec-grid">
          {recommendations.map(book => (
            <BookCard key={book.id} book={book} onClick={handleSelectBook} />
          ))}
        </div>
      )}
    </div>
  );
}
