import { useState } from "react";
import "./styles/auth.css";
import config from "../config";

export default function LoginForm({ setPage, onSuccess }) {
  const [rollNumber, setRollNumber] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setPending(false);
    setRejected(false);
    setLoading(true);
    try {
      const res = await fetch(`${config.API_URL}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roll_number: rollNumber, password }),
      });
      const data = await res.json();
      if (res.status === 403 && data.detail === "rejected") {
        setRejected(true);
        return;
      }
      if (res.status === 403 && data.detail === "pending") {
        setPending(true);
        return;
      }
      if (!res.ok) throw new Error(data.detail || "Login failed");
      onSuccess(data.user, data.access_token, data.needs_graduation_year);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="form" onSubmit={handleSubmit}>
      {error && <div className="error-box">{error}</div>}
      {pending && (
        <div className="pending-box">
          Your account is pending approval. You will be able to login once approved.
        </div>
      )}
      {rejected && (
        <div className="rejected-box">
          Your account has been rejected. Please contact the admin department for further assistance.
        </div>
      )}
      <input
        type="text"
        placeholder="College Roll Number"
        className="input"
        value={rollNumber}
        onChange={(e) => setRollNumber(e.target.value)}
        required
      />
      <input
        type="password"
        placeholder="Password"
        className="input"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <button className="button" disabled={loading}>
        {loading ? "Signing in..." : "Login"}
      </button>
      <p className="forgot" onClick={() => setPage("forgot")}>Forgot Password?</p>
    </form>
  );
}