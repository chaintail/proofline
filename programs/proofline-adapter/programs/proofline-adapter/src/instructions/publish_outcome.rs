//! Transaction B of the two-transaction design: serialize `MatchOutcomeV1`
//! from an existing `VerifiedOutcome` and emit it through the Wormhole core
//! bridge — plus the optional single-transaction fast path
//! (`verify_and_publish_inline`) for proofs whose compute footprint fits.
//!
//! The two-transaction default is an explicit architectural decision, not a
//! compromise: TxOracle verification and Wormhole publication do not share
//! one compute budget, and the demo gets two distinct, inspectable Solana
//! slots ("TxLINE proof verified" / "Wormhole message emitted").
//!
//! THE ONLY ROAD TO A WORMHOLE MESSAGE runs through a `VerifiedOutcome` PDA
//! minted by a successful TxOracle CPI. There is no admin publish path, no
//! raw-payload instruction, no bypass (§3.10 item 3).

use anchor_lang::prelude::*;

use crate::instructions::verify_outcome::{
    fixture_seed, proof_timestamp_seed, record_verified_outcome, run_txline_verification,
    VerifyOutcomeArgs,
};
use crate::state::{Config, VerifiedOutcome};
use crate::txline::MAINNET_PROGRAM_ID;
use crate::wormhole::emitter::{post_message, PostMessageAccounts};
use crate::wormhole::payload::MatchOutcomeV1;
use crate::wormhole::EMITTER_SEED;
use crate::ProoflineError;

/// Wormhole nonce — deduplication happens by emitter sequence, so a
/// constant nonce is fine.
const WORMHOLE_NONCE: u32 = 0;

/// Legacy `MatchOutcomeV1` reserves an i64 provider-sequence slot. TxLINE's
/// verified input does not contain that provenance, so the opt-in Wormhole
/// leg emits the canonical unavailable sentinel instead of caller data.
const PROVIDER_SEQUENCE_UNAVAILABLE: i64 = 0;

/// Build the 176-byte cross-chain payload using only immutable outcome data.
pub fn build_payload(outcome: &VerifiedOutcome) -> [u8; 176] {
    MatchOutcomeV1 {
        flags: 0,
        destination_chain: outcome.destination_chain,
        source_validation_version: outcome.source_validation_version,
        result: outcome.result,
        fixture_id: outcome.fixture_id,
        score_sequence: PROVIDER_SEQUENCE_UNAVAILABLE,
        proof_timestamp_ms: outcome.proof_timestamp_ms,
        period: outcome.period,
        participant_1_score: outcome.participant_1_score,
        participant_2_score: outcome.participant_2_score,
        txline_program_id: outcome.txline_program_id.to_bytes(),
        daily_root_account: outcome.daily_root_account.to_bytes(),
        validation_instruction_hash: outcome.validation_instruction_hash,
        proof_bundle_hash: outcome.proof_bundle_hash,
    }
    .encode()
}

#[derive(Accounts)]
pub struct PublishOutcome<'info> {
    /// Any relayer — publication is permissionless; the payer only funds
    /// the bridge fee and message rent.
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [Config::SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [
            VerifiedOutcome::SEED,
            &verified_outcome.fixture_id.to_be_bytes(),
            &verified_outcome.proof_timestamp_ms.to_be_bytes(),
        ],
        bump = verified_outcome.bump,
        constraint = !verified_outcome.published @ ProoflineError::AlreadyPublished
    )]
    pub verified_outcome: Account<'info, VerifiedOutcome>,
    /// CHECK: this program's sole Wormhole emitter PDA; signs the
    /// post_message CPI via seeds.
    #[account(seeds = [EMITTER_SEED], bump = config.emitter_bump)]
    pub emitter: UncheckedAccount<'info>,
    /// CHECK: pinned to the configured Wormhole core bridge.
    #[account(
        executable,
        address = config.wormhole_core @ ProoflineError::WrongWormholeProgram
    )]
    pub wormhole_program: UncheckedAccount<'info>,
    /// CHECK: core bridge config PDA, derivation enforced against the
    /// configured bridge program.
    #[account(mut, seeds = [b"Bridge"], bump, seeds::program = config.wormhole_core)]
    pub wormhole_bridge: UncheckedAccount<'info>,
    /// CHECK: bridge fee collector PDA.
    #[account(mut, seeds = [b"fee_collector"], bump, seeds::program = config.wormhole_core)]
    pub wormhole_fee_collector: UncheckedAccount<'info>,
    /// CHECK: per-emitter sequence tracker PDA (created by the bridge on
    /// first message).
    #[account(
        mut,
        seeds = [b"Sequence", emitter.key().as_ref()],
        bump,
        seeds::program = config.wormhole_core
    )]
    pub wormhole_sequence: UncheckedAccount<'info>,
    /// Fresh message account keypair; the bridge initializes and owns it.
    #[account(mut)]
    pub wormhole_message: Signer<'info>,
    pub clock: Sysvar<'info, Clock>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}

pub fn publish_outcome(ctx: Context<PublishOutcome>) -> Result<()> {
    let payload = build_payload(&ctx.accounts.verified_outcome);
    let sequence = post_message(
        &PostMessageAccounts {
            wormhole_program: &ctx.accounts.wormhole_program.to_account_info(),
            bridge: &ctx.accounts.wormhole_bridge.to_account_info(),
            message: &ctx.accounts.wormhole_message.to_account_info(),
            emitter: &ctx.accounts.emitter.to_account_info(),
            sequence: &ctx.accounts.wormhole_sequence.to_account_info(),
            payer: &ctx.accounts.payer.to_account_info(),
            fee_collector: &ctx.accounts.wormhole_fee_collector.to_account_info(),
            clock: &ctx.accounts.clock.to_account_info(),
            rent: &ctx.accounts.rent.to_account_info(),
            system_program: &ctx.accounts.system_program.to_account_info(),
        },
        &payload,
        WORMHOLE_NONCE,
        ctx.accounts.config.emitter_bump,
    )?;

    let outcome = &mut ctx.accounts.verified_outcome;
    outcome.published = true;
    outcome.wormhole_emitter = ctx.accounts.emitter.key();
    outcome.wormhole_sequence = sequence;
    outcome.wormhole_message = ctx.accounts.wormhole_message.key();
    Ok(())
}

/// Single-transaction fast path: verify + publish in one instruction, for
/// proofs whose compute footprint comfortably fits one budget. Runs the
/// IDENTICAL verification core and the IDENTICAL publish path — it is a
/// packaging optimization, not a second trust path.
#[derive(Accounts)]
#[instruction(args: VerifyOutcomeArgs)]
pub struct VerifyAndPublishInline<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [Config::SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// CHECK: executable and pinned to the official mainnet TxLINE program.
    #[account(
        executable,
        address = MAINNET_PROGRAM_ID @ ProoflineError::WrongTxlineProgram
    )]
    pub txline_program: UncheckedAccount<'info>,
    /// CHECK: TxLINE daily-root commitment account (see `VerifyOutcome`).
    pub daily_root: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + VerifiedOutcome::INIT_SPACE,
        seeds = [
            VerifiedOutcome::SEED,
            &fixture_seed(&args),
            &proof_timestamp_seed(&args),
        ],
        bump
    )]
    pub verified_outcome: Account<'info, VerifiedOutcome>,
    /// CHECK: emitter PDA (see `PublishOutcome`).
    #[account(seeds = [EMITTER_SEED], bump = config.emitter_bump)]
    pub emitter: UncheckedAccount<'info>,
    /// CHECK: pinned to the configured Wormhole core bridge.
    #[account(
        executable,
        address = config.wormhole_core @ ProoflineError::WrongWormholeProgram
    )]
    pub wormhole_program: UncheckedAccount<'info>,
    /// CHECK: core bridge config PDA.
    #[account(mut, seeds = [b"Bridge"], bump, seeds::program = config.wormhole_core)]
    pub wormhole_bridge: UncheckedAccount<'info>,
    /// CHECK: bridge fee collector PDA.
    #[account(mut, seeds = [b"fee_collector"], bump, seeds::program = config.wormhole_core)]
    pub wormhole_fee_collector: UncheckedAccount<'info>,
    /// CHECK: per-emitter sequence tracker PDA.
    #[account(
        mut,
        seeds = [b"Sequence", emitter.key().as_ref()],
        bump,
        seeds::program = config.wormhole_core
    )]
    pub wormhole_sequence: UncheckedAccount<'info>,
    /// Fresh message account keypair; the bridge initializes and owns it.
    #[account(mut)]
    pub wormhole_message: Signer<'info>,
    pub clock: Sysvar<'info, Clock>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}

pub fn verify_and_publish_inline(
    ctx: Context<VerifyAndPublishInline>,
    args: VerifyOutcomeArgs,
) -> Result<()> {
    // Verify (identical core to verify_outcome).
    let derived = run_txline_verification(
        &ctx.accounts.config,
        &ctx.accounts.txline_program.to_account_info(),
        &ctx.accounts.daily_root.to_account_info(),
        &args,
    )?;
    record_verified_outcome(
        &mut ctx.accounts.verified_outcome,
        &ctx.accounts.config,
        &derived,
        ctx.bumps.verified_outcome,
    )?;

    // Publish (identical path to publish_outcome).
    let payload = build_payload(&ctx.accounts.verified_outcome);
    let sequence = post_message(
        &PostMessageAccounts {
            wormhole_program: &ctx.accounts.wormhole_program.to_account_info(),
            bridge: &ctx.accounts.wormhole_bridge.to_account_info(),
            message: &ctx.accounts.wormhole_message.to_account_info(),
            emitter: &ctx.accounts.emitter.to_account_info(),
            sequence: &ctx.accounts.wormhole_sequence.to_account_info(),
            payer: &ctx.accounts.payer.to_account_info(),
            fee_collector: &ctx.accounts.wormhole_fee_collector.to_account_info(),
            clock: &ctx.accounts.clock.to_account_info(),
            rent: &ctx.accounts.rent.to_account_info(),
            system_program: &ctx.accounts.system_program.to_account_info(),
        },
        &payload,
        WORMHOLE_NONCE,
        ctx.accounts.config.emitter_bump,
    )?;

    let outcome = &mut ctx.accounts.verified_outcome;
    outcome.published = true;
    outcome.wormhole_emitter = ctx.accounts.emitter.key();
    outcome.wormhole_sequence = sequence;
    outcome.wormhole_message = ctx.accounts.wormhole_message.key();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wormhole::payload::MatchOutcomeV1;

    #[test]
    fn payload_uses_only_stored_outcome_and_zeroes_provider_sequence() {
        let outcome = VerifiedOutcome {
            fixture_id: 18_175_918,
            proof_timestamp_ms: 1_783_126_172_907,
            period: 100,
            participant_1_score: 3,
            participant_2_score: 2,
            result: 1,
            source_validation_version: 2,
            destination_chain: 30,
            txline_program_id: MAINNET_PROGRAM_ID,
            daily_root_account: Pubkey::new_unique(),
            validation_instruction_hash: [3u8; 32],
            proof_bundle_hash: [4u8; 32],
            verified_slot: 42,
            published: false,
            wormhole_emitter: Pubkey::default(),
            wormhole_sequence: 0,
            wormhole_message: Pubkey::default(),
            bump: 255,
        };
        let decoded = MatchOutcomeV1::decode(&build_payload(&outcome)).unwrap();
        assert_eq!(decoded.score_sequence, PROVIDER_SEQUENCE_UNAVAILABLE);
        assert_eq!(decoded.fixture_id, outcome.fixture_id);
        assert_eq!(decoded.proof_timestamp_ms, outcome.proof_timestamp_ms);
        assert_eq!(decoded.proof_bundle_hash, outcome.proof_bundle_hash);
        assert_eq!(
            decoded.validation_instruction_hash,
            outcome.validation_instruction_hash
        );
    }
}
