import { useState, useEffect } from "react";
import config from "../../config";

export default function LibraryAnalytics() {
  const [analytics, setAnalytics] = useState(null);
  const [deptAnalytics, setDeptAnalytics] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch(`${config.API_URL}/api/analytics/summary`).then(r => r.json()),
      fetch(`${config.API_URL}/api/analytics/department`).then(r => r.json()),
    ]).then(([a, d]) => {
      setAnalytics(a);
      setDeptAnalytics(d);
    }).catch(() => setError("Could not load analytics."));
  }, []);

  if (error) return <div className="page-content"><div className="error-box">{error}</div></div>;
  if (!analytics) return <div className="page-content"><div className="empty-state">Loading...</div></div>;

  const maxIssued = deptAnalytics
    ? Math.max(...deptAnalytics.by_course.map(d => d.currently_issued), 1)
    : 1;

  return (
    <div className="page-content">
      <div className="dash-welcome">
        <h1>Analytics & Reports</h1>
        <p>Library performance overview.</p>
      </div>

      {/* Overall stats */}
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-value">{analytics.total_books}</div><div className="stat-label">Total Titles</div></div>
        <div className="stat-card"><div className="stat-value">{analytics.total_copies}</div><div className="stat-label">Total Copies</div></div>
        <div className="stat-card"><div className="stat-value">{analytics.issued_copies}</div><div className="stat-label">Currently Issued</div></div>
        <div className="stat-card"><div className="stat-value">{analytics.reserved_copies}</div><div className="stat-label">Reserved</div></div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: analytics.overdue_copies > 0 ? "#f87171" : "inherit" }}>
            {analytics.overdue_copies}
          </div>
          <div className="stat-label">Overdue</div>
        </div>
      </div>

      {/* Department breakdown */}
      {deptAnalytics && (
        <>
          <p className="section-title" style={{ marginTop: "28px" }}>Department-wise Borrowing</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "24px" }}>
            {deptAnalytics.by_course
              .filter(d => d.student_count > 0)
              .sort((a, b) => b.currently_issued - a.currently_issued)
              .map(dept => (
                <div key={dept.prefix} className="dept-bar-card">
                  <div className="dept-bar-header">
                    <span className="course-tag" style={{ fontSize: "13px" }}>{dept.prefix}</span>
                    <span className="book-title" style={{ fontSize: "13px" }}>{dept.course}</span>
                    <span className="book-meta">{dept.student_count} students</span>
                    <span className="book-meta" style={{ marginLeft: "auto" }}>
                      {dept.currently_issued} issued
                      {dept.overdue > 0 && (
                        <span style={{ color: "#f87171", marginLeft: "8px" }}>
                          · {dept.overdue} overdue
                        </span>
                      )}
                      {dept.pending_fines > 0 && (
                        <span style={{ color: "#fbbf24", marginLeft: "8px" }}>
                          · Rs. {dept.pending_fines} fines
                        </span>
                      )}
                    </span>
                  </div>
                  {/* Bar chart */}
                  <div className="dept-bar-row">
                    <div className="dept-bar-track">
                      <div
                        className="dept-bar-fill"
                        style={{ width: `${Math.round((dept.currently_issued / maxIssued) * 100)}%` }}
                      />
                    </div>
                    <span className="dept-bar-percent">
                      {Math.round((dept.currently_issued / maxIssued) * 100)}%
                    </span>
                  </div>
                </div>
              ))}
          </div>

          {/* Subject breakdown */}
          {deptAnalytics.by_subject.length > 0 && (
            <>
              <p className="section-title">Most Demanded Subjects</p>
              <div className="approval-list" style={{ marginBottom: "24px" }}>
                {deptAnalytics.by_subject.map((s, i) => (
                  <div className="approval-card" key={i}>
                    <div className="approval-info">
                      <span className="approval-roll">#{i + 1}</span>
                      <span className="approval-email">{s.subject}</span>
                    </div>
                    <div className="notif-badge notif-waiting">{s.count} issue{s.count !== 1 ? "s" : ""}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Most borrowed books */}
      <p className="section-title">Most Borrowed Books</p>
      {analytics.most_borrowed.length === 0 ? (
        <div className="empty-state">No borrow history yet.</div>
      ) : (
        <div className="approval-list">
          {analytics.most_borrowed.map((b, i) => (
            <div className="approval-card" key={i}>
              <div className="approval-info">
                <span className="approval-roll">#{i + 1}</span>
                <div>
                  <div className="book-title" style={{ fontSize: "14px" }}>{b.title}</div>
                  <div className="book-meta">{b.author}</div>
                </div>
              </div>
              <div className="notif-badge notif-waiting">{b.borrow_count} issue{b.borrow_count !== 1 ? "s" : ""}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: "32px" }}>
        <LibraryReports />
      </div>
    </div>
  );
}

function LibraryReports() {
  const COURSE_OPTIONS = {
    CS: "Computer Science", AI: "AI/ML", EC: "ECE",
    EE: "EEE", ME: "Mechanical Engineering",
    CV: "Civil Engineering", BT: "Biotechnology",
  };

  const [reportType, setReportType] = useState("issued");
  const [dateFrom, setDateFrom]   = useState("");
  const [dateTo, setDateTo]       = useState("");
  const [course, setCourse]       = useState("all");
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");

  const REPORT_TYPES = [
    { id: "issued",   label: "Books Issued",          desc: "All books currently issued or issued in range" },
    { id: "overdue",  label: "Overdue Books",          desc: "Books past their due date" },
    { id: "fines",    label: "Fines Collected",        desc: "Fine records — paid and pending" },
    { id: "returned", label: "Books Returned",         desc: "Return history in date range" },
    { id: "reserved", label: "Active Reservations",   desc: "Books currently reserved" },
    { id: "popular",  label: "Most Borrowed Books",   desc: "Top books by issue count" },
    { id: "students", label: "Student Activity",       desc: "Per-student borrow and fine summary" },
  ];

  const fetchReport = async () => {
    setLoading(true);
    setError("");
    setReportData(null);
    try {
      const params = new URLSearchParams({ type: reportType });
      if (dateFrom) params.append("date_from", dateFrom);
      if (dateTo)   params.append("date_to",   dateTo);
      if (course !== "all") params.append("course", course);

      const res = await fetch(`${config.API_URL}/api/reports/hod?${params}`);
      const data = await res.json();
      if (!res.ok) { setError(data.detail || "Failed to load report"); return; }
      setReportData(data);
    } catch { setError("Could not connect to server"); }
    finally { setLoading(false); }
  };

  const downloadExcel = async () => {
    const params = new URLSearchParams({ type: reportType });
    if (dateFrom) params.append("date_from", dateFrom);
    if (dateTo)   params.append("date_to",   dateTo);
    if (course !== "all") params.append("course", course);
    try {
      // Fetched with the login token, then saved; window.open can't send it.
      const res = await fetch(`${config.API_URL}/api/reports/hod/export?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || "Failed to export report");
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${reportType}-report.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setError("Could not connect to server");
    }
  };

  const selectedType = REPORT_TYPES.find(r => r.id === reportType);

  return (
    <div className="page-content">
      <div className="dash-welcome">
        <h1>Reports</h1>
        <p>Generate, view and download reports for your institution.</p>
      </div>

      {/* Report type selector */}
      <p className="section-title">Select Report Type</p>
      <div className="report-type-grid">
        {REPORT_TYPES.map(rt => (
          <div
            key={rt.id}
            className={`report-type-card ${reportType === rt.id ? "report-type-active" : ""}`}
            onClick={() => { setReportType(rt.id); setReportData(null); }}
          >
            <div className="report-type-label">{rt.label}</div>
            <div className="report-type-desc">{rt.desc}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="report-filters-row">
        {/* Date range */}
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <div className="float-field" style={{ minWidth: "160px" }}>
            <input
              type="date"
              className="float-input"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              placeholder=" "
            />
            <label className="float-label">From Date</label>
          </div>
          <div className="float-field" style={{ minWidth: "160px" }}>
            <input
              type="date"
              className="float-input"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              placeholder=" "
            />
            <label className="float-label">To Date</label>
          </div>

          {/* Course filter */}
          <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
            <span className="eligibility-label" style={{ margin: 0 }}>Course:</span>
            {["all", ...Object.keys(COURSE_OPTIONS)].map(c => (
              <button
                key={c}
                className={course === c ? "approve-btn" : "logout-btn"}
                style={{ padding: "6px 12px", fontSize: "12px" }}
                onClick={() => setCourse(c)}
              >
                {c === "all" ? "All" : c}
              </button>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
          <button className="approve-btn" onClick={fetchReport} disabled={loading}>
            {loading ? "Loading..." : "Generate Report"}
          </button>
          {reportData && (
            <button className="logout-btn" onClick={downloadExcel}>
              ⬇ Download Excel
            </button>
          )}
        </div>
      </div>

      {error && <div className="error-box" style={{ marginTop: "12px" }}>{error}</div>}

      {/* Results */}
      {reportData && (
        <div style={{ marginTop: "20px" }}>
          {/* Summary cards */}
          {reportData.summary && (
            <>
              <p className="section-title">
                {selectedType?.label} — {reportData.total_rows} record{reportData.total_rows !== 1 ? "s" : ""}
                {dateFrom && ` from ${dateFrom}`}{dateTo && ` to ${dateTo}`}
              </p>
              <div className="stats-grid" style={{ marginBottom: "20px" }}>
                {Object.entries(reportData.summary).map(([label, value]) => (
                  <div className="stat-card" key={label}>
                    <div className="stat-value" style={{ fontSize: "18px" }}>{value}</div>
                    <div className="stat-label">{label}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Data table */}
          {reportData.rows && reportData.rows.length > 0 && (
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    {Object.keys(reportData.rows[0]).map(col => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reportData.rows.map((row, i) => (
                    <tr key={i}>
                      {Object.values(row).map((val, j) => (
                        <td key={j}>{val ?? "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {reportData.rows?.length === 0 && (
            <div className="empty-state">No records found for the selected filters.</div>
          )}
        </div>
      )}
    </div>
  );
}