import React, { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, Sparkles, X } from "lucide-react";
import { api } from "../../api.js";

const SUGGESTIONS = [
  "Why is my shipment delayed?",
  "Which checkpoint is the biggest risk?",
  "Explain the P90 ETA in simple words.",
];

/**
 * Floating AI chat assistant. Uses the selected shipment's prediction as
 * context automatically; the backend LLM only explains engine facts.
 * Degrades to an inline error message when the LLM is unreachable.
 */
export default function ChatAssistant({ prediction, available }) {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log, open]);

  // New shipment → fresh conversation scoped to it.
  useEffect(() => {
    setLog([]);
    setInput("");
  }, [prediction?.shipment_id]);

  if (!prediction) return null;
  const label = prediction?.shipment_id || prediction?.route_name || "current shipment";

  const send = async (raw) => {
    const q = String(raw ?? input).trim();
    if (!q || busy) return;
    setInput("");
    const next = [...log, { role: "user", content: q }];
    setLog(next);
    setBusy(true);
    try {
      const res = await api.llmChat(prediction, q, next.slice(-8));
      const text = res?.text;
      setLog([
        ...next,
        text
          ? { role: "assistant", content: text }
          : { role: "assistant", content: "The AI assistant is unavailable right now (LLM offline).", error: true },
      ]);
    } catch {
      setLog([
        ...next,
        { role: "assistant", content: "Couldn't reach the AI assistant. Is the backend running?", error: true },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        className="chat-fab"
        onClick={() => setOpen((o) => !o)}
        title="Ask the LOGIX AI assistant"
        aria-label="Open AI chat assistant"
        aria-expanded={open}
      >
        {open ? <X size={22} aria-hidden="true" /> : <MessageCircle size={22} aria-hidden="true" />}
      </button>
      {open && (
        <div className="chat-panel" role="dialog" aria-label="LOGIX AI assistant">
          <div className="chat-head">
            <Sparkles size={15} aria-hidden="true" />
            LOGIX AI Assistant
            <button className="chat-close" onClick={() => setOpen(false)} aria-label="Close chat">×</button>
          </div>
          <div className="chat-shipment">Answering from: {label}</div>
          <div className="chat-log" ref={logRef}>
            {log.length === 0 && (
              <div className="chat-msg assistant">
                Ask about delays, checkpoints, ETA values or routes for this shipment.
              </div>
            )}
            {log.map((m, i) => (
              <div key={i} className={`chat-msg ${m.role}${m.error ? " error" : ""}`}>
                {m.content}
              </div>
            ))}
            {busy && <div className="chat-msg assistant">Thinking…</div>}
          </div>
          {log.length === 0 && (
            <div className="chat-suggest">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chat-chip" onClick={() => send(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          )}
          <form
            className="chat-form"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about this shipment…"
              aria-label="Ask about this shipment"
              maxLength={500}
            />
            <button className="btn" type="submit" disabled={busy || !input.trim()} aria-label="Send">
              <Send size={14} aria-hidden="true" />
            </button>
          </form>
          {available === false && (
            <div className="chat-note">LLM offline — answers may be unavailable.</div>
          )}
        </div>
      )}
    </>
  );
}
