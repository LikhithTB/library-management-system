import { useState, useEffect } from "react";
import config from "../../../config";

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

export default function LibrarianHome({ user }) {
  const [reservations, setReservations] = useState([]);
  const [issued, setIssued] = useState([]);
  const [pendingFines, setPendingFines] = useState([]);
  const [issueForm, setIssueForm] = useState({ copy_code: "", roll_number: "" });
  const [returnForm, setReturnForm] = useState({ copy_code: "", condition: "good", condition_note: "" });
  const [fineRollNumber, setFineRollNumber] = useState("");
  const [studentFines, setStudentFines] = useState([]);
  const [fineSearched, setFineSearched] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [fineMessage, setFineMessage] = useState("");
  const [fineError, setFineError] = useState("");

  // NOC state
  const [nocRollNumber, setNocRollNumber] = useState("");
  const [nocStatus, setNocStatus] = useState(null);
  const [nocChecking, setNocChecking] = useState(false);
  const [nocGenerating, setNocGenerating] = useState(false);
  const [nocError, setNocError] = useState("");
  const [procureForm, setProcureForm] = useState({ title: "", author: "", isbn: "", reason: "", book_id: "" });
  const [procureMsg, setProcureMsg] = useState("");
  const [procureErr, setProcureErr] = useState("");
  const [showProcureForm, setShowProcureForm] = useState(false);
  
  useEffect(() => {
    fetchReservations();
    fetchIssued();
    fetchPendingFines();
  }, []);

  const fetchReservations = async () => {
    try {
      const res = await fetch(`${config.API_URL}/api/librarian/reservations`);
      const data = await res.json();
      setReservations(data);
    } catch {}
  };

  const fetchIssued = async () => {
    try {
      const res = await fetch(`${config.API_URL}/api/librarian/issued`);
      const data = await res.json();
      setIssued(data);
    } catch {}
  };

  const fetchPendingFines = async () => {
    try {
      const res = await fetch(`${config.API_URL}/api/fines/pending`);
      const data = await res.json();
      setPendingFines(data);
    } catch {}
  };

  const searchStudentFines = async (e) => {
    e.preventDefault();
    setFineMessage(""); setFineError("");
    if (!fineRollNumber.trim()) { setFineError("Enter a roll number"); return; }
    try {
      const res = await fetch(`${config.API_URL}/api/fines/student/${fineRollNumber.trim()}`);
      const data = await res.json();
      setStudentFines(Array.isArray(data) ? data : []);
      setFineSearched(true);
    } catch { setFineError("Could not load fines"); }
  };

  const handleCollectFine = async (fineId, amount) => {
    setFineMessage(""); setFineError("");
    if (!window.confirm(`Collect full payment of Rs. ${amount} from ${fineRollNumber}?`)) return;
    try {
      const res = await fetch(`${config.API_URL}/api/fines/collect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fine_id: fineId,
          roll_number: fineRollNumber,
          amount_paid: amount,
          recorded_by: user.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setFineError(data.detail || "Failed"); return; }
      setFineMessage(data.message + (data.student_unblocked ? " Student unblocked." : ""));
      searchStudentFines({ preventDefault: () => {} });
      fetchPendingFines();
    } catch { setFineError("Could not connect"); }
  };

  const handleIssue = async (e) => {
    e.preventDefault();
    setMessage(""); setError("");
    try {
      const res = await fetch(`${config.API_URL}/api/books/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...issueForm, librarian_id: user.id }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.detail || "Failed"); return; }
      setMessage(data.message);
      setIssueForm({ copy_code: "", roll_number: "" });
      fetchReservations();
      fetchIssued();
    } catch { setError("Could not connect"); }
  };

  const handleReturn = async (e) => {
    e.preventDefault();
    setMessage(""); setError("");
    try {
      const res = await fetch(`${config.API_URL}/api/books/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...returnForm, librarian_id: user.id }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.detail || "Failed"); return; }
      setMessage(data.message + (data.fine > 0 ? ` Fine charged: Rs. ${data.fine}` : ""));
      setReturnForm({ copy_code: "", condition: "good", condition_note: "" });
      fetchIssued();
      fetchPendingFines();
    } catch { setError("Could not connect"); }
  };

  // ── NOC handlers ────────────────────────────────────────────
  const handleCheckNOC = async (e) => {
    e.preventDefault();
    setNocError(""); setNocStatus(null);
    if (!nocRollNumber.trim()) { setNocError("Enter a roll number"); return; }
    setNocChecking(true);
    try {
      const res = await fetch(`${config.API_URL}/api/noc/check/${nocRollNumber.trim()}`);
      const data = await res.json();
      if (!res.ok) { setNocError(data.detail || "Failed to check"); return; }
      setNocStatus(data);
    } catch { setNocError("Could not connect to server"); }
    finally { setNocChecking(false); }
  };

  const handleGenerateNOC = async () => {
    setNocError(""); setNocGenerating(true);
    try {
      const res = await fetch(
        `${config.API_URL}/api/noc/generate/${nocRollNumber.trim()}?librarian_id=${user.id}`
      );
      if (!res.ok) {
        const data = await res.json();
        setNocError(data.detail || "Failed to generate NOC");
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `NOC_${nocRollNumber.trim()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch { setNocError("Could not connect to server"); }
    finally { setNocGenerating(false); }
  };

  const handleProcureRequest = async (e) => {
    e.preventDefault();
    setProcureMsg(""); setProcureErr("");
    if (!procureForm.title.trim()) { setProcureErr("Title is required"); return; }
    try {
      const res = await fetch(`${config.API_URL}/api/book-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requested_by: user.id,
          title: procureForm.title,
          author: procureForm.author || null,
          isbn: procureForm.isbn || null,
          reason: procureForm.reason || null,
          request_type: "copies",
          book_id: procureForm.book_id ? parseInt(procureForm.book_id) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setProcureErr(data.detail || "Failed"); return; }
      setProcureMsg("Procurement request sent to HOD.");
      setProcureForm({ title: "", author: "", isbn: "", reason: "", book_id: "" });
      setShowProcureForm(false);
    } catch { setProcureErr("Could not connect"); }
  };

  const overdueCount = issued.filter(i => i.is_overdue).length;

  return (
    <div className="page-content">
      <div className="dash-welcome">
        <h1>Librarian Dashboard</h1>
        <p>Manage circulation, reservations, returns and fines.</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{reservations.length}</div>
          <div className="stat-label">Pending Reservations</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{issued.length}</div>
          <div className="stat-label">Books Issued</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: overdueCount > 0 ? "#f87171" : "inherit" }}>
            {overdueCount}
          </div>
          <div className="stat-label">Overdue</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: pendingFines.length > 0 ? "#fbbf24" : "inherit" }}>
            {pendingFines.length}
          </div>
          <div className="stat-label">Unpaid Fines</div>
        </div>
      </div>

      {message && <div className="pending-box" style={{ marginBottom: "16px" }}>{message}</div>}
      {error && <div className="error-box" style={{ marginBottom: "16px" }}>{error}</div>}

      {/* Issue */}
      <p className="section-title">Issue a Book</p>
      <form onSubmit={handleIssue} className="book-form" style={{ marginBottom: "24px" }}>
        <div className="book-form-grid">
          <div className="float-field">
            <input className="float-input" placeholder=" " value={issueForm.copy_code}
              onChange={e => setIssueForm({ ...issueForm, copy_code: e.target.value })} required />
            <label className="float-label">Copy Code</label>
          </div>
          <div className="float-field">
            <input className="float-input" placeholder=" " value={issueForm.roll_number}
              onChange={e => setIssueForm({ ...issueForm, roll_number: e.target.value })} required />
            <label className="float-label">Student Roll Number</label>
          </div>
        </div>
        <button type="submit" className="approve-btn" style={{ marginTop: "12px" }}>Confirm Issue</button>
      </form>

      {/* Return */}
      <p className="section-title">Accept Return</p>
      <form onSubmit={handleReturn} className="book-form" style={{ marginBottom: "24px" }}>
        <div className="book-form-grid">
          <div className="float-field">
            <input className="float-input" placeholder=" " value={returnForm.copy_code}
              onChange={e => setReturnForm({ ...returnForm, copy_code: e.target.value })} required />
            <label className="float-label">Copy Code</label>
          </div>
          <select className="input select" value={returnForm.condition}
            onChange={e => setReturnForm({ ...returnForm, condition: e.target.value })}>
            <option value="good">Good Condition</option>
            <option value="damaged">Damaged</option>
            <option value="lost">Lost</option>
          </select>
          <div className="float-field">
            <input className="float-input" placeholder=" " value={returnForm.condition_note}
              onChange={e => setReturnForm({ ...returnForm, condition_note: e.target.value })} />
            <label className="float-label">Condition Note (optional)</label>
          </div>
        </div>
        <button type="submit" className="logout-btn" style={{ marginTop: "12px" }}>Confirm Return</button>
      </form>

      {/* Fine Collection */}
      <p className="section-title">Collect Fines</p>
      <form onSubmit={searchStudentFines} className="book-form" style={{ marginBottom: "16px" }}>
        <div className="book-form-grid">
          <div className="float-field">
            <input
              className="float-input"
              placeholder=" "
              value={fineRollNumber}
              onChange={e => setFineRollNumber(e.target.value)}
              required
            />
            <label className="float-label">Student Roll Number</label>
          </div>
        </div>
        <button type="submit" className="logout-btn" style={{ marginTop: "12px" }}>Search Fines</button>
      </form>

      {fineMessage && <div className="pending-box" style={{ marginBottom: "12px" }}>{fineMessage}</div>}
      {fineError && <div className="error-box" style={{ marginBottom: "12px" }}>{fineError}</div>}

      {fineSearched && (
        studentFines.length === 0 ? (
          <div className="empty-state" style={{ marginBottom: "24px" }}>
            No pending fines for {fineRollNumber}.
          </div>
        ) : (
          <div className="approval-list" style={{ marginBottom: "24px" }}>
            {studentFines.map((f, idx) => (
              <div className="approval-card" key={f.id || idx}
                style={{ flexDirection: "column", alignItems: "stretch", gap: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div className="book-title" style={{ fontSize: "14px" }}>{f.book_title}</div>
                    <div className="book-meta">Copy: {f.copy_code}</div>
                    {f.is_live ? (
                      <div className="book-meta" style={{ color: "#fbbf24" }}>
                        Book still issued — fine accruing daily
                      </div>
                    ) : (
                      <div className="book-meta">Total Fine: Rs. {f.total_fine}</div>
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: "#f87171", fontWeight: 700, fontSize: "16px" }}>
                      Rs. {f.remaining} {f.is_live ? "(live)" : "due"}
                    </div>
                    <div className={`fine-status ${f.is_live ? "fine-status-pending" : "fine-status-partial"}`}>
                      {f.is_live ? "Book Still Issued" : "Unpaid"}
                    </div>
                  </div>
                </div>

                {/* Only allow full payment collection for returned books with fine records */}
                {!f.is_live ? (
                  <button
                    className="approve-btn"
                    style={{ alignSelf: "flex-end", padding: "10px 20px" }}
                    onClick={() => handleCollectFine(f.id, f.remaining)}
                  >
                    Collect Full Payment — Rs. {f.remaining}
                  </button>
                ) : (
                  <div className="role-warning" style={{ fontSize: "13px" }}>
                    Ask the student to return the book first. Fine will be recorded on return and can be collected then — full payment only.
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {/* Pending reservations */}
      <p className="section-title">Pending Reservations</p>
      {reservations.length === 0 ? (
        <div className="empty-state" style={{ marginBottom: "24px" }}>No pending reservations.</div>
      ) : (
        <div className="approval-list" style={{ marginBottom: "24px" }}>
          {reservations.map((r, i) => (
            <div className="approval-card" key={i} style={{
              borderColor: r.is_expiring_soon ? "#d97706" : undefined
            }}>
              <div className="approval-info">
                <span className="approval-roll">{r.reserved_by_roll}</span>
                <span className="approval-email">{r.book_title}</span>
                <span className="code-value" style={{ fontSize: "11px" }}>{r.copy_code}</span>
              </div>
              <div style={{ textAlign: "right" }}>
                {r.is_expiring_soon && (
                  <div style={{ color: "#fbbf24", fontSize: "11px", fontWeight: 600 }}>Expiring Soon</div>
                )}
                <div className="book-meta">
                  Expires: {r.expires_at ? new Date(r.expires_at).toLocaleString() : "—"}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Currently issued */}
      <p className="section-title">Currently Issued</p>
      {issued.length === 0 ? (
        <div className="empty-state" style={{ marginBottom: "24px" }}>No books currently issued.</div>
      ) : (
        <div className="approval-list" style={{ marginBottom: "24px" }}>
          {issued.map((item, i) => (
            <div className="approval-card" key={i}
              style={{ borderColor: item.is_overdue ? "#991b1b" : undefined }}>
              <div className="approval-info">
                <span className="approval-roll">{item.issued_to_roll}</span>
                <span className="approval-email">{item.book_title}</span>
                <span className="code-value" style={{ fontSize: "11px" }}>{item.copy_code}</span>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="book-meta">Due: {formatDate(item.due_date)}</div>
                {item.is_overdue && (
                  <div style={{ color: "#f87171", fontSize: "12px", fontWeight: 600 }}>
                    OVERDUE — Fine: Rs. {item.fine}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Procurement Request */}
      <p className="section-title">Request Book Procurement</p>
      <div style={{ marginBottom: "16px" }}>
        <button className="logout-btn" onClick={() => setShowProcureForm(!showProcureForm)}>
          {showProcureForm ? "Cancel" : "+ New Procurement Request"}
        </button>
      </div>
      {showProcureForm && (
        <form onSubmit={handleProcureRequest} className="book-form" style={{ marginBottom: "16px" }}>
          <p className="book-meta" style={{ marginBottom: "12px" }}>
            Request new books or more copies of an existing book. The HOD will review and approve.
          </p>
          <div className="book-form-grid">
            <div className="float-field">
              <input className="float-input" placeholder=" " value={procureForm.title}
                onChange={e => setProcureForm({ ...procureForm, title: e.target.value })} required />
              <label className="float-label">Book Title *</label>
            </div>
            <div className="float-field">
              <input className="float-input" placeholder=" " value={procureForm.author}
                onChange={e => setProcureForm({ ...procureForm, author: e.target.value })} />
              <label className="float-label">Author</label>
            </div>
            <div className="float-field">
              <input className="float-input" placeholder=" " value={procureForm.isbn}
                onChange={e => setProcureForm({ ...procureForm, isbn: e.target.value })} />
              <label className="float-label">ISBN</label>
            </div>
            <div className="float-field">
              <input className="float-input" placeholder=" " value={procureForm.book_id}
                onChange={e => setProcureForm({ ...procureForm, book_id: e.target.value })} />
              <label className="float-label">Existing Book ID (if requesting more copies)</label>
            </div>
          </div>
          <div className="float-field" style={{ marginTop: "10px" }}>
            <textarea
              className="float-input"
              placeholder=" "
              style={{ minHeight: "70px", resize: "vertical", paddingTop: "20px" }}
              value={procureForm.reason}
              onChange={e => setProcureForm({ ...procureForm, reason: e.target.value })}
            />
            <label className="float-label">Reason / Justification *</label>
          </div>
          {procureErr && <div className="error-box" style={{ marginTop: "10px" }}>{procureErr}</div>}
          {procureMsg && <div className="pending-box" style={{ marginTop: "10px" }}>{procureMsg}</div>}
          <button type="submit" className="approve-btn" style={{ marginTop: "12px" }}>
            Send to HOD
          </button>
        </form>
      )}

      {/* NOC Generation */}
      <p className="section-title">Generate No Objection Certificate (NOC)</p>
      <form onSubmit={handleCheckNOC} className="book-form" style={{ marginBottom: "16px" }}>
        <div className="book-form-grid">
          <div className="float-field">
            <input
              className="float-input"
              placeholder=" "
              value={nocRollNumber}
              onChange={e => { setNocRollNumber(e.target.value); setNocStatus(null); setNocError(""); }}
              required
            />
            <label className="float-label">Student Roll Number</label>
          </div>
        </div>
        <button type="submit" className="logout-btn" style={{ marginTop: "12px" }} disabled={nocChecking}>
          {nocChecking ? "Checking..." : "Check Eligibility"}
        </button>
      </form>

      {nocError && <div className="error-box" style={{ marginBottom: "16px" }}>{nocError}</div>}

      {nocStatus && (
        nocStatus.eligible ? (
          <div className="noc-eligible-card">
            <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "6px", color: "#4ade80" }}>
              ✓ {nocStatus.roll_number} is eligible for NOC
            </div>
            <div className="book-meta" style={{ marginBottom: "14px" }}>
              No pending fines, no overdue or currently issued books.
            </div>
            <button
              className="approve-btn"
              onClick={handleGenerateNOC}
              disabled={nocGenerating}
            >
              {nocGenerating ? "Generating..." : "Generate NOC (Download PDF)"}
            </button>
          </div>
        ) : (
          <div className="noc-blocked-card">
            <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "8px", color: "#f87171" }}>
              {nocStatus.roll_number} has pending dues — clear them to generate NOC
            </div>
            <ul style={{ margin: "0 0 4px 0", paddingLeft: "20px" }}>
              {nocStatus.blocking_reasons.map((reason, i) => (
                <li key={i} className="book-meta" style={{ marginBottom: "4px" }}>{reason}</li>
              ))}
            </ul>
          </div>
        )
      )}
    </div>
  );
}