import { useState } from "react";
import config from "../../../config";

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
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function BookSearch({ user }) {
  const [query, setQuery] = useState({ isbn: "", title: "", author: "", subject: "" });
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [selectedBook, setSelectedBook] = useState(null);
  const [selectedCopy, setSelectedCopy] = useState(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (query.isbn) params.append("isbn", query.isbn);
    if (query.title) params.append("title", query.title);
    if (query.author) params.append("author", query.author);
    if (query.subject) params.append("subject", query.subject);
    const res = await fetch(`${config.API_URL}/api/books/search?${params}`);
    const data = await res.json();
    setResults(data);
    setSearched(true);
    setSelectedBook(null);
  };

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
              <div className={`detail-value copy-status-badge status-${selectedCopy.status}`}>{selectedCopy.status}</div>
            </div>
            <div className="detail-card">
              <div className="detail-label">Condition Note</div>
              <div className="detail-value">{selectedCopy.condition_note || "—"}</div>
            </div>
            <div className="detail-card">
              <div className="detail-label">Added On</div>
              <div className="detail-value">{formatDate(selectedCopy.added_at)}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (selectedBook) {
    return (
      <div className="page-content">
        <button className="back-btn" onClick={() => setSelectedBook(null)}>← Back to Results</button>
        <div className="bm-detail-panel" style={{ marginTop: "16px" }}>
          <div className="bm-detail-header">
            <div>
              <h3 className="bm-detail-title">{selectedBook.title}</h3>
              <p className="book-meta">{selectedBook.author} &bull; {selectedBook.subject} &bull; Ed. {selectedBook.edition}</p>
            </div>
          </div>
          <div className="bm-detail-grid">
            <div className="detail-card"><div className="detail-label">Book Code</div><div className="detail-value code-value">{selectedBook.book_code}</div></div>
            <div className="detail-card"><div className="detail-label">ISBN</div><div className="detail-value">{selectedBook.isbn}</div></div>
            <div className="detail-card"><div className="detail-label">Type</div><div className="detail-value">{selectedBook.media_type} — {selectedBook.book_type}</div></div>
            <div className="detail-card"><div className="detail-label">MRP</div><div className="detail-value">Rs. {selectedBook.mrp}</div></div>
            <div className="detail-card"><div className="detail-label">Replacement Cost</div><div className="detail-value">Rs. {selectedBook.replacement_cost}</div></div>
            <div className="detail-card"><div className="detail-label">Availability</div><div className="detail-value">{selectedBook.available_copies} / {selectedBook.total_copies}</div></div>
            <div className="detail-card"><div className="detail-label">Eligible</div><div className="detail-value">{eligibilityLabel(selectedBook)}</div></div>
            <div className="detail-card"><div className="detail-label">Added On</div><div className="detail-value">{formatDate(selectedBook.created_at)}</div></div>
          </div>
          <p className="section-title" style={{ marginTop: "20px" }}>Physical Copies — click to view details</p>
          <div className="copies-grid">
            {selectedBook.copies && selectedBook.copies.map(c => (
              <div key={c.id} className={`copy-tile status-${c.status}`} onClick={() => setSelectedCopy(c)}>
                <div className="copy-tile-code">{c.copy_code}</div>
                <div className="copy-tile-status">{c.status}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="dash-welcome">
        <h1>Search Books</h1>
        <p>Search by ISBN, title, author or subject.</p>
      </div>

      <form onSubmit={handleSearch} className="book-form">
        <div className="book-form-grid">
          <FloatInput label="ISBN" name="isbn" value={query.isbn} onChange={e => setQuery({ ...query, isbn: e.target.value })} />
          <FloatInput label="Title" name="title" value={query.title} onChange={e => setQuery({ ...query, title: e.target.value })} />
          <FloatInput label="Author" name="author" value={query.author} onChange={e => setQuery({ ...query, author: e.target.value })} />
          <FloatInput label="Subject" name="subject" value={query.subject} onChange={e => setQuery({ ...query, subject: e.target.value })} />
        </div>
        <button type="submit" className="button" style={{ marginTop: "12px" }}>Search</button>
      </form>

      {searched && (
        <>
          <p className="section-title" style={{ marginTop: "20px" }}>
            {results.length === 0 ? "No books found" : `${results.length} result(s)`}
          </p>
          <div className="book-list">
            {results.map(book => (
              <div className="book-card book-card-clickable" key={book.id} onClick={() => setSelectedBook(book)}>
                <div className="book-card-info">
                  <div className="book-title">{book.title}</div>
                  <div className="book-meta">{book.author} &bull; {book.subject} &bull; Ed. {book.edition}</div>
                  <div className="book-meta">ISBN: {book.isbn} &bull; {book.media_type} &bull; Available: {book.available_copies}/{book.total_copies}</div>
                  <div className="book-meta">Eligible: {eligibilityLabel(book)} &bull; Added: {formatDate(book.created_at)}</div>
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