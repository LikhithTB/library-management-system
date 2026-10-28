import { useState, useEffect, useRef } from "react";
import config from "../../../config";

const REPLACEMENT_PERCENT = 90;

const COURSE_OPTIONS = {
  CS: "Computer Science",
  AI: "AI/ML",
  EC: "ECE",
  EE: "EEE",
  ME: "Mechanical Engineering",
  CV: "Civil Engineering",
  BT: "Biotechnology",
};

const EMPTY_FORM = {
  isbn: "",
  title: "",
  author: "",
  subject: "",
  edition: "",
  courses: [],
  media_type: "book",
  mrp: "",
  total_copies: "1",
  entry_date: "",
  elig_students: true,
  elig_teaching_staff: false,
  elig_non_teaching_staff: false,
  replacement_percent: REPLACEMENT_PERCENT,
  cover_image: null,
};

function eligibilityLabel(book) {
  const s = [];
  if (book.elig_students) s.push("Students");
  if (book.elig_teaching_staff) s.push("Teaching Staff");
  if (book.elig_non_teaching_staff) s.push("Non-Teaching Staff");
  if (s.length === 3) return "All";
  if (s.length === 0) return "None";
  return s.join(", ");
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function FloatInput({ label, name, type = "text", value, onChange, required, disabled, min }) {
  return (
    <div className="float-field">
      <input
        name={name}
        type={type}
        className="float-input"
        value={value}
        onChange={onChange}
        required={required}
        disabled={disabled}
        min={min}
        placeholder=" "
      />
      <label className="float-label">{label}</label>
    </div>
  );
}

export default function BookManagement({ user }) {
  const [books, setBooks] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedBook, setSelectedBook] = useState(null);
  const [selectedCopy, setSelectedCopy] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const fileInputRef = useRef(null);

  useEffect(() => { fetchBooks(); }, []);

  const fetchBooks = async () => {
    try {
      const res = await fetch(`${config.API_URL}/api/books`);
      const data = await res.json();
      setBooks(data);
    } catch (err) {
      setError("Could not connect to server. Is the backend running?");
    }
  };

  const fetchHistory = async (bookId) => {
    const res = await fetch(`${config.API_URL}/api/books/${bookId}/history`);
    const data = await res.json();
    setHistory(data);
    setShowHistory(true);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm({ ...form, [name]: type === "checkbox" ? checked : value });
  };

  const handleCourseToggle = (prefix) => {
    const updated = form.courses.includes(prefix)
      ? form.courses.filter(c => c !== prefix)
      : [...form.courses, prefix];
    setForm({ ...form, courses: updated });
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setForm(prev => ({ ...prev, cover_image: reader.result }));
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (form.media_type === "book") {
      if (!form.elig_students && !form.elig_teaching_staff && !form.elig_non_teaching_staff) {
        setError("Please select at least one eligibility group");
        return;
      }
    }

    if (!form.entry_date) {
      setError("Please enter the entry date");
      return;
    }

    const body = {
      ...form,
      courses: form.courses.length > 0 ? form.courses.join(",") : null,
      mrp: parseFloat(form.mrp),
      total_copies: parseInt(form.total_copies),
      replacement_percent: parseInt(form.replacement_percent),
      added_by: user.id,
    };

    const res = await fetch(`${config.API_URL}/api/books`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok) { setError(data.detail || "Failed to add book"); return; }

    setMessage("Book added successfully");
    setForm(EMPTY_FORM);
    setShowForm(false);
    fetchBooks();
  };

  const handleDeactivate = async (bookId) => {
    if (!window.confirm("Deactivate this book? This cannot be undone.")) return;
    const res = await fetch(
      `${config.API_URL}/api/books/${bookId}?changed_by=${user.id}`,
      { method: "DELETE" }
    );
    const data = await res.json();
    if (!res.ok) { setError(data.detail || "Failed"); return; }
    setMessage(data.message);
    setSelectedBook(null);
    fetchBooks();
  };

  const replacementPreview = form.mrp
    ? `Rs. ${(parseFloat(form.mrp) * (form.replacement_percent / 100)).toFixed(2)}`
    : "—";

  const previewCode = form.isbn && form.entry_date
    ? `${form.media_type === "book" ? "BK" : "MZ"}-${form.isbn.replace(/-/g, "")}-${form.entry_date}`
    : "—";

  const totalCopies = parseInt(form.total_copies) || 0;

  // ── Copy detail view ──────────────────────────────────────
  if (selectedCopy) {
    return (
      <div className="page-content">
        <button className="back-btn" onClick={() => setSelectedCopy(null)}>← Back to Copies</button>
        <div className="bm-detail-panel" style={{ marginTop: "16px" }}>
          <h3 className="bm-detail-title">Copy Details</h3>
          <div className="bm-detail-grid" style={{ marginTop: "16px" }}>
            <div className="detail-card">
              <div className="detail-label">Copy Code</div>
              <div className="detail-value code-value">{selectedCopy.copy_code}</div>
            </div>
            <div className="detail-card">
              <div className="detail-label">Status</div>
              <div className={`copy-status-badge status-${selectedCopy.status}`}>
                {selectedCopy.status}
              </div>
            </div>
            <div className="detail-card">
              <div className="detail-label">Condition Note</div>
              <div className="detail-value">{selectedCopy.condition_note || "—"}</div>
            </div>
            <div className="detail-card">
              <div className="detail-label">Added On</div>
              <div className="detail-value">{formatDate(selectedCopy.added_at)}</div>
            </div>

            {selectedCopy.status === "reserved" && (
              <div className="detail-card">
                <div className="detail-label">Reserved By</div>
                <div className="detail-value" style={{ color: "#fbbf24", fontWeight: 600 }}>
                  {selectedCopy.reserved_by_roll || "—"}
                </div>
              </div>
            )}

            {selectedCopy.status === "issued" && (
              <>
                <div className="detail-card">
                  <div className="detail-label">Issued To (Roll No.)</div>
                  <div className="detail-value" style={{ color: "#60a5fa", fontWeight: 600 }}>
                    {selectedCopy.issued_to_roll || "—"}
                  </div>
                </div>
                <div className="detail-card">
                  <div className="detail-label">Issued On</div>
                  <div className="detail-value">{formatDate(selectedCopy.issued_at)}</div>
                </div>
                <div className="detail-card">
                  <div className="detail-label">Due Date</div>
                  <div className="detail-value" style={{ color: "#f87171", fontWeight: 600 }}>
                    {formatDate(selectedCopy.due_date)}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Master book detail view ───────────────────────────────
  if (selectedBook) {
    return (
      <div className="page-content">
        <button className="back-btn" onClick={() => { setSelectedBook(null); setShowHistory(false); }}>
          ← Back to Books
        </button>

        <div className="bm-detail-panel" style={{ marginTop: "16px" }}>
          <div className="bm-detail-header">
            <div style={{ display: "flex", gap: "20px", alignItems: "flex-start" }}>
              {selectedBook.cover_image ? (
                <img src={selectedBook.cover_image} alt="Cover" className="book-cover-large" />
              ) : (
                <div className="book-cover-placeholder-large">No Cover</div>
              )}
              <div>
                <h3 className="bm-detail-title">{selectedBook.title}</h3>
                <p className="book-meta">
                  {selectedBook.author} &bull; {selectedBook.subject} &bull; Ed. {selectedBook.edition}
                </p>
                {selectedBook.courses && (
                  <div style={{ marginTop: "6px" }}>
                    {selectedBook.courses.split(",").map(c => (
                      <span key={c} className="course-tag">{c}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
              <button className="logout-btn" onClick={() => fetchHistory(selectedBook.id)}>History</button>
              <button className="reject-btn" onClick={() => handleDeactivate(selectedBook.id)}>Deactivate</button>
            </div>
          </div>

          <div className="bm-detail-grid">
            <div className="detail-card">
              <div className="detail-label">Book Code</div>
              <div className="detail-value code-value">{selectedBook.book_code}</div>
            </div>
            <div className="detail-card">
              <div className="detail-label">ISBN</div>
              <div className="detail-value">{selectedBook.isbn}</div>
            </div>
            <div className="detail-card">
              <div className="detail-label">Media Type</div>
              <div className="detail-value">{selectedBook.media_type} — {selectedBook.book_type}</div>
            </div>
            <div className="detail-card">
              <div className="detail-label">MRP</div>
              <div className="detail-value">Rs. {selectedBook.mrp}</div>
            </div>
            <div className="detail-card">
              <div className="detail-label">Replacement Cost</div>
              <div className="detail-value">Rs. {selectedBook.replacement_cost}</div>
            </div>
            <div className="detail-card">
              <div className="detail-label">Availability</div>
              <div className="detail-value">
                {selectedBook.available_copies} / {selectedBook.total_copies} available
              </div>
            </div>
            <div className="detail-card">
              <div className="detail-label">Eligible</div>
              <div className="detail-value">{eligibilityLabel(selectedBook)}</div>
            </div>
            <div className="detail-card">
              <div className="detail-label">Added On</div>
              <div className="detail-value">{formatDate(selectedBook.created_at)}</div>
            </div>
          </div>

          {error && <div className="error-box" style={{ marginTop: "12px" }}>{error}</div>}

          <p className="section-title" style={{ marginTop: "24px" }}>
            Physical Copies — click any to view details
          </p>
          <div className="copies-grid">
            {selectedBook.copies && selectedBook.copies.map(c => (
              <div
                key={c.id}
                className={`copy-tile status-${c.status}`}
                onClick={() => setSelectedCopy(c)}
              >
                <div className="copy-tile-code">{c.copy_code}</div>
                <div className="copy-tile-status">{c.status}</div>
                {c.status === "reserved" && c.reserved_by_roll && (
                  <div className="copy-tile-issued">→ {c.reserved_by_roll}</div>
                )}
                {c.status === "issued" && c.issued_to_roll && (
                  <div className="copy-tile-issued">→ {c.issued_to_roll}</div>
                )}
              </div>
            ))}
          </div>

          {showHistory && (
            <div className="history-panel" style={{ marginTop: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
                <p className="section-title" style={{ margin: 0 }}>Edit History</p>
                <button className="logout-btn" onClick={() => setShowHistory(false)}>Close</button>
              </div>
              {history.length === 0 ? (
                <div className="empty-state">No history.</div>
              ) : history.map(h => (
                <div className="history-entry" key={h.id}>
                  <span className="history-type">{h.change_type}</span>
                  <span className="history-detail">{h.change_detail}</span>
                  <span className="history-date">{new Date(h.changed_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Book list view ────────────────────────────────────────
  return (
    <div className="page-content">
      <div className="dash-welcome">
        <h1>Manage Books</h1>
        <p>Add new books and manage existing inventory.</p>
      </div>

      {error && <div className="error-box" style={{ marginBottom: "12px" }}>{error}</div>}
      {message && <div className="pending-box" style={{ marginBottom: "12px" }}>{message}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "16px" }}>
        <button
          className="approve-btn"
          onClick={() => { setShowForm(!showForm); setError(""); setMessage(""); setForm(EMPTY_FORM); }}
        >
          {showForm ? "Cancel" : "+ Add Book"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="book-form" style={{ marginBottom: "24px" }}>

          {/* Core fields */}
          <div className="book-form-grid">
            <FloatInput label="ISBN" name="isbn" value={form.isbn} onChange={handleChange} required />
            <FloatInput label="Title" name="title" value={form.title} onChange={handleChange} required />
            <FloatInput label="Author" name="author" value={form.author} onChange={handleChange} required />
            <FloatInput label="Subject" name="subject" value={form.subject} onChange={handleChange} required />
            <FloatInput label="Edition" name="edition" value={form.edition} onChange={handleChange} required />
            <FloatInput label="MRP (Rs.)" name="mrp" type="number" value={form.mrp} onChange={handleChange} required />
            <FloatInput label="No. of Copies" name="total_copies" type="number" min="1" value={form.total_copies} onChange={handleChange} required />
            <FloatInput label="Entry Date (YYMMDD)" name="entry_date" value={form.entry_date} onChange={handleChange} required />
          </div>

          {/* Cover image */}
          <div className="eligibility-section">
            <p className="eligibility-label">Cover Image (optional)</p>
            <div className="cover-upload-row">
              <button type="button" className="logout-btn" onClick={() => fileInputRef.current.click()}>
                Choose Image
              </button>
              <input
                type="file"
                accept="image/*"
                ref={fileInputRef}
                style={{ display: "none" }}
                onChange={handleImageUpload}
              />
              {form.cover_image ? (
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <img src={form.cover_image} alt="Preview" className="cover-preview" />
                  <button
                    type="button"
                    className="reject-btn"
                    onClick={() => setForm(prev => ({ ...prev, cover_image: null }))}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <span style={{ fontSize: "13px", color: "var(--muted)" }}>No image selected</span>
              )}
            </div>
          </div>

          {/* Media type */}
          <div className="eligibility-section">
            <p className="eligibility-label">Media Type</p>
            <div className="eligibility-checks">
              <label className="check-item">
                <input
                  type="radio"
                  name="media_type"
                  value="book"
                  checked={form.media_type === "book"}
                  onChange={handleChange}
                />
                Book
              </label>
              <label className="check-item">
                <input
                  type="radio"
                  name="media_type"
                  value="magazine"
                  checked={form.media_type === "magazine"}
                  onChange={handleChange}
                />
                Magazine (Reference Only — cannot be issued)
              </label>
            </div>
          </div>

          {/* Courses checklist — only for books */}
          {form.media_type === "book" && (
            <div className="eligibility-section">
              <p className="eligibility-label">Relevant Courses</p>
              <div className="eligibility-checks" style={{ flexWrap: "wrap", gap: "12px" }}>
                {Object.entries(COURSE_OPTIONS).map(([prefix, label]) => (
                  <label key={prefix} className="check-item">
                    <input
                      type="checkbox"
                      checked={form.courses.includes(prefix)}
                      onChange={() => handleCourseToggle(prefix)}
                    />
                    <span>
                      <span className="course-tag" style={{ marginRight: "4px" }}>{prefix}</span>
                      {label}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Eligibility — only for books */}
          {form.media_type === "book" && (
            <div className="eligibility-section">
              <p className="eligibility-label">Who can borrow this book?</p>
              <div className="eligibility-checks">
                <label className="check-item">
                  <input
                    type="checkbox"
                    name="elig_students"
                    checked={form.elig_students}
                    onChange={handleChange}
                  />
                  Students
                </label>
                <label className="check-item">
                  <input
                    type="checkbox"
                    name="elig_teaching_staff"
                    checked={form.elig_teaching_staff}
                    onChange={handleChange}
                  />
                  Teaching Staff
                </label>
                <label className="check-item">
                  <input
                    type="checkbox"
                    name="elig_non_teaching_staff"
                    checked={form.elig_non_teaching_staff}
                    onChange={handleChange}
                  />
                  Non-Teaching Staff
                </label>
              </div>
            </div>
          )}

          {/* Replacement percent slider */}
          <div className="eligibility-section">
            <p className="eligibility-label">
              Replacement Cost — {form.replacement_percent}% of MRP
              {form.mrp ? ` = ${replacementPreview}` : ""}
            </p>
            <input
              type="range"
              name="replacement_percent"
              min="10"
              max="200"
              step="5"
              value={form.replacement_percent}
              onChange={handleChange}
              className="replacement-slider"
            />
            <div className="slider-markers">
              <span>10%</span>
              <span>50%</span>
              <span>100%</span>
              <span>150%</span>
              <span>200%</span>
            </div>
          </div>

          {/* Preview box */}
          <div className="book-preview-box">
            <div className="preview-row">
              <span className="preview-label">Generated Book Code</span>
              <span className="code-value">{previewCode}</span>
            </div>
            <div className="preview-row">
              <span className="preview-label">Replacement Cost ({form.replacement_percent}% of MRP)</span>
              <span className="preview-value">{replacementPreview}</span>
            </div>
            {previewCode !== "—" && totalCopies > 0 && (
              <div className="preview-row">
                <span className="preview-label">Instance Codes</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {Array.from({ length: Math.min(totalCopies, 4) }, (_, i) => {
                    const w = String(totalCopies).length;
                    return (
                      <span key={i} className="copy-code-value">
                        {previewCode}-{String(i + 1).padStart(w, "0")}
                      </span>
                    );
                  })}
                  {totalCopies > 4 && (
                    <span className="copy-code-value">
                      ...{previewCode}-{String(totalCopies).padStart(String(totalCopies).length, "0")}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          <button type="submit" className="button" style={{ marginTop: "12px" }}>
            Add Book
          </button>
        </form>
      )}

      {/* Book grid — 2 per row */}
      <div className="book-grid-2col">
        {books.length === 0 ? (
          <div className="empty-state" style={{ gridColumn: "1 / -1" }}>
            No books yet. Click + Add Book to get started.
          </div>
        ) : (
          books.map(book => (
            <div
              className="book-card book-card-clickable"
              key={book.id}
              onClick={() => setSelectedBook(book)}
            >
              {book.cover_image ? (
                <img src={book.cover_image} alt="Cover" className="book-cover-thumb" />
              ) : (
                <div className="book-cover-thumb-placeholder">No Cover</div>
              )}
              <div className="book-card-info">
                <div className="book-title">{book.title}</div>
                <div className="book-meta">
                  {book.author} &bull; {book.subject} &bull; Ed. {book.edition}
                </div>
                <div className="book-meta">
                  <span className="code-value" style={{ fontSize: "11px" }}>{book.book_code}</span>
                  &nbsp;&bull;&nbsp;{book.media_type} &bull; {book.book_type}
                </div>
                <div className="book-meta">
                  Available: {book.available_copies}/{book.total_copies}
                  &nbsp;&bull;&nbsp;Added: {formatDate(book.created_at)}
                </div>
                {book.courses && (
                  <div style={{ marginTop: "4px" }}>
                    {book.courses.split(",").map(c => (
                      <span key={c} className="course-tag">{c}</span>
                    ))}
                  </div>
                )}
                <div className="book-meta" style={{ marginTop: "2px" }}>
                  Eligible: {eligibilityLabel(book)}
                </div>
              </div>
              <div className="book-card-arrow">›</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}