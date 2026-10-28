import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import config from "../../config";

const MAX_HISTORY_TURNS = 3;

const EMPTY_HINTS = {
  student: `Ask things like "what have I borrowed", "when is my book due", or "is Operating System Concepts available".`,
  librarian: `Ask things like "how many books are overdue right now", or give an instruction like "issue Operating System Concepts to PES1UG24CS001", "return copy BK-...-01" or "renew PES1UG24CS001's book". You'll get a confirmation card before anything changes.`,
  hod: `Ask things like "how many books are overdue right now" or "what has PES1UG24CS001 borrowed".`,
};

// Turns a failed request into a sentence that says what actually went wrong:
// the server's own explanation when it sent one (e.g. "OpenAI rejected the API
// key..."), otherwise the HTTP status, and a different message when the backend
// couldn't be reached at all.
async function describeFailure(resPromise) {
  let res;
  try {
    res = await resPromise;
  } catch {
    return { reason: "Couldn't reach the backend. Is it running? (try: docker compose ps)" };
  }
  let data = null;
  try { data = await res.json(); } catch { /* body wasn't JSON */ }
  return { res, data };
}

function failureReason(res, data) {
  if (data && typeof data.detail === "string" && data.detail) return data.detail;
  return `The server returned an error (HTTP ${res.status}). Check the backend logs: docker compose logs backend`;
}

export default function ChatbotWidget({ user, darkMode }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  // Each message: { question, answer, historyAnswer?, sql?, error?, pending? }
  // pending (librarian actions only): { action, copy_code, roll_number, summary,
  //   status: "pending" | "running" | "done" | "failed" | "cancelled", resultMessage? }
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open, loading]);

  const updateMessage = (index, patch) => {
    setMessages(prev => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  };

  const send = async () => {
    const question = input.trim();
    if (!question || loading) return;
    setInput("");
    setLoading(true);

    // historyAnswer lets an action turn tell the model what actually happened
    // (e.g. "cancelled", or the confirmed result) rather than just the preview.
    const history = messages
      .slice(-MAX_HISTORY_TURNS)
      .filter(m => !m.error)
      .map(m => ({ question: m.question, answer: m.historyAnswer || m.answer }));

    const { res, data, reason } = await describeFailure(
      fetch(`${config.API_URL}/api/chatbot/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, role: user.role, roll_number: user.roll_number, history }),
      })
    );

    try {
      if (reason) throw new Error(reason);
      if (!res.ok) throw new Error(failureReason(res, data));
      if (!data) throw new Error("The server sent a response the chat couldn't read.");

      const message = { question, answer: data.answer, sql: data.sql };
      if (data.pending_action) {
        message.pending = { ...data.pending_action, status: "pending" };
        message.historyAnswer = `${data.answer} (Not done yet — waiting for the librarian to confirm.)`;
      }
      setMessages(prev => [...prev, message]);
    } catch (err) {
      setMessages(prev => [...prev, { question, answer: err.message, error: true }]);
    } finally {
      setLoading(false);
    }
  };

  const confirmAction = async (index) => {
    const m = messages[index];
    if (!m || !m.pending || m.pending.status !== "pending") return;
    const pending = m.pending;
    updateMessage(index, { pending: { ...pending, status: "running" } });

    const { res, data, reason } = await describeFailure(
      fetch(`${config.API_URL}/api/chatbot/execute-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: pending.action,
          copy_code: pending.copy_code,
          roll_number: pending.roll_number,
          user_id: user.id,
        }),
      })
    );

    if (reason || !res.ok) {
      const why = reason || failureReason(res, data);
      updateMessage(index, {
        pending: { ...pending, status: "failed", resultMessage: why },
        historyAnswer: `${m.answer} Outcome: could not be done — ${why}`,
      });
      return;
    }

    updateMessage(index, {
      pending: { ...pending, status: data.ok ? "done" : "failed", resultMessage: data.message },
      historyAnswer: `${m.answer} Outcome: ${data.ok ? "done" : "could not be done"} — ${data.message}`,
    });
  };

  const cancelAction = (index) => {
    const m = messages[index];
    if (!m || !m.pending || m.pending.status !== "pending") return;
    updateMessage(index, {
      pending: { ...m.pending, status: "cancelled" },
      historyAnswer: `${m.answer} Outcome: cancelled by the librarian, nothing was changed.`,
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const renderActionCard = (m, i) => {
    const p = m.pending;
    return (
      <div className={`chatbot-action-card chatbot-action-${p.status}`}>
        {p.status === "pending" && (
          <div className="chatbot-action-buttons">
            <button className="chatbot-action-confirm" onClick={() => confirmAction(i)}>Confirm</button>
            <button className="chatbot-action-cancel" onClick={() => cancelAction(i)}>Cancel</button>
          </div>
        )}
        {p.status === "running" && <div className="chatbot-action-status">Working…</div>}
        {p.status === "done" && <div className="chatbot-action-status">Done — {p.resultMessage}</div>}
        {p.status === "failed" && <div className="chatbot-action-status">Not done — {p.resultMessage}</div>}
        {p.status === "cancelled" && <div className="chatbot-action-status">Cancelled. Nothing was changed.</div>}
      </div>
    );
  };

  // Rendered via a portal straight into document.body so this always
  // floats above the page regardless of any dashboard ancestor's own
  // CSS (fixed sidebars/topbars can otherwise trap position:fixed
  // children inside their own stacking context).
  //
  // Because a portal leaves the dashboard's DOM tree entirely, it no
  // longer inherits the --primary/--surface/etc. CSS variables scoped to
  // the dashboard's own ".dark"/".light" wrapper. So this carries its own
  // "dark"/"light" class, driven by the same darkMode state the dashboard
  // uses, to stay in sync with the current theme regardless of DOM position.
  return createPortal(
    <div className={`chatbot-widget ${darkMode ? "dark" : "light"}`}>
      {open && (
        <div className="chatbot-panel">
          <div className="chatbot-header">
            <span>Ask about the library</span>
            <button className="chatbot-close" onClick={() => setOpen(false)} aria-label="Close chat">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="chatbot-messages" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="chatbot-empty">{EMPTY_HINTS[user.role] || EMPTY_HINTS.hod}</div>
            )}
            {messages.map((m, i) => (
              <div className="chatbot-turn" key={i}>
                <div className="chatbot-bubble chatbot-bubble-user">{m.question}</div>
                <div className={`chatbot-bubble chatbot-bubble-bot ${m.error ? "chatbot-bubble-error" : ""}`}>
                  {m.answer}
                  {m.pending && renderActionCard(m, i)}
                  {m.sql && (
                    <details className="chatbot-sql-toggle">
                      <summary>View query</summary>
                      <code>{m.sql}</code>
                    </details>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="chatbot-turn">
                <div className="chatbot-bubble chatbot-bubble-bot chatbot-bubble-loading">Thinking…</div>
              </div>
            )}
          </div>

          <div className="chatbot-input-row">
            <textarea
              className="chatbot-input"
              placeholder="Ask a question..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
            />
            <button className="chatbot-send" onClick={send} disabled={loading || !input.trim()} aria-label="Send">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <button
        className="chatbot-bubble-toggle"
        onClick={() => setOpen(o => !o)}
        aria-label={open ? "Close chatbot" : "Open chatbot"}
      >
        {open ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        )}
      </button>
    </div>,
    document.body
  );
}
