import { useState, useEffect } from "react";
import config from "../../config";

const REPLACEMENT_PERCENT = 0.90;

const EMPTY_FORM = {
  isbn: "",
  title: "",
  author: "",
  subject: "",
  edition: "",
  media_type: "book",
  mrp: "",
  total_copies: "1",
  entry_date: "",
  elig_students: true,
  elig_teaching_staff: false,
  elig_non_teaching_staff: false,
};

function eligibilityLabel(book) {
  const selected = [];
  if (book.elig_students) selected.push("Students");
  if (book.elig_teaching_staff) selected.push("Teaching Staff");
  if (book.elig_non_teaching_staff) selected.push("Non-Teaching Staff");
  if (selected.length === 3) return "All";
  if (selected.length === 0) return "None";
  return selected.join(", ");
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric"
  });
}

// Floating label input component
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
  const [activeTab, setActiveTab] = useState("manage"); // "manage" | "search"
  const [books, setBooks] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selectedBook, setSelectedBook] = useState(null);   // master book detail view
  const [selectedCopy, setSelectedCopy] = useState(null);   // individual copy detail
  const [showHistory, setShowHistory] = useState(null);
  const [history, setHistory] = useState([]);

  // Search state
  const [searchQuery, setSearchQuery] = useState({ isbn: "", title: "", author: "", subject: "" });
  const [searchResults, setSearchResults] = useState([]);
  const [searched, setSearched] = useState(false);

  useEffect(() => { fetchBooks(); }, []);

  const fetchBooks = async () => {
    const res = await fetch(`${config.API_URL}/api/books`);
    const data = await res.json();
    setBooks(data);
  };

  const fetchHistory = async (bookId) => {
    const res = await fetch(`${config.API_URL}/api/books/${bookId}/history`);
    const data = await res.json();
    setHistory(data);
    setShowHistory(bookId);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm({ ...form, [name]: type === "checkbox" ? checked : value });
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (searchQuery.isbn) params.append("isbn", searchQuery.isbn);
    if (searchQuery.title) params.append("title", searchQuery.title);
    if (searchQuery.author) params.append("author", searchQuery.author);
    if (searchQuery.subject) params.append("subject", searchQuery.subject);
    const res = await fetch(`${config.API_URL}/api/books/search?${params}`);
    const data = await res.json();
    setSearchResults(data);
    setSearched(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (!form.elig_students && !form.elig_teaching_staff && !form.elig_non_teaching_staff) {
      setError("Please select at least one eligibility group");
      return;
    }

    if (!form.entry_date) {
      setError("Please enter the entry date");
      return;
    }

    const body = {
      ...form,
      mrp: parseFloat(form.mrp),
      total_copies: parseInt(form.total_copies),
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
    if (!res.ok) { setError(data.detail || "Failed to deactivate"); return; }
    setMessage(data.message);
    setSelectedBook(null);
    fetchBooks();
  };

  const replacementPreview = form.mrp
    ? `Rs. ${(parseFloat(form.mrp) * REPLACEMENT_PERCENT).toFixed(2)}`
    : "—";

  // Preview book code
  const previewCode = form.isbn && form.entry_date
    ? `${form.media_type === "book" ? "BK" : "MZ"}-${form.isbn.replace(/-/g, "")}-${form.entry_date}`
    : "—";

  return (
    <div>
      {/* Tabs */}
      <div className="bm-tabs">
        <button
          className={`bm-tab ${activeTab === "manage" ? "bm-tab-active" : ""}`}
          onClick={() => setActiveTab("manage")}
        >
          Manage Books
        </button>
        <button
          className={`bm-tab ${activeTab === "search" ? "bm-tab-active" : ""}`}
          onClick={() => setActiveTab("search")}
        >
          Search Books
        </button>
      </div>

      {/* ── MANAGE TAB ── */}
      {activeTab === "manage" && (
        <div>
          {/* Individual copy detail modal */}
          {selectedCopy && (
            <div className="bm-modal-overlay" onClick={() => setSelectedCopy(null)}>
              <div className="bm-modal" onClick={e => e.stopPropagation()}>
                <div className="bm-modal-header">
                  <h3>Copy Details</h3>
                  <button className="logout-btn" onClick={() => setSelectedCopy(null)}>Close</button>
                </div>
                <div className="bm-modal-body">
                  <div className="detail-row"><span className="detail-label">Copy Code</span><span className="detail-value code-value">{selectedCopy.copy_code}</span></div>
                  <div className="detail-row"><span className="detail-label">Status</span><span className={`detail-value copy-status-badge status-${selectedCopy.status}`}>{selectedCopy.status}</span></div>
                  <div className="detail-row"><span className="detail-label">Condition Note</span><span className="detail-value">{selectedCopy.condition_note || "—"}</span></div>
                  <div className="detail-row"><span className="detail-label">Added On</span><span className="detail-value">{formatDate(selectedCopy.added_at)}</span></div>
                </div>
              </div>
            </div>
          )}

          {/* Master book detail panel */}
          {selectedBook && !selectedCopy && (
            <div className="bm-detail-panel">
              <div className="bm-detail-header">
                <div>
                  <h3 className="bm-detail-title">{selectedBook.title}</h3>
                  <p className="book-meta">{selectedBook.author} &bull; {selectedBook.subject} &bull; Ed. {selectedBook.edition}</p>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button className="logout-btn" onClick={() => fetchHistory(selectedBook.id)}>History</button>
                  <button className="reject-btn" onClick={() => handleDeactivate(selectedBook.id)}>Deactivate</button>
                  <button className="logout-btn" onClick={() => setSelectedBook(null)}>Back</button>
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
                  <div className="detail-label">Type</div>
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
                  <div className="detail-value">{selectedBook.available_copies} / {selectedBook.total_copies} available</div>
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

              <p className="section-title" style={{ marginTop: "20px" }}>Physical Copies — click any to view details</p>
              <div className="copies-grid">
                {selectedBook.copies && selectedBook.copies.map(c => (
                  <div
                    key={c.id}
                    className={`copy-tile status-${c.status}`}
                    onClick={() => setSelectedCopy(c)}
                  >
                    <div className="copy-tile-code">{c.copy_code}</div>
                    <div className="copy-tile-status">{c.status}</div>
                  </div>
                ))}
              </div>

              {showHistory === selectedBook.id && (
                <div className="history-panel" style={{ marginTop: "16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
                    <p className="section-title" style={{ margin: 0 }}>Edit History</p>
                    <button className="logout-btn" onClick={() => setShowHistory(null)}>Close</button>
                  </div>
                  {history.map(h => (
                    <div className="history-entry" key={h.id}>
                      <span className="history-type">{h.change_type}</span>
                      <span className="history-detail">{h.change_detail}</span>
                      <span className="history-date">{new Date(h.changed_at).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Book list */}
          {!selectedBook && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <p className="section-title" style={{ margin: 0 }}>Book Management</p>
                <button className="approve-btn" onClick={() => setShowForm(!showForm)}>
                  {showForm ? "Cancel" : "+ Add Book"}
                </button>
              </div>

              {error && <div className="error-box" style={{ marginBottom: "12px" }}>{error}</div>}
              {message && <div className="pending-box" style={{ marginBottom: "12px" }}>{message}</div>}

              {showForm && (
                <form onSubmit={handleSubmit} className="book-form">
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

                  {/* Media type */}
                  <div className="eligibility-section" style={{ marginTop: "14px" }}>
                    <p className="eligibility-label">Media Type</p>
                    <div className="eligibility-checks">
                      <label className="check-item">
                        <input type="radio" name="media_type" value="book" checked={form.media_type === "book"} onChange={handleChange} />
                        Book
                      </label>
                      <label className="check-item">
                        <input type="radio" name="media_type" value="magazine" checked={form.media_type === "magazine"} onChange={handleChange} />
                        Magazine (Reference Only)
                      </label>
                    </div>
                  </div>

                  {/* Eligibility — hide for magazines */}
                  {form.media_type === "book" && (
                    <div className="eligibility-section">
                      <p className="eligibility-label">Eligible to Borrow</p>
                      <div className="eligibility-checks">
                        <label className="check-item">
                          <input type="checkbox" name="elig_students" checked={form.elig_students} onChange={handleChange} />
                          Students
                        </label>
                        <label className="check-item">
                          <input type="checkbox" name="elig_teaching_staff" checked={form.elig_teaching_staff} onChange={handleChange} />
                          Teaching Staff
                        </label>
                        <label className="check-item">
                          <input type="checkbox" name="elig_non_teaching_staff" checked={form.elig_non_teaching_staff} onChange={handleChange} />
                          Non-Teaching Staff
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Preview box */}
                  <div className="book-preview-box">
                    <div className="preview-row">
                      <span className="preview-label">Generated Book Code</span>
                      <span className="code-value">{previewCode}</span>
                    </div>
                    <div className="preview-row">
                      <span className="preview-label">Replacement Cost (90% of MRP)</span>
                      <span className="preview-value">{replacementPreview}</span>
                    </div>
                    {form.isbn && form.entry_date && form.total_copies && (
                      <div className="preview-row">
                        <span className="preview-label">Instance Codes</span>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                          {Array.from({ length: Math.min(parseInt(form.total_copies) || 0, 4) }, (_, i) => {
                            const w = String(parseInt(form.total_copies)).length;
                            return (
                              <span key={i} className="copy-code-value">
                                {previewCode}-{String(i + 1).padStart(w, "0")}
                              </span>
                            );
                          })}
                          {parseInt(form.total_copies) > 4 && (
                            <span className="copy-code-value">...{previewCode}-{String(parseInt(form.total_copies)).padStart(String(parseInt(form.total_copies)).length, "0")}</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <button type="submit" className="button" style={{ marginTop: "12px" }}>Add Book</button>
                </form>
              )}

              <div className="book-list">
                {books.length === 0 ? (
                  <div className="empty-state">No books in the system yet.</div>
                ) : (
                  books.map(book => (
                    <div
                      className="book-card book-card-clickable"
                      key={book.id}
                      onClick={() => setSelectedBook(book)}
                    >
                      <div className="book-card-info">
                        <div className="book-title">{book.title}</div>
                        <div className="book-meta">{book.author} &bull; {book.subject} &bull; Ed. {book.edition}</div>
                        <div className="book-meta">
                          <span className="code-value" style={{ fontSize: "11px" }}>{book.book_code}</span>
                          &nbsp;&bull;&nbsp;{book.media_type} &bull; {book.book_type}
                          &nbsp;&bull;&nbsp;Available: {book.available_copies}/{book.total_copies}
                        </div>
                        <div className="book-meta">
                          Eligible: {eligibilityLabel(book)} &bull; Added: {formatDate(book.created_at)}
                        </div>
                      </div>
                      <div className="book-card-arrow">›</div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── SEARCH TAB ── */}
      {activeTab === "search" && (
        <div>
          <p className="section-title">Search Books</p>
          <form onSubmit={handleSearch} className="book-form">
            <div className="book-form-grid">
              <FloatInput label="ISBN" name="isbn" value={searchQuery.isbn} onChange={e => setSearchQuery({ ...searchQuery, isbn: e.target.value })} />
              <FloatInput label="Title" name="title" value={searchQuery.title} onChange={e => setSearchQuery({ ...searchQuery, title: e.target.value })} />
              <FloatInput label="Author" name="author" value={searchQuery.author} onChange={e => setSearchQuery({ ...searchQuery, author: e.target.value })} />
              <FloatInput label="Subject" name="subject" value={searchQuery.subject} onChange={e => setSearchQuery({ ...searchQuery, subject: e.target.value })} />
            </div>
            <button type="submit" className="button" style={{ marginTop: "12px" }}>Search</button>
          </form>

          {searched && (
            <>
              <p className="section-title" style={{ marginTop: "20px" }}>
                {searchResults.length === 0 ? "No books found" : `${searchResults.length} result(s)`}
              </p>
              <div className="book-list">
                {searchResults.map(book => (
                  <div
                    className="book-card book-card-clickable"
                    key={book.id}
                    onClick={() => { setSelectedBook(book); setActiveTab("manage"); }}
                  >
                    <div className="book-card-info">
                      <div className="book-title">{book.title}</div>
                      <div className="book-meta">{book.author} &bull; {book.subject} &bull; Ed. {book.edition}</div>
                      <div className="book-meta">
                        ISBN: {book.isbn} &bull; {book.media_type} &bull; Available: {book.available_copies}/{book.total_copies}
                      </div>
                    </div>
                    <div className="book-card-arrow">›</div>
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