import { useState } from "react";
import config from "../../../config";

const COURSE_OPTIONS = {
  CS: "Computer Science", AI: "AI/ML", EC: "ECE",
  EE: "EEE", ME: "Mechanical Engineering",
  CV: "Civil Engineering", BT: "Biotechnology",
};

function FloatInput({ label, name, value, onChange }) {
  return (
    <div className="float-field">
      <input
        name={name}
        type="text"
        className="float-input"
        value={value}
        onChange={onChange}
        placeholder=" "
      />
      <label className="float-label">{label}</label>
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function StarRating({ value, readonly }) {
  return (
    <div className="star-rating">
      {[1, 2, 3, 4, 5].map(star => (
        <span
          key={star}
          className={`star ${star <= value ? "star-filled" : "star-empty"}`}
          style={{ cursor: "default", fontSize: "16px" }}
        >
          ★
        </span>
      ))}
    </div>
  );
}

function BookStatusBadge({ status }) {
  const map = {
    available:     { label: "Available",          cls: "status-badge-available" },
    issued:        { label: "Issued to You",       cls: "status-badge-issued" },
    notified:      { label: "Awaiting Visit",      cls: "status-badge-notified" },
    reserved:      { label: "Reserved by You",     cls: "status-badge-reserved" },
    queued:        { label: "In Queue",            cls: "status-badge-reserved" },
    unavailable:   { label: "Unavailable",         cls: "status-badge-unavailable" },
    limit_reached: { label: "Limit Reached",       cls: "status-badge-unavailable" },
  };
  const s = map[status] || { label: status, cls: "" };
  return <span className={`status-badge ${s.cls}`}>{s.label}</span>;
}

function ReviewsPanel({ bookId }) {
  const [reviews, setReviews] = useState(null);
  const [show, setShow] = useState(false);

  const load = async () => {
    if (reviews !== null) { setShow(!show); return; }
    const res = await fetch(`${config.API_URL}/api/books/${bookId}/reviews`);
    const data = await res.json();
    setReviews(Array.isArray(data) ? data : []);
    setShow(true);
  };

  const avg = reviews?.length > 0
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : null;

  return (
    <div style={{ marginTop: "16px" }}>
      <button className="logout-btn" style={{ fontSize: "13px" }} onClick={load}>
        {show ? "Hide Reviews" : `Show Reviews${avg ? ` (${avg}★)` : ""}`}
      </button>
      {show && reviews && (
        <div style={{ marginTop: "12px" }}>
          {reviews.length === 0 ? (
            <div className="book-meta">No reviews yet.</div>
          ) : reviews.map(r => (
            <div className="review-card" key={r.id} style={{ marginBottom: "8px" }}>
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

export default function StudentSearch({ user }) {
  const [query, setQuery] = useState({ isbn: "", title: "", author: "", subject: "" });
  const [filters, setFilters] = useState({ media_type: "all", availability: "all", course: "all" });
  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [selectedBook, setSelectedBook] = useState(null);
  const [bookStatus, setBookStatus] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");

  // Check pending fines from student-status API
  const [hasFines, setHasFines] = useState(false);
  const [fineAmount, setFineAmount] = useState(0);

  const hasAnyQuery =
    query.isbn || query.title || query.author || query.subject ||
    filters.media_type !== "all" || filters.availability !== "all" || filters.course !== "all";

  const handleSearch = async (e) => {
    e.preventDefault();
    setSearchError("");
    if (!hasAnyQuery) {
      setSearchError("Please enter at least one search field or filter");
      return;
    }
    const params = new URLSearchParams();
    if (query.isbn) params.append("isbn", query.isbn);
    if (query.title) params.append("title", query.title);
    if (query.author) params.append("author", query.author);
    if (query.subject) params.append("subject", query.subject);
    if (filters.media_type !== "all") params.append("media_type", filters.media_type);
    if (filters.availability !== "all") params.append("availability", filters.availability);
    if (filters.course !== "all") params.append("course", filters.course);

    const res = await fetch(`${config.API_URL}/api/books/search?${params}`);
    const data = await res.json();
    if (!res.ok) { setSearchError(data.detail || "Search failed"); return; }
    setResults(data);
    setSearched(true);
    setSelectedBook(null);
    setBookStatus(null);
  };

  const handleSelectBook = async (book) => {
    setSelectedBook(book);
    setActionMessage(""); setActionError("");
    setLoadingStatus(true);

    // Check fines by loading student data
    try {
      const fineRes = await fetch(`${config.API_URL}/api/student/issued/${user.id}`);
      if (fineRes.ok) {
        const fineData = await fineRes.json();
        const pending = fineData.stats?.pending_fines || 0;
        setHasFines(pending > 0);
        setFineAmount(pending);
      }
    } catch {}

    try {
      const res = await fetch(`${config.API_URL}/api/books/${book.id}/student-status?user_id=${user.id}`);
      const data = await res.json();
      setBookStatus(data);
    } catch { setBookStatus(null); }
    finally { setLoadingStatus(false); }
  };

  const handleReserve = async () => {
    setActionMessage(""); setActionError("");
    if (hasFines) {
      setActionError(`You have pending fines of Rs. ${fineAmount}. Please pay at the library counter before reserving.`);
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
          ← Back to Results
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
              <p className="book-meta">Added: {formatDate(selectedBook.created_at)}</p>
              {selectedBook.courses && (
                <p className="book-meta">
                  Courses: {selectedBook.courses.split(",").map(c => (
                    <span key={c} className="course-tag">{c}</span>
                  ))}
                </p>
              )}

              <div style={{ marginTop: "16px" }}>
                {loadingStatus ? (
                  <p className="book-meta">Checking availability...</p>
                ) : bookStatus ? (
                  <>
                    <BookStatusBadge status={bookStatus.status} />
                    <p className="book-meta" style={{ marginTop: "8px" }}>{bookStatus.message}</p>

                    {actionMessage && (
                      <div className="pending-box" style={{ marginTop: "10px" }}>{actionMessage}</div>
                    )}
                    {actionError && (
                      <div className="error-box" style={{ marginTop: "10px" }}>{actionError}</div>
                    )}

                    {bookStatus.status === "available" && !actionMessage && (
                      hasFines ? (
                        <div className="fine-block-notice" style={{ marginTop: "10px" }}>
                          <div style={{ fontWeight: 600, marginBottom: "4px" }}>
                            Cannot Reserve — Pending Fines: Rs. {fineAmount}
                          </div>
                          <div style={{ fontSize: "13px" }}>
                            Please pay your outstanding fines at the library counter to reserve books.
                          </div>
                        </div>
                      ) : (
                        <button
                          className="approve-btn"
                          style={{ marginTop: "10px" }}
                          onClick={handleReserve}
                        >
                          Reserve This Book
                        </button>
                      )
                    )}

                    {bookStatus.status === "reserved" && (
                      <div className="pending-box" style={{ marginTop: "10px" }}>
                        Visit the library within 24 hours to collect your copy.
                        {bookStatus.expires_at && (
                          <div style={{ marginTop: "4px", color: "#fbbf24" }}>
                            Expires: {new Date(bookStatus.expires_at).toLocaleString()}
                          </div>
                        )}
                      </div>
                    )}

                    {bookStatus.status === "issued" && (
                      <div className="role-warning" style={{ marginTop: "10px" }}>
                        You currently have this book. Due: {formatDate(bookStatus.due_date)}
                      </div>
                    )}

                    {bookStatus.status === "unavailable" && !actionMessage &&
                      selectedBook.book_type !== "reference" && (
                        <button
                          className="approve-btn"
                          style={{ marginTop: "10px" }}
                          onClick={handleNotifyMe}
                        >
                          Notify Me When Available
                          {bookStatus.queue_length > 0 && ` (${bookStatus.queue_length} waiting)`}
                        </button>
                      )
                    }

                    {bookStatus.status === "limit_reached" && (
                      <div className="role-warning" style={{ marginTop: "10px" }}>
                        {bookStatus.message}
                      </div>
                    )}

                    {bookStatus.status === "queued" && (
                      <div className="role-warning" style={{ marginTop: "10px" }}>
                        {bookStatus.message}
                      </div>
                    )}

                    {selectedBook.book_type === "reference" && (
                      <div className="role-warning" style={{ marginTop: "10px" }}>
                        This is a {selectedBook.media_type === "magazine" ? "magazine" : "reference book"} — library use only, cannot be issued.
                      </div>
                    )}
                  </>
                ) : null}
              </div>

              {/* Reviews visible to all students */}
              <ReviewsPanel bookId={selectedBook.id} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Search form ───────────────────────────────────────────
  return (
    <div className="page-content">
      <div className="dash-welcome">
        <h1>Search Books</h1>
        <p>Enter any field to search. Use filters to narrow results.</p>
      </div>

      <form onSubmit={handleSearch} className="book-form">
        <div className="book-form-grid">
          <FloatInput label="ISBN" name="isbn" value={query.isbn}
            onChange={e => setQuery({ ...query, isbn: e.target.value })} />
          <FloatInput label="Title" name="title" value={query.title}
            onChange={e => setQuery({ ...query, title: e.target.value })} />
          <FloatInput label="Author" name="author" value={query.author}
            onChange={e => setQuery({ ...query, author: e.target.value })} />
          <FloatInput label="Subject" name="subject" value={query.subject}
            onChange={e => setQuery({ ...query, subject: e.target.value })} />
        </div>

        <div style={{ marginTop: "12px" }}>
          <button
            type="button"
            className="logout-btn"
            onClick={() => setShowFilters(!showFilters)}
          >
            {showFilters ? "Hide Filters" : "Show Filters"}
          </button>
        </div>

        {showFilters && (
          <div className="filters-panel">
            <div className="filter-group">
              <p className="eligibility-label">Media Type</p>
              <div className="eligibility-checks">
                {["all", "book", "magazine"].map(v => (
                  <label key={v} className="check-item">
                    <input
                      type="radio"
                      name="media_type"
                      value={v}
                      checked={filters.media_type === v}
                      onChange={e => setFilters({ ...filters, media_type: e.target.value })}
                    />
                    {v === "all" ? "All" : v.charAt(0).toUpperCase() + v.slice(1)}
                  </label>
                ))}
              </div>
            </div>
            <div className="filter-group">
              <p className="eligibility-label">Availability</p>
              <div className="eligibility-checks">
                {[
                  ["all", "All"],
                  ["available", "Available Now"],
                  ["unavailable", "Currently Unavailable"],
                ].map(([v, l]) => (
                  <label key={v} className="check-item">
                    <input
                      type="radio"
                      name="availability"
                      value={v}
                      checked={filters.availability === v}
                      onChange={e => setFilters({ ...filters, availability: e.target.value })}
                    />
                    {l}
                  </label>
                ))}
              </div>
            </div>
            <div className="filter-group">
              <p className="eligibility-label">Course</p>
              <div className="eligibility-checks" style={{ flexWrap: "wrap" }}>
                <label className="check-item">
                  <input
                    type="radio"
                    name="course"
                    value="all"
                    checked={filters.course === "all"}
                    onChange={e => setFilters({ ...filters, course: e.target.value })}
                  />
                  All Courses
                </label>
                {Object.entries(COURSE_OPTIONS).map(([prefix, label]) => (
                  <label key={prefix} className="check-item">
                    <input
                      type="radio"
                      name="course"
                      value={prefix}
                      checked={filters.course === prefix}
                      onChange={e => setFilters({ ...filters, course: e.target.value })}
                    />
                    <span className="course-tag" style={{ marginRight: "4px" }}>{prefix}</span>
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {searchError && (
          <div className="error-box" style={{ marginTop: "10px" }}>{searchError}</div>
        )}
        <button type="submit" className="button" style={{ marginTop: "12px" }}>Search</button>
      </form>

      {searched && (
        <>
          <p className="section-title" style={{ marginTop: "20px" }}>
            {results.length === 0 ? "No books found" : `${results.length} result(s)`}
          </p>
          <div className="book-grid-2col">
            {results.map(book => (
              <div
                className="book-card book-card-clickable"
                key={book.id}
                onClick={() => handleSelectBook(book)}
              >
                {book.cover_image ? (
                  <img src={book.cover_image} alt="Cover" className="book-cover-thumb" />
                ) : (
                  <div className="book-cover-thumb-placeholder">No Cover</div>
                )}
                <div className="book-card-info">
                  <div className="book-title">{book.title}</div>
                  <div className="book-meta">{book.author} &bull; {book.subject}</div>
                  <div className="book-meta">ISBN: {book.isbn}</div>
                  {book.courses && (
                    <div style={{ marginTop: "2px" }}>
                      {book.courses.split(",").map(c => (
                        <span key={c} className="course-tag">{c}</span>
                      ))}
                    </div>
                  )}
                  <div className={`rec-avail ${book.available_copies > 0 ? "avail-yes" : "avail-no"}`}>
                    {book.available_copies > 0
                      ? `${book.available_copies} / ${book.total_copies} available`
                      : `0 / ${book.total_copies} — all issued`}
                  </div>
                </div>
                <div className="book-card-arrow">›</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}