import { useState } from "react";
import "./styles/auth.css";
export default function ForgotForm({ setPage }) {
  const [rollNumber, setRollNumber] = useState("");

  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); setPage("message"); }}>
      <input
        type="text"
        placeholder="Enter Roll Number"
        className="input"
        value={rollNumber}
        onChange={(e) => setRollNumber(e.target.value)}
        required
      />
      <button type="submit" className="button">Send Reset Link</button>
      <p className="forgot" onClick={() => setPage("login")}>← Back to Login</p>
    </form>
  );
}