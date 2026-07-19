import { CopyHex } from "@/components/CopyHex";
import { shortHex } from "@/lib/story-data";

const EXPLORER = {
  program: "https://explorer.solana.com/address/34vPxZ79ENBhEaTn5SCC65J91zSXNKxTmcJe6YD7oRAv",
  verifyOutcomeTx:
    "https://explorer.solana.com/tx/3H1ZGmU9Kqn8YSdhQyp4b7yJnAKac7DUuAYDDLkAS8nXDxKgbZE9mBXpzbc6UgKmCksGNkWpQSGrek7bk3cLRb2q",
  publishOutcomeTx:
    "https://explorer.solana.com/tx/htbc11WxKJvnMbXFsRQkRHsVJ94mxnnMDcvyPjB1oeyug7KbDCAYSxvxX2Ca9Cwzb3u24xka9BV1egHVhRMChR6",
  vaa: "https://api.wormholescan.io/api/v1/vaas/1/c6a1fe20518b7dffed790c41cdd9a33d6df614f02dfe4d7a17bc9904d51ff4b9/1",
};

const PROGRAM_ID = "34vPxZ79ENBhEaTn5SCC65J91zSXNKxTmcJe6YD7oRAv";
const VERIFIED_OUTCOME_PDA = "HjGX9n1MBZeEaJtfiYXZP1NXiaRpvsbgaoeU2s8jWZyb";
const WORMHOLE_CORE = "worm2ZoG…";

function ReceiptLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="mono" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export function WormholeTrack() {
  return (
    <section className="story-section" id="wormhole-track">
      <div className="story-section-head">
        <span className="story-num">04B</span>
        <h2>Parallel wormhole track</h2>
      </div>
      <p className="story-dek">
        A second, wormhole-enabled Proofline adapter was deployed to Solana mainnet as a{" "}
        <strong style={{ color: "var(--text)" }}>new program id</strong> during the Final and
        attested the live match with real Wormhole guardian signatures — same verified source as
        the primary program, built with the Wormhole emission leg enabled (407,384&nbsp;B).
      </p>

      <div className="panel receipt-panel">
        <h3>
          Program — second deployment, Wormhole emission leg{" "}
          <span className="chip ok" style={{ fontSize: 10, marginLeft: 8 }}>SOLANA MAINNET</span>
        </h3>
        <div className="receipt-row">
          <span className="rlabel">Program id</span>
          <ReceiptLink href={EXPLORER.program}>{shortHex(PROGRAM_ID, 14, 8)}</ReceiptLink>
          <CopyHex value={PROGRAM_ID} label="wormhole-track program id" />
        </div>
      </div>

      <div className="panel receipt-panel">
        <h3>
          Live Final — outcome verified on-chain{" "}
          <span className="chip active" style={{ fontSize: 10, marginLeft: 8 }}>FIXTURE 18257739 · 1–0</span>
        </h3>
        <p className="small dim" style={{ margin: "6px 0 10px" }}>
          <code className="mono">verify_outcome</code> tx = real TxLINE CPI against the epochDay-20653
          daily root, exact one-byte <code className="mono">true</code>, finalized + second-RPC
          readback. Result: home.
        </p>
        <div className="receipt-row">
          <span className="rlabel">verify_outcome tx</span>
          <ReceiptLink href={EXPLORER.verifyOutcomeTx}>
            {shortHex(
              "3H1ZGmU9Kqn8YSdhQyp4b7yJnAKac7DUuAYDDLkAS8nXDxKgbZE9mBXpzbc6UgKmCksGNkWpQSGrek7bk3cLRb2q",
              14,
              8,
            )}
          </ReceiptLink>
          <span className="chip ok" style={{ fontSize: 10 }}>true</span>
        </div>
        <div className="receipt-row">
          <span className="rlabel">VerifiedOutcome PDA</span>
          <CopyHex value={VERIFIED_OUTCOME_PDA} label="verified outcome PDA" />
        </div>
      </div>

      <div className="panel receipt-panel">
        <h3>
          Wormhole guardian VAA over the live attestation{" "}
          <span className="chip active" style={{ fontSize: 10, marginLeft: 8 }}>REAL GUARDIAN SET</span>
        </h3>
        <p className="small" style={{ margin: "6px 0 10px" }}>
          <strong style={{ color: "var(--text)" }}>
            Real Wormhole guardian VAA over the live attestation
          </strong>
          : <code className="mono">publish_outcome</code> went through the real core bridge (
          <code className="mono">{WORMHOLE_CORE}</code>) — guardian set 7, 13 signatures, emitter
          sequence 1, a 1,091-byte VAA carrying a 176-byte <code className="mono">MatchOutcomeV1</code>{" "}
          payload byte-equal to the on-chain outcome.
        </p>
        <div className="receipt-row">
          <span className="rlabel">publish_outcome tx</span>
          <ReceiptLink href={EXPLORER.publishOutcomeTx}>
            {shortHex(
              "htbc11WxKJvnMbXFsRQkRHsVJ94mxnnMDcvyPjB1oeyug7KbDCAYSxvxX2Ca9Cwzb3u24xka9BV1egHVhRMChR6",
              14,
              8,
            )}
          </ReceiptLink>
        </div>
        <div className="receipt-row">
          <span className="rlabel">VAA</span>
          <ReceiptLink href={EXPLORER.vaa}>view on Wormholescan ↗</ReceiptLink>
          <span className="tiny dim">guardian set 7 · 13 signatures · emitter seq 1 · 1,091 B</span>
        </div>
      </div>

      <p className="tiny faint" style={{ marginTop: 4 }}>
        Pre-whistle smoke test: the same full chain was proven against the completed 3rd-place
        fixture (18257865, 4–6) before the Final.
      </p>
    </section>
  );
}
