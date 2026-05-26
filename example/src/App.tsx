import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

const siteUrl = (import.meta.env.VITE_CONVEX_URL as string).replace(
  ".convex.cloud",
  ".convex.site",
);
const webhookUrl = `${siteUrl}/webhooks/revenuecat`;

const mono = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" };
const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: "14px 16px",
};

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      style={{
        ...mono,
        fontSize: 12,
        padding: "3px 9px",
        borderRadius: 999,
        background: ok ? "#dcfce7" : "#f1f5f9",
        color: ok ? "#166534" : "#64748b",
        border: `1px solid ${ok ? "#86efac" : "#e2e8f0"}`,
      }}
    >
      {label}
    </span>
  );
}

function Card({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <strong style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 0.4, color: "#475569" }}>
          {title}
        </strong>
        {count !== undefined && <span style={{ ...mono, color: "#94a3b8", fontSize: 12 }}>{count}</span>}
      </div>
      {children}
    </div>
  );
}

const dt = (ms?: number | null) => (ms ? new Date(ms).toLocaleString() : "—");
const empty = <span style={{ color: "#94a3b8", fontSize: 13 }}>none</span>;

export function App() {
  const [input, setInput] = useState("");
  const [appUserId, setAppUserId] = useState("");
  const status = useQuery(api.demo.status, appUserId ? { appUserId } : "skip");
  const events = useQuery(api.demo.recentEvents, appUserId ? { appUserId } : "skip");

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif", color: "#0f172a" }}>
      <h1 style={{ marginBottom: 4 }}>convex-revenuecat</h1>
      <p style={{ color: "#64748b", marginTop: 0 }}>
        Live subscription state, driven entirely by RevenueCat webhooks. Send an event from the RevenueCat
        dashboard (or make a Test Store purchase) and watch this update in real time.
      </p>
      <div style={{ ...card, ...mono, fontSize: 12, color: "#475569", marginBottom: 20 }}>
        webhook → <span style={{ color: "#0f172a" }}>{webhookUrl}</span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setAppUserId(input.trim());
        }}
        style={{ display: "flex", gap: 8, marginBottom: 20 }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="app_user_id from RevenueCat (e.g. the one your test event used)"
          style={{ ...mono, flex: 1, padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 14 }}
        />
        <button
          type="submit"
          style={{ padding: "10px 18px", border: 0, borderRadius: 8, background: "#0f172a", color: "#fff", fontSize: 14, cursor: "pointer" }}
        >
          Watch
        </button>
      </form>

      {!appUserId ? (
        <p style={{ color: "#94a3b8" }}>Enter an app_user_id to start watching.</p>
      ) : status === undefined ? (
        <p style={{ color: "#94a3b8" }}>Loading…</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <Badge ok={status.isSubscriber} label={status.isSubscriber ? "subscriber" : "not subscribed"} />
            <Badge ok={status.isInTrial} label={status.isInTrial ? "in trial / intro" : "not in trial"} />
            <Badge ok={status.gracePeriod.length > 0} label={`${status.gracePeriod.length} in grace`} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Card title="Active entitlements" count={status.activeEntitlements.length}>
              {status.activeEntitlements.length === 0
                ? empty
                : status.activeEntitlements.map((e) => (
                    <div key={e._id} style={{ ...mono, fontSize: 13, padding: "4px 0", borderBottom: "1px solid #f1f5f9" }}>
                      <strong>{e.entitlementId}</strong> · {e.store ?? "?"} · expires {dt(e.expiresAtMs)}
                    </div>
                  ))}
            </Card>

            <Card title="Subscriptions" count={status.subscriptions.length}>
              {status.subscriptions.length === 0
                ? empty
                : status.subscriptions.map((s) => (
                    <div key={s._id} style={{ ...mono, fontSize: 13, padding: "4px 0", borderBottom: "1px solid #f1f5f9" }}>
                      <strong>{s.productId}</strong> · {s.periodType} · renews {s.autoRenewStatus ? "yes" : "no"} · exp {dt(s.expirationAtMs)}
                    </div>
                  ))}
            </Card>

            <Card title="Customer">
              {status.customer ? (
                <div style={{ ...mono, fontSize: 13, lineHeight: 1.7 }}>
                  <div>original: {status.customer.originalAppUserId}</div>
                  <div>aliases: {status.customer.aliases.join(", ") || "—"}</div>
                  <div>country: {status.customer.countryCode ?? "—"}</div>
                  <div>first seen: {dt(status.customer.firstSeenAt)}</div>
                </div>
              ) : (
                empty
              )}
            </Card>

            <Card title="Virtual currency" count={status.virtualCurrency.length}>
              {status.virtualCurrency.length === 0
                ? empty
                : status.virtualCurrency.map((b) => (
                    <div key={b._id} style={{ ...mono, fontSize: 13, padding: "4px 0" }}>
                      <strong>{b.currencyCode}</strong>: {b.balance}
                    </div>
                  ))}
            </Card>

            <Card title="Invoices" count={status.invoices.length}>
              {status.invoices.length === 0
                ? empty
                : status.invoices.map((i) => (
                    <div key={i._id} style={{ ...mono, fontSize: 13, padding: "4px 0" }}>
                      {i.productId ?? "?"} · {i.priceUsd != null ? `$${i.priceUsd}` : "—"} · {dt(i.issuedAt)}
                    </div>
                  ))}
            </Card>

            <Card title="Recent webhook events" count={events?.length}>
              {!events || events.length === 0
                ? empty
                : events.map((ev) => (
                    <div key={ev._id} style={{ ...mono, fontSize: 12, padding: "3px 0", display: "flex", justifyContent: "space-between" }}>
                      <span>
                        <Badge ok={ev.status === "processed"} label={ev.status} /> {ev.eventType}
                      </span>
                      <span style={{ color: "#94a3b8" }}>{dt(ev.processedAt)}</span>
                    </div>
                  ))}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
