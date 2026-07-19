//! # Proofline Adapter — Level 4 source leg (Solana, Anchor)
//!
//! Verifies a TxLINE final-score Merkle proof by CPI into TxLINE's own
//! deployed TxOracle verifier (`validate_stat_v2`) and mints an immutable
//! `VerifiedOutcome` PDA. The unaudited Wormhole publication leg is excluded
//! from default/mainnet builds and requires the explicit `wormhole` feature.
//!
//! ## Deployment status — READ THIS FIRST
//!
//! TxLINE's TxOracle verifier exists on Solana mainnet. This adapter pins its
//! official CPI ABI and mainnet program id. Deployment remains an operator
//! action; this source never contains or reads deployment authority material.
//!
//! ## One-paragraph security story
//!
//! A relayer can delay an outcome, but it cannot change one. The adapter
//! records only fields extracted from the exact official input after the
//! hardcoded mainnet TxLINE program returns the exact byte `0x01`.
//!
//! ## The flow
//!
//! 1. **`verify_outcome`** (or CRE's `on_report`): accept the official full
//!    input + strategy, derive the daily root from `min_timestamp`, CPI into
//!    mainnet TxLINE, strictly check return data, then mint the outcome PDA.
//! 2. **Optional `publish_outcome` (`wormhole` feature only):** load the PDA,
//!    require it unpublished, serialize the 176-byte big-endian
//!    `MatchOutcomeV1`, post it via the Wormhole core bridge signed by this
//!    program's single `["emitter"]` PDA, record emitter + sequence, and
//!    latch `published = true` (re-publish reverts).
//!
//! ## Trust assumptions (explicit, §3.10)
//!
//! - **Upgrade authority (§3.10 item 9):** were this deployed, the program
//!   upgrade authority could replace this code and therefore forge
//!   attestations; that authority IS a trust assumption and must be burned
//!   (set to `None`) or moved to governance after deployment. Stated here
//!   because it is invisible in source code.
//! - **No admin power (§3.10 item 3):** `Config.admin` is provenance only.
//!   There is no config-update instruction and no admin publish path; the
//!   only road to a Wormhole message is a `VerifiedOutcome` minted by a
//!   successful TxOracle CPI.
//! - **Untrusted roles:** relayers and even the CRE
//!   forwarder are liveness roles. None of them can alter WHAT gets
//!   attested — TxOracle's exact-equality verdict and the payload derived
//!   from it are the only inputs Base will ever see.
//! - **TxOracle correctness:** this design deliberately reuses TxLINE's own
//!   deployed verifier as the source of truth instead of reimplementing its
//!   byte-level Merkle encoding (§3.3).
//!
//! Cross-language payload truth lives in `packages/protocol` and is pinned
//! by `packages/test-vectors/match-outcome-v1.json`; see
//! `tests/payload_conformance.rs`.

use anchor_lang::prelude::*;

pub mod instructions;
pub mod state;
pub mod txline;
pub mod wormhole;

use instructions::*;

// Fresh, unfunded vanity keypair (target/deploy/proofline_adapter-keypair.json).
// Not deployed anywhere — see the deployment-status note above.
declare_id!("PRF5wS3RSArKNCC2pYtDvBciM9KxtDw6tqAUzimKqbN");

#[program]
pub mod proofline_adapter {
    use super::*;

    /// One-time global configuration (pins TxOracle + Wormhole program ids,
    /// forwarder authority, destination chain). Immutable thereafter — no
    /// update path exists.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        txline_program_id: Pubkey,
        wormhole_core: Pubkey,
        forwarder_authority: Pubkey,
        destination_chain: u16,
    ) -> Result<()> {
        instructions::proof_buffer::initialize_config(
            ctx,
            txline_program_id,
            wormhole_core,
            forwarder_authority,
            destination_chain,
        )
    }

    /// Legacy generic staging API retained for compatibility. The typed
    /// TxLINE verification path deliberately does not consume this buffer.
    pub fn initialize_proof_buffer(
        ctx: Context<InitializeProofBuffer>,
        buffer_seed: u64,
        capacity: u32,
    ) -> Result<()> {
        instructions::proof_buffer::initialize_proof_buffer(ctx, buffer_seed, capacity)
    }

    /// Append bytes to an unsealed legacy buffer (uploader only).
    pub fn append_proof_chunk(ctx: Context<AppendProofChunk>, chunk: Vec<u8>) -> Result<()> {
        instructions::proof_buffer::append_proof_chunk(ctx, chunk)
    }

    /// Record the expected content hash and freeze the buffer forever.
    pub fn seal_proof(ctx: Context<SealProof>, expected_hash: [u8; 32]) -> Result<()> {
        instructions::proof_buffer::seal_proof(ctx, expected_hash)
    }

    /// Verify an official full TxLINE input through TxOracle and mint the
    /// immutable `VerifiedOutcome` PDA. Permissionless.
    pub fn verify_outcome(ctx: Context<VerifyOutcome>, args: VerifyOutcomeArgs) -> Result<()> {
        instructions::verify_outcome::verify_outcome(ctx, args)
    }

    /// Transaction B: emit the `MatchOutcomeV1` Wormhole message for a
    /// verified, not-yet-published outcome. Permissionless.
    #[cfg(feature = "wormhole")]
    pub fn publish_outcome(ctx: Context<PublishOutcome>) -> Result<()> {
        instructions::publish_outcome::publish_outcome(ctx)
    }

    /// Single-transaction fast path (verify + publish) for proofs whose
    /// compute footprint fits one budget.
    #[cfg(feature = "wormhole")]
    pub fn verify_and_publish_inline(
        ctx: Context<VerifyAndPublishInline>,
        args: VerifyOutcomeArgs,
    ) -> Result<()> {
        instructions::publish_outcome::verify_and_publish_inline(ctx, args)
    }

    /// Chainlink Keystone Forwarder entrypoint — same verification core,
    /// gated on the configured forwarder authority (liveness role only).
    pub fn on_report(ctx: Context<OnReport>, metadata: Vec<u8>, payload: Vec<u8>) -> Result<()> {
        instructions::on_report::on_report(ctx, metadata, payload)
    }

    /// Rent recovery for a spent staging buffer (uploader only).
    pub fn close_proof_buffer(ctx: Context<CloseProofBuffer>) -> Result<()> {
        instructions::proof_buffer::close_proof_buffer(ctx)
    }
}

#[error_code]
pub enum ProoflineError {
    #[msg("proof buffer capacity must be 1..=10000 bytes")]
    CapacityOutOfRange,
    #[msg("signer is not this buffer's uploader")]
    UploaderMismatch,
    #[msg("proof buffer is sealed and immutable")]
    BufferSealed,
    #[msg("proof buffer must be sealed before verification")]
    BufferNotSealed,
    #[msg("chunk is empty")]
    EmptyChunk,
    #[msg("chunk would exceed buffer capacity")]
    BufferCapacityExceeded,
    #[msg("proof is empty")]
    EmptyProof,
    #[msg("sealed hash does not match buffer contents")]
    SealHashMismatch,
    #[msg("provide either an inline proof or a proof buffer, not both")]
    AmbiguousProofSource,
    #[msg("no proof source provided")]
    MissingProofSource,
    #[msg("only final scores are attested (period must be 100)")]
    NotFinalPeriod,
    #[msg("input.ts must equal fixture_summary.update_stats.min_timestamp")]
    PayloadTimestampMismatch,
    #[msg("TxLINE input is missing stat key 1")]
    MissingParticipant1Stat,
    #[msg("TxLINE input is missing stat key 2")]
    MissingParticipant2Stat,
    #[msg("TxLINE input contains a duplicate score stat key")]
    DuplicateScoreStat,
    #[msg("TxLINE score stat periods do not match")]
    ScorePeriodMismatch,
    #[msg("score stat index does not fit the TxLINE strategy index type")]
    ScoreStatIndexOverflow,
    #[msg("strategy does not exactly bind a derived score stat")]
    MissingExactScorePredicate,
    #[msg("txline program account does not match configured program id")]
    WrongTxlineProgram,
    #[msg("daily-root account does not match the input min_timestamp PDA")]
    WrongDailyRoot,
    #[msg("no return data from TxOracle CPI")]
    MissingReturnData,
    #[msg("return data was not set by the configured TxLINE program")]
    ReturnDataProgramMismatch,
    #[msg("TxOracle return data is not a valid boolean")]
    MalformedReturnData,
    #[msg("TxOracle rejected the proof / predicate")]
    TxlineValidationFailed,
    #[msg("instruction serialization failed")]
    SerializationFailed,
    #[msg("outcome already published — re-publish is forbidden")]
    AlreadyPublished,
    #[msg("wormhole program account does not match configured core bridge")]
    WrongWormholeProgram,
    #[msg("wormhole bridge config account is malformed")]
    MalformedBridgeConfig,
    #[msg("wormhole sequence account is malformed")]
    MalformedSequenceAccount,
    #[msg("report payload is not a valid VerifyOutcomeArgs")]
    BadReportPayload,
    #[msg("signer is not the configured Keystone forwarder authority")]
    ForwarderMismatch,
}
