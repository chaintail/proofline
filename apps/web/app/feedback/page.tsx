/**
 * Feedback — TxODDS/TxLINE integration debrief. What worked building
 * against the real product, the field notes that cost real hours, and
 * what we'd ask TxLINE to publish or ship next. Every fact here comes
 * from our own integration run; nothing invented, nothing simulated.
 */
import Link from "next/link";
import { Plate, PlateHead, SectionIndex, Reveal, StampReal } from "@/components/chrome";
import { IconCheck, IconCircuit, IconDoc, IconExternal, IconPulse, IconShield } from "@/components/icons";

interface Worked {
  key: string;
  icon: React.ComponentType<{ size?: number }>;
  title: string;
  body: React.ReactNode;
}

const WORKED: Worked[] = [
  {
    key: "a",
    icon: IconCheck,
    title: "The verifier is the real product",
    body: (
      <>
        The deployed on-chain verifier is the real thing — we CPI&apos;d{" "}
        <code className="mono">validateStatV2</code> on Solana mainnet against the live daily
        root and got a byte-exact <code className="mono">true</code> for a Merkle proof fetched
        over the free API minutes earlier. It worked the first time our payload was right.
      </>
    ),
  },
  {
    key: "b",
    icon: IconPulse,
    title: "Proof latency at the whistle",
    body: (
      <>
        At the World Cup Final&apos;s final whistle: finalisation event to a fetchable V2
        stat-validation proof, in under a minute — free tier, no rate limits. We attested the
        Final on mainnet <strong className="hi">4 minutes</strong> after the whistle.
      </>
    ),
  },
  {
    key: "c",
    icon: IconCircuit,
    title: "The daily-root PDA scheme is clean",
    body: (
      <>
        Epoch-day seeds are clean and derivable client-side — we computed today&apos;s
        epoch-day root address before it was referenced anywhere in the response, and it
        matched.
      </>
    ),
  },
  {
    key: "d",
    icon: IconShield,
    title: "Data is real and rich",
    body: (
      <>
        A full <strong className="hi">1,385-sequence</strong> event stream for the Final,
        per-stat Merkle proofs, verifiable end to end.
      </>
    ),
  },
];

interface Gotcha {
  n: string;
  title: string;
  body: React.ReactNode;
}

const GOTCHAS: Gotcha[] = [
  {
    n: "01",
    title: "Finalisation is action-based, not status-based",
    body: (
      <>
        <code className="mono">game_finalised</code> arrives with{" "}
        <code className="mono">GameState: &quot;scheduled&quot;</code> and empty{" "}
        <code className="mono">Data</code> — no StatusId 100 anywhere on the event. Consumers
        mapping on status alone silently miss the whistle. We only caught this by rehearsing
        against a completed fixture first.
      </>
    ),
  },
  {
    n: "02",
    title: "Scores live under numeric stat-id keys",
    body: (
      <>
        Home/away scores sit in the Stats bag under numeric stat-id keys (
        <code className="mono">&quot;1&quot;</code> home, <code className="mono">&quot;2&quot;</code>{" "}
        away) — no named fields, no published registry. We cross-validated against the proof&apos;s
        own <code className="mono">statsToProve</code>.
      </>
    ),
  },
  {
    n: "03",
    title: "Undocumented params, and an exact-match timestamp rule",
    body: (
      <>
        stat-validation 404s without <code className="mono">seq</code>; the required params
        were discoverable only by trial. And the on-chain payload timestamp must equal{" "}
        <code className="mono">summary.updateStats.minTimestamp</code> exactly — otherwise the
        verifier throws <code className="mono">TimestampMismatch</code>.
      </>
    ),
  },
  {
    n: "04",
    title: "Two-token auth, learned via 401s",
    body: (
      <>
        Every data request needs both a guest JWT from{" "}
        <code className="mono">/auth/guest/start</code> and an{" "}
        <code className="mono">X-Api-Token</code> header. Nothing states this up front.
      </>
    ),
  },
  {
    n: "05",
    title: "The “snapshot” is an append-only log",
    body: (
      <>
        The scores &quot;snapshot&quot; is actually an append-only event list — the max-
        <code className="mono">Seq</code> item is the current state, not a single mutable
        record.
      </>
    ),
  },
];

const RECOMMENDATIONS: React.ReactNode[] = [
  <>Publish the finalisation-event contract (action vs. status semantics) plus an official stat-id registry.</>,
  <>Document two-token auth, stat-validation&apos;s required params, and the minTimestamp-must-match rule prominently.</>,
  <>
    Officially publish the program IDL and instruction discriminators — we pinned repo commit{" "}
    <code className="mono">f7e3bcd5db4c6744445f75dfab7eccc879c6d2de</code> to be safe.
  </>,
  <>A push / WebSocket channel for finalisation would beat 30s polling for settlement use-cases.</>,
  <>
    An official SDK would have saved most of the above — similar to the{" "}
    <a href="https://github.com/0xPulsePlay/txline-kit" target="_blank" rel="noreferrer">
      0xPulsePlay/txline-kit
    </a>{" "}
    SDK.
  </>,
];

export default function FeedbackPage() {
  return (
    <div className="shell">
      <section style={{ padding: "30px 0 0" }}>
        <Reveal>
          <div className="row mb-2">
            <span className="glyph dim"><IconDoc size={20} /></span>
            <StampReal>FIELD REPORT</StampReal>
          </div>
          <h1 className="display" style={{ fontSize: "clamp(32px, 5.4vw, 56px)" }}>
            TxODDS / TxLINE — <span className="hl">the integration debrief.</span>
          </h1>
          <p className="lede mt-2" style={{ fontSize: 15.5 }}>
            What worked building against the real product, the field notes that cost real
            hours, and what we&apos;d ask TxLINE to ship or publish next. Everything below came
            out of our own integration run — nothing here is invented or simulated.
          </p>
        </Reveal>
      </section>

      <div className="sec">
        <SectionIndex no="01" title="What worked" />
        <div className="forge-grid">
          {WORKED.map((w) => {
            const Icon = w.icon;
            return (
              <Reveal key={w.key}>
                <Plate glow="sol" className="mb-0">
                  <PlateHead kicker={`EXHIBIT ${w.key.toUpperCase()}`} title={w.title}>
                    <span className="glyph dim"><Icon size={16} /></span>
                  </PlateHead>
                  <p className="small dim m-0" style={{ lineHeight: 1.6 }}>{w.body}</p>
                </Plate>
              </Reveal>
            );
          })}
        </div>
      </div>

      <div className="sec">
        <SectionIndex no="02" title="Gotchas — field notes" />
        <Reveal>
          <p className="small dim" style={{ maxWidth: 640, marginTop: -6 }}>
            Each of these cost real integration hours. Listed in the order we hit them.
          </p>
          <ol className="gates">
            {GOTCHAS.map((g) => (
              <li key={g.n}>
                <span className="gno">{g.n}</span>
                <span>
                  <strong className="hi">{g.title}</strong>
                  <span className="tiny dim" style={{ display: "block", marginTop: 3, lineHeight: 1.55 }}>
                    {g.body}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </Reveal>
      </div>

      <div className="sec">
        <SectionIndex no="03" title="Recommendations" />
        <Reveal>
          <Plate>
            <PlateHead kicker="TO TXLINE" title="What would have saved the most time" />
            <ul className="stack-sm m-0" style={{ listStyle: "none", padding: 0 }}>
              {RECOMMENDATIONS.map((r, i) => (
                <li key={i} className="row" style={{ alignItems: "flex-start", gap: 10 }}>
                  <span className="tiny faint mono" style={{ minWidth: 16 }}>{`0${i + 1}`}</span>
                  <span className="small dim" style={{ lineHeight: 1.6 }}>{r}</span>
                </li>
              ))}
            </ul>
            <div className="row mt-3">
              <a className="btn primary sm" href="https://github.com/0xPulsePlay/txline-kit" target="_blank" rel="noreferrer">
                txline-kit repo <IconExternal size={12} />
              </a>
              <a className="btn sm" href="https://txline-kit.0xpulseplay.com" target="_blank" rel="noreferrer">
                txline-kit docs <IconExternal size={12} />
              </a>
            </div>
          </Plate>
        </Reveal>
      </div>

      <div className="sec">
        <Plate>
          <p className="tiny dim m-0">
            This feedback describes our own TxODDS/TxLINE integration for Proofline. See{" "}
            <Link href="/mainnet">Mainnet</Link> for the on-chain evidence this integration
            produced, and <Link href="/story">Story</Link> for the full submission narrative.
          </p>
        </Plate>
      </div>
    </div>
  );
}
