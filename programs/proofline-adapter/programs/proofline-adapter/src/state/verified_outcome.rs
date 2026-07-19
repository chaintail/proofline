use anchor_lang::prelude::*;

/// The on-chain record that TxLINE's canonical verifier returned `true` for
/// one exact final score. Created by `verify_outcome` /
/// `on_report` / `verify_and_publish_inline` — and by NOTHING else.
///
/// IDENTITY: this PDA is keyed by `(fixture_id, proof_timestamp_ms)`, where
/// both fields come from the verified `StatValidationInput` (`fixture_id` and
/// `update_stats.min_timestamp`). Provider score sequence is deliberately
/// excluded because it is not present in the bytes the deployed TxLINE
/// program verifies. The on-chain identity represents exactly what TxLINE
/// verified, nothing else.
///
/// IMMUTABILITY: once written, every outcome field is frozen. The only
/// later mutation permitted anywhere in this program is the one-shot
/// publication stamp (`published`, `wormhole_*` fields) applied by
/// `publish_outcome`, which requires `published == false` and therefore can
/// happen at most once. There is no close/realloc/update path for this
/// account.
#[account]
#[derive(InitSpace)]
pub struct VerifiedOutcome {
    /// TxLINE fixture id.
    pub fixture_id: i64,
    /// Verified `fixture_summary.update_stats.min_timestamp` in milliseconds.
    pub proof_timestamp_ms: i64,
    /// Period marker; 100 = final (mirrors TxLINE `statusId == 100` /
    /// `game_finalised` semantics — see instructions::verify_outcome docs).
    pub period: i32,
    pub participant_1_score: i32,
    pub participant_2_score: i32,
    /// 1 = HOME, 2 = DRAW, 3 = AWAY. Derived on-chain from the verified
    /// scores, never taken from the caller. 0 is reserved/invalid so an
    /// all-zero account can never decode as a valid outcome.
    pub result: u8,
    /// Which TxOracle instruction generation verified this (2 =
    /// validate_stat_v2).
    pub source_validation_version: u8,
    /// Wormhole destination copied from the immutable config at verification.
    pub destination_chain: u16,
    /// Always the adapter's compile-time TxLINE mainnet constant.
    pub txline_program_id: Pubkey,
    /// The TxLINE daily-root account the proof was verified against.
    pub daily_root_account: Pubkey,
    /// keccak256(txline_program_id ‖ daily_root_account ‖ raw
    /// validate_stat_v2 instruction data) — identifies precisely what this
    /// adapter validated (§3.10 item 8).
    pub validation_instruction_hash: [u8; 32],
    /// `keccak256(BorshSerialize(StatValidationInput))`, using the exact field
    /// order and encodings defined by the pinned `txline_cpi` crate. The hash
    /// preimage excludes the Anchor instruction discriminator, strategy,
    /// account metas, and off-chain JSON/envelope data.
    pub proof_bundle_hash: [u8; 32],
    /// Slot in which the TxOracle CPI returned true.
    pub verified_slot: u64,
    /// One-shot publication latch — set by `publish_outcome`, re-publish
    /// reverts.
    pub published: bool,
    /// Wormhole emitter PDA that signed the message (set on publish).
    pub wormhole_emitter: Pubkey,
    /// Wormhole sequence assigned to the emitted message (set on publish).
    pub wormhole_sequence: u64,
    /// The Wormhole message account (set on publish).
    pub wormhole_message: Pubkey,
    pub bump: u8,
}

impl VerifiedOutcome {
    pub const SEED: &'static [u8] = b"verified_outcome";
}
