//! Chainlink Keystone Forwarder entrypoint.
//!
//! `on_report(metadata, payload)` is the CRE-driven way to reach the SAME
//! verification core as `verify_outcome` — nothing more. The forwarder
//! authority gate is a LIVENESS credential, not a correctness one: a
//! compromised forwarder still cannot mint an outcome TxOracle refuses to
//! verify, and an unavailable forwarder is bypassed by anyone calling
//! `verify_outcome` directly (permissionless-by-design, §3.4).

use anchor_lang::prelude::*;

use crate::instructions::verify_outcome::{
    fixture_seed, proof_timestamp_seed, record_verified_outcome, run_txline_verification,
    VerifyOutcomeArgs,
};
use crate::state::{Config, VerifiedOutcome};
use crate::txline::MAINNET_PROGRAM_ID;
use crate::ProoflineError;

/// Extract the big-endian fixture-id seed from a borsh `VerifyOutcomeArgs`
/// report payload. Falls back to zeroes on a malformed payload; the handler
/// then rejects the payload itself with a proper error before anything is
/// written.
pub fn report_fixture_seed(payload: &[u8]) -> [u8; 8] {
    VerifyOutcomeArgs::try_from_slice(payload)
        .map(|a| fixture_seed(&a))
        .unwrap_or([0u8; 8])
}

/// Companion to `report_fixture_seed` for the verified proof timestamp.
pub fn report_timestamp_seed(payload: &[u8]) -> [u8; 8] {
    VerifyOutcomeArgs::try_from_slice(payload)
        .map(|a| proof_timestamp_seed(&a))
        .unwrap_or([0u8; 8])
}

#[derive(Accounts)]
#[instruction(metadata: Vec<u8>, payload: Vec<u8>)]
pub struct OnReport<'info> {
    /// The configured Keystone Forwarder authority. This is the ONLY
    /// difference from `VerifyOutcome` — same verification core behind it.
    #[account(address = config.forwarder_authority @ ProoflineError::ForwarderMismatch)]
    pub forwarder_authority: Signer<'info>,
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
            &report_fixture_seed(&payload),
            &report_timestamp_seed(&payload),
        ],
        bump
    )]
    pub verified_outcome: Account<'info, VerifiedOutcome>,
    pub system_program: Program<'info, System>,
}

pub fn on_report(ctx: Context<OnReport>, metadata: Vec<u8>, payload: Vec<u8>) -> Result<()> {
    // Keystone report metadata (workflow/report ids) is logged for the
    // evidence trail but carries no authority here.
    msg!("keystone report metadata: {} bytes", metadata.len());

    let args = VerifyOutcomeArgs::try_from_slice(&payload)
        .map_err(|_| error!(ProoflineError::BadReportPayload))?;

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
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use txline_cpi::{
        NDimensionalStrategy, ScoresBatchSummary, ScoresUpdateStats, StatValidationInput,
    };

    #[test]
    fn report_seeds_are_fixture_and_verified_timestamp() {
        let args = VerifyOutcomeArgs {
            input: StatValidationInput {
                ts: 1_783_126_172_907,
                fixture_summary: ScoresBatchSummary {
                    fixture_id: 18_175_918,
                    update_stats: ScoresUpdateStats {
                        update_count: 2,
                        min_timestamp: 1_783_126_172_907,
                        max_timestamp: 1_783_126_189_288,
                    },
                    events_sub_tree_root: [0u8; 32],
                },
                fixture_proof: vec![],
                main_tree_proof: vec![],
                event_stat_root: [0u8; 32],
                stats: vec![],
            },
            strategy: NDimensionalStrategy {
                geometric_targets: vec![],
                distance_predicate: None,
                discrete_predicates: vec![],
            },
        };
        let payload = args.try_to_vec().unwrap();
        assert_eq!(report_fixture_seed(&payload), 18_175_918i64.to_be_bytes());
        assert_eq!(
            report_timestamp_seed(&payload),
            1_783_126_172_907i64.to_be_bytes()
        );
        assert_eq!(report_fixture_seed(b"bad"), [0u8; 8]);
        assert_eq!(report_timestamp_seed(b"bad"), [0u8; 8]);
    }
}
