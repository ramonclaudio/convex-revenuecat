import { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { Purchases, type Package } from "@revenuecat/purchases-js";
import { api } from "../convex/_generated/api";

// Fixed demo identity, no sign-in or manual entry. The Web SDK purchases as
// this user, RevenueCat fires a webhook for it, and the panels below read it.
const APP_USER_ID = "demo-user";
const PARTNER = "demo-user-alt";
const rcKey = import.meta.env.VITE_REVENUECAT_API_KEY as string;
const siteUrl = (import.meta.env.VITE_CONVEX_URL as string).replace(
  ".convex.cloud",
  ".convex.site",
);
const webhookUrl = `${siteUrl}/webhooks/revenuecat`;

function rc(): Purchases {
  if (!Purchases.isConfigured())
    Purchases.configure({ apiKey: rcKey, appUserId: APP_USER_ID });
  return Purchases.getSharedInstance();
}

// Events RevenueCat won't emit on demand (billing issues, expiration, refunds,
// transfers, currency...) so they're simulated through the real webhook path.
const GROUPS: { group: string; items: [string, string][] }[] = [
  {
    group: "Subscription lifecycle",
    items: [
      ["RENEWAL", "Renew"],
      ["PRODUCT_CHANGE", "Change plan"],
      ["EXTEND", "Extend"],
      ["UNSUBSCRIBE", "Unsubscribe"],
      ["UNCANCELLATION", "Re-subscribe"],
      ["PAUSE", "Pause"],
    ],
  },
  {
    group: "Billing & refunds",
    items: [
      ["BILLING_ISSUE", "Billing issue → grace"],
      ["EXPIRATION", "Expire → revoke"],
      ["REFUND", "Refund"],
      ["REFUND_REVERSED", "Refund reversed"],
    ],
  },
  {
    group: "One-time & currency",
    items: [
      ["NON_RENEWING", "Non-renewing purchase"],
      ["TEMP_GRANT", "Temporary grant"],
      ["VC_GRANT", "Grant 500 coins"],
      ["VC_SPEND", "Spend 100 coins"],
      ["INVOICE", "Issue invoice"],
    ],
  },
  {
    group: "Identity & other",
    items: [
      ["EXPERIMENT", "Enroll experiment"],
      ["TRANSFER", "Transfer out →"],
      ["REDEEM", "Redeem (alias in)"],
      ["TEST", "Test event"],
    ],
  },
];

const mono = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" };
const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: "14px 16px",
};
const dt = (ms?: number | null) => (ms ? new Date(ms).toLocaleString() : "—");
const empty = <span style={{ color: "#94a3b8", fontSize: 13 }}>none</span>;

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
function Card({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div style={card}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <strong
          style={{
            fontSize: 13,
            textTransform: "uppercase",
            letterSpacing: 0.4,
            color: "#475569",
          }}
        >
          {title}
        </strong>
        {count !== undefined && (
          <span style={{ ...mono, color: "#94a3b8", fontSize: 12 }}>
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
const btn: React.CSSProperties = {
  ...mono,
  fontSize: 12,
  padding: "6px 10px",
  borderRadius: 7,
  border: "1px solid #cbd5e1",
  background: "#f8fafc",
  color: "#0f172a",
  cursor: "pointer",
};

export function App() {
  const [pkgs, setPkgs] = useState<Package[] | null>(null);
  const [offErr, setOffErr] = useState<string | null>(null);
  const [buyMsg, setBuyMsg] = useState<string | null>(null);
  const [simMsg, setSimMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const status = useQuery(api.demo.status, { appUserId: APP_USER_ID });
  const events = useQuery(api.demo.recentEvents, { appUserId: APP_USER_ID });
  const fire = useMutation(api.simulate.fire);

  useEffect(() => {
    rc()
      .getOfferings()
      .then((o) => setPkgs(o.current?.availablePackages ?? []))
      .catch((e) => setOffErr(e instanceof Error ? e.message : String(e)));
  }, []);

  async function buy(pkg: Package) {
    setBuyMsg(`opening checkout for ${pkg.webBillingProduct.title}…`);
    try {
      await rc().purchase({ rcPackage: pkg });
      setBuyMsg(
        `purchased ${pkg.webBillingProduct.title} — webhook landing below`,
      );
    } catch (e) {
      setBuyMsg(`purchase: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function sim(scenario: string) {
    setBusy(true);
    try {
      const r = await fire({
        appUserId: APP_USER_ID,
        scenario,
        toAppUserId: PARTNER,
      });
      setSimMsg(`${r.type} → ${r.processed ? "processed" : "ignored"}`);
    } catch (e) {
      setSimMsg(`error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        maxWidth: 1080,
        margin: "0 auto",
        padding: 24,
        fontFamily: "system-ui, sans-serif",
        color: "#0f172a",
      }}
    >
      <h1 style={{ marginBottom: 4 }}>convex-revenuecat</h1>
      <p style={{ color: "#64748b", marginTop: 0 }}>
        Real purchases through the RevenueCat Web SDK, plus a simulator for the
        events RevenueCat won't emit on demand. Every action drives the live
        component state below, no sign-in, watching{" "}
        <code style={mono}>{APP_USER_ID}</code>.
      </p>
      <div
        style={{
          ...card,
          ...mono,
          fontSize: 12,
          color: "#475569",
          marginBottom: 20,
        }}
      >
        webhook → <span style={{ color: "#0f172a" }}>{webhookUrl}</span>
      </div>

      <div style={{ ...card, marginBottom: 14 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <strong
            style={{
              fontSize: 13,
              textTransform: "uppercase",
              letterSpacing: 0.4,
              color: "#475569",
            }}
          >
            Buy (real RevenueCat purchase)
          </strong>
          {buyMsg && (
            <span style={{ ...mono, fontSize: 12, color: "#166534" }}>
              {buyMsg}
            </span>
          )}
        </div>
        {offErr ? (
          <span style={{ ...mono, fontSize: 12, color: "#b91c1c" }}>
            offerings: {offErr}
          </span>
        ) : pkgs === null ? (
          <span style={{ color: "#94a3b8", fontSize: 13 }}>
            loading offering…
          </span>
        ) : pkgs.length === 0 ? (
          empty
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {pkgs.map((p) => (
              <button
                key={p.identifier}
                onClick={() => buy(p)}
                style={{
                  ...btn,
                  background: "#0f172a",
                  color: "#fff",
                  border: 0,
                  padding: "8px 14px",
                  fontSize: 13,
                }}
              >
                {p.webBillingProduct.title}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ ...card, marginBottom: 20 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <strong
            style={{
              fontSize: 13,
              textTransform: "uppercase",
              letterSpacing: 0.4,
              color: "#475569",
            }}
          >
            Simulate webhook
          </strong>
          {simMsg && (
            <span
              style={{
                ...mono,
                fontSize: 12,
                color: busy ? "#94a3b8" : "#166534",
              }}
            >
              {simMsg}
            </span>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
          {GROUPS.map((g) => (
            <div key={g.group}>
              <div
                style={{
                  fontSize: 11,
                  color: "#94a3b8",
                  marginBottom: 6,
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                }}
              >
                {g.group}
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  maxWidth: 250,
                }}
              >
                {g.items.map(([scenario, label]) => (
                  <button
                    key={scenario}
                    onClick={() => sim(scenario)}
                    disabled={busy}
                    style={{ ...btn, opacity: busy ? 0.5 : 1 }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {status === undefined ? (
        <p style={{ color: "#94a3b8" }}>Loading {APP_USER_ID}…</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <Badge
              ok={status.isSubscriber}
              label={status.isSubscriber ? "subscriber" : "not subscribed"}
            />
            <Badge
              ok={status.isInTrial}
              label={status.isInTrial ? "in trial / intro" : "not in trial"}
            />
            <Badge
              ok={status.gracePeriod.length > 0}
              label={`${status.gracePeriod.length} in grace`}
            />
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
          >
            <Card
              title="Active entitlements"
              count={status.activeEntitlements.length}
            >
              {status.activeEntitlements.length === 0
                ? empty
                : status.activeEntitlements.map((e) => (
                    <div
                      key={e._id}
                      style={{
                        ...mono,
                        fontSize: 13,
                        padding: "4px 0",
                        borderBottom: "1px solid #f1f5f9",
                      }}
                    >
                      <strong>{e.entitlementId}</strong> · {e.store ?? "?"} ·
                      expires {dt(e.expiresAtMs)}
                    </div>
                  ))}
            </Card>
            <Card title="Subscriptions" count={status.subscriptions.length}>
              {status.subscriptions.length === 0
                ? empty
                : status.subscriptions.map((s) => (
                    <div
                      key={s._id}
                      style={{
                        ...mono,
                        fontSize: 13,
                        padding: "4px 0",
                        borderBottom: "1px solid #f1f5f9",
                      }}
                    >
                      <strong>{s.productId}</strong> · {s.periodType} · renews{" "}
                      {s.autoRenewStatus ? "yes" : "no"} · exp{" "}
                      {dt(s.expirationAtMs)}
                    </div>
                  ))}
            </Card>
            <Card title="Customer">
              {status.customer ? (
                <div style={{ ...mono, fontSize: 13, lineHeight: 1.7 }}>
                  <div>original: {status.customer.originalAppUserId}</div>
                  <div>
                    aliases: {status.customer.aliases.join(", ") || "—"}
                  </div>
                  <div>country: {status.customer.countryCode ?? "—"}</div>
                  <div>first seen: {dt(status.customer.firstSeenAt)}</div>
                </div>
              ) : (
                empty
              )}
            </Card>
            <Card
              title="Virtual currency"
              count={status.virtualCurrency.length}
            >
              {status.virtualCurrency.length === 0
                ? empty
                : status.virtualCurrency.map((b) => (
                    <div
                      key={b._id}
                      style={{ ...mono, fontSize: 13, padding: "4px 0" }}
                    >
                      <strong>{b.currencyCode}</strong>: {b.balance}
                    </div>
                  ))}
            </Card>
            <Card title="Invoices" count={status.invoices.length}>
              {status.invoices.length === 0
                ? empty
                : status.invoices.map((i) => (
                    <div
                      key={i._id}
                      style={{ ...mono, fontSize: 13, padding: "4px 0" }}
                    >
                      {i.productId ?? "?"} ·{" "}
                      {i.priceUsd != null ? `$${i.priceUsd}` : "—"} ·{" "}
                      {dt(i.issuedAt)}
                    </div>
                  ))}
            </Card>
            <Card title="Recent webhook events" count={events?.length}>
              {!events || events.length === 0
                ? empty
                : events.map((ev) => (
                    <div
                      key={ev._id}
                      style={{
                        ...mono,
                        fontSize: 12,
                        padding: "3px 0",
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <span>
                        <Badge
                          ok={ev.status === "processed"}
                          label={ev.status}
                        />{" "}
                        {ev.eventType}
                      </span>
                      <span style={{ color: "#94a3b8" }}>
                        {dt(ev.processedAt)}
                      </span>
                    </div>
                  ))}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
