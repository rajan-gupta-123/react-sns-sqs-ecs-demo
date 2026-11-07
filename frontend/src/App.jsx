import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

function MetricCard({ title, value, note }) {
  return <div className="metric"><span>{title}</span><strong>{value ?? "—"}</strong><small>{note}</small></div>;
}

export default function App() {
  const [metrics, setMetrics] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [orderId, setOrderId] = useState(`order-${Date.now()}`);
  const [amount, setAmount] = useState("249.99");

  async function refreshMetrics() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`${API}/api/metrics`);
      if (!response.ok) throw new Error(await response.text());
      setMetrics(await response.json());
    } catch (e) { setError(`Metrics request failed: ${e.message}`); }
    finally { setBusy(false); }
  }

  async function publish(simulateFailure = false) {
    setBusy(true); setError(""); setResult("");
    try {
      const response = await fetch(`${API}/api/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, amount: Number(amount), simulateFailure })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Publish failed");
      setResult(`Published to SNS. SNS Message ID: ${data.messageId}`);
      setOrderId(`order-${Date.now()}`);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  useEffect(() => { refreshMetrics(); }, []);

  return <main className="shell">
    <header>
      <div className="eyebrow">AWS EVENT-DRIVEN DEMO</div>
      <h1>SNS <i>→</i> SQS</h1>
      <p>Publish events, watch queue metrics, and observe the ECS worker process and delete messages.</p>
      <div className="badge">React dashboard · Express API · SQS worker</div>
    </header>

    <section className="panel">
      <div className="section-head"><div><div className="eyebrow">01 / PUBLISH</div><h2>Send an order event</h2></div></div>
      <div className="form">
        <label>Order ID<input value={orderId} onChange={e => setOrderId(e.target.value)} /></label>
        <label>Amount<input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label>
      </div>
      <div className="actions">
        <button disabled={busy} onClick={() => publish(false)}>Publish success message</button>
        <button className="secondary" disabled={busy} onClick={() => publish(true)}>Publish failure test</button>
      </div>
      <p className="hint">Both buttons publish through SNS. The failure test intentionally makes the worker throw an error, so the message is retried and can reach the DLQ.</p>
      {result && <div className="success">{result}</div>}
      {error && <div className="error">{error}</div>}
    </section>

    <section className="panel">
      <div className="section-head">
        <div><div className="eyebrow">02 / OBSERVE</div><h2>Queue metrics</h2></div>
        <button className="secondary compact" disabled={busy} onClick={refreshMetrics}>{busy ? "Loading…" : "Refresh metrics"}</button>
      </div>
      <div className="queue-title">Main SQS queue</div>
      <div className="metrics">
        <MetricCard title="Available" value={metrics?.main?.visible} note="Waiting to be received" />
        <MetricCard title="In flight" value={metrics?.main?.inFlight} note="Received, not deleted" />
        <MetricCard title="Delayed" value={metrics?.main?.delayed} note="Temporarily delayed" />
      </div>
      <div className="queue-title">Dead-letter queue</div>
      <div className="metrics">
        <MetricCard title="Available" value={metrics?.dlq?.visible} note="Failed messages waiting" />
        <MetricCard title="In flight" value={metrics?.dlq?.inFlight} note="Received from the DLQ" />
        <MetricCard title="Delayed" value={metrics?.dlq?.delayed} note="Delayed DLQ messages" />
      </div>
      <p className="hint">SQS counts are approximate. Refresh after publishing or processing; metrics may take a short time to update.</p>
    </section>

    <section className="panel flow">
      <div className="eyebrow">03 / MESSAGE LIFECYCLE</div>
      <h2>What happens behind the scenes?</h2>
      <div className="steps">
        <span>React UI</span><b>→</b><span>Express API</span><b>→</b><span>SNS</span><b>→</b><span>Main SQS</span><b>→</b><span>ECS worker</span>
      </div>
      <div className="outcomes"><div><strong>✓ Success</strong><p>Business logic completes, then worker calls DeleteMessage.</p></div><div><strong>↻ Failure</strong><p>Worker does not delete. Visibility timeout expires; SQS retries and may move it to the DLQ.</p></div></div>
    </section>
    <footer>Demo only · Do not expose an unauthenticated publish API in production.</footer>
  </main>;
}
