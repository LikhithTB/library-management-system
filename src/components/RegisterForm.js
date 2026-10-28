import { useState } from "react";
import "./styles/auth.css";
import config from "../config";

export default function RegisterForm({ setPage, onSuccess }) {
  const [form, setForm] = useState({ roll_number: "", email: "", password: "", confirm: "", role: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState(null); // "approved" or "pending"

  const isStudent = (form.email || "").includes(config.STUDENT_EMAIL_IDENTIFIER);
  const needsApproval = !isStudent && (
  config.ROLES_REQUIRING_HOD_APPROVAL.includes(form.role) ||
  config.ROLES_REQUIRING_ADMIN_APPROVAL.includes(form.role)
);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (form.password !== form.confirm) { setError("Passwords do not match"); return; }
    if (!isStudent && !form.role) { setError("Please select your role"); return; }
    setLoading(true);
    try {
      const body = { roll_number: form.roll_number, email: form.email, password: form.password };
      if (!isStudent) body.role = form.role;
      const res = await fetch(`${config.API_URL}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Registration failed");

      if (data.user.is_approved) {
        onSuccess(data.user, data.access_token, data.needs_graduation_year);
      } else {
        setRegistered("pending");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Show pending message after registration
  if (registered === "pending") {
    return (
      <div className="form">
        <div className="pending-box">
          <strong>Account created successfully!</strong>
          <p>Your account is awaiting approval. You can login once it has been approved.</p>
        </div>
        <button className="button" onClick={() => setPage("login")}>Back to Login</button>
      </div>
    );
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      {error && <div className="error-box">{error}</div>}
      <input name="roll_number" type="text" placeholder="College Roll Number" className="input" value={form.roll_number} onChange={handleChange} required />
      <input name="email" type="email" placeholder="College Email" className="input" value={form.email} onChange={handleChange} required />
      {form.email && (
        <div className="role-badge">
          {isStudent ? "Detected as: Student" : "Non-student email — select role below"}
        </div>
      )}
      {form.email && !isStudent && (
        <select name="role" className="input select" value={form.role} onChange={handleChange} required>
          <option value="">Select your role</option>
          {config.NON_STUDENT_ROLES.map(r => (
            <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
          ))}
        </select>
      )}
      {needsApproval && (
  <div className="role-warning">
    {config.ROLES_REQUIRING_ADMIN_APPROVAL.includes(form.role)
      ? "This role requires Admin approval before you can login"
      : "This role requires HOD approval before you can login"}
  </div>
)}
      {!isStudent && form.role && !needsApproval && (
        <div className="role-warning">Role cannot be changed after registration</div>
      )}
      <input name="password" type="password" placeholder="Password" className="input" value={form.password} onChange={handleChange} required />
      <input name="confirm" type="password" placeholder="Confirm Password" className="input" value={form.confirm} onChange={handleChange} required />
      <button className="button" disabled={loading}>{loading ? "Registering..." : "Register"}</button>
    </form>
  );
}