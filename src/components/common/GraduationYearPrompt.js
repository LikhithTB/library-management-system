import { useState } from "react";
import config from "../../config";

const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 11 }, (_, i) => currentYear + i);

export default function GraduationYearPrompt({ user, onComplete }) {
  const [year, setYear] = useState("");
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!year) { setError("Please select a year."); return; }
    if (!confirmChecked) { setError("Please confirm you understand this cannot be changed later."); return; }

    setSubmitting(true);
    try {
      const res = await fetch(`${config.API_URL}/api/student/graduation-year`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id, graduation_year: parseInt(year, 10) }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.detail || "Could not save this."); return; }
      onComplete(parseInt(year, 10));
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <h2 style={styles.heading}>One quick question before you start</h2>
        <p style={styles.body}>
          What year do you expect to graduate? Your library account will be
          automatically disabled at the end of that year.
        </p>
        <p style={styles.warning}>
          You can only set this once — it cannot be changed afterwards. If
          you're not sure, pick your best estimate; only a library admin
          will be able to correct it later if needed.
        </p>

        <form onSubmit={handleSubmit}>
          <select
            value={year}
            onChange={e => setYear(e.target.value)}
            style={styles.select}
          >
            <option value="">Select graduation year</option>
            {YEAR_OPTIONS.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>

          <label style={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={confirmChecked}
              onChange={e => setConfirmChecked(e.target.checked)}
            />
            <span>I understand this cannot be changed once submitted.</span>
          </label>

          {error && <div style={styles.error}>{error}</div>}

          <button type="submit" disabled={submitting} style={styles.button}>
            {submitting ? "Saving..." : "Confirm"}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed", inset: 0, zIndex: 1000,
    background: "rgba(10, 15, 13, 0.65)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: "20px",
  },
  card: {
    width: "100%", maxWidth: "440px",
    background: "#ffffff", color: "#16211e",
    borderRadius: "16px", padding: "28px",
    boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
  },
  heading: { margin: "0 0 10px", fontSize: "20px", fontWeight: 700 },
  body: { margin: "0 0 10px", fontSize: "14px", lineHeight: 1.5, color: "#3a4844" },
  warning: {
    margin: "0 0 18px", fontSize: "13px", lineHeight: 1.5,
    color: "#92400e", background: "#fef3c7",
    padding: "10px 12px", borderRadius: "8px",
  },
  select: {
    width: "100%", padding: "10px 12px", borderRadius: "8px",
    border: "1px solid #d7ded9", fontSize: "14px", marginBottom: "14px",
  },
  checkboxRow: {
    display: "flex", alignItems: "flex-start", gap: "8px",
    fontSize: "13px", color: "#3a4844", marginBottom: "16px", cursor: "pointer",
  },
  error: {
    background: "#fee2e2", color: "#b91c1c",
    padding: "8px 12px", borderRadius: "8px",
    fontSize: "13px", marginBottom: "14px",
  },
  button: {
    width: "100%", padding: "11px", borderRadius: "10px", border: "none",
    background: "linear-gradient(135deg, #059669, #0d9488)", color: "#fff",
    fontWeight: 700, fontSize: "14px", cursor: "pointer",
  },
};