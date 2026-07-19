//! Permissionless TxLINE verification and immutable outcome recording.
//!
//! The caller supplies only TxLINE's official `StatValidationInput` and
//! `NDimensionalStrategy`. Every fact stored in `VerifiedOutcome` is derived
//! from those bytes after the deployed mainnet TxLINE program returns the
//! exact one-byte value `0x01`.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use solana_keccak_hasher as keccak;
use txline_cpi::{Comparison, NDimensionalStrategy, StatPredicate, StatValidationInput};

use crate::state::{Config, VerifiedOutcome};
use crate::txline::instruction::validation_instruction_hash;
use crate::txline::return_data::require_txline_true;
use crate::txline::{FINAL_PERIOD, MAINNET_PROGRAM_ID, SOURCE_VALIDATION_V2};
use crate::wormhole::payload::derive_result;
use crate::ProoflineError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct VerifyOutcomeArgs {
    pub input: StatValidationInput,
    pub strategy: NDimensionalStrategy,
}

/// Facts deterministically extracted from the official TxLINE arguments.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DerivedOutcome {
    pub fixture_id: i64,
    pub proof_timestamp_ms: i64,
    pub period: i32,
    pub participant_1_score: i32,
    pub participant_2_score: i32,
    pub proof_bundle_hash: [u8; 32],
    pub daily_root_account: Pubkey,
    pub validation_instruction_hash: [u8; 32],
}

/// Big-endian fixture seed used by the immutable outcome PDA.
pub fn fixture_seed(args: &VerifyOutcomeArgs) -> [u8; 8] {
    args.input.fixture_summary.fixture_id.to_be_bytes()
}

/// Big-endian verified proof timestamp used by the immutable outcome PDA.
pub fn proof_timestamp_seed(args: &VerifyOutcomeArgs) -> [u8; 8] {
    args.input
        .fixture_summary
        .update_stats
        .min_timestamp
        .to_be_bytes()
}

fn has_exact_equality_predicate(
    strategy: &NDimensionalStrategy,
    stat_index: u8,
    stat_value: i32,
) -> bool {
    strategy.discrete_predicates.iter().any(|predicate| {
        matches!(
            predicate,
            StatPredicate::Single { index, predicate }
                if *index == stat_index
                    && predicate.threshold == stat_value
                    && predicate.comparison == Comparison::EqualTo
        )
    })
}

/// Derive all outcome facts that are representable in TxLINE's verified
/// bytes. Provider score sequence is intentionally absent: it does not exist
/// in `StatValidationInput` and is off-chain provenance only.
pub fn derive_outcome(args: &VerifyOutcomeArgs) -> Result<DerivedOutcome> {
    let input = &args.input;
    let proof_timestamp_ms = input.fixture_summary.update_stats.min_timestamp;
    require_eq!(
        input.ts,
        proof_timestamp_ms,
        ProoflineError::PayloadTimestampMismatch
    );

    let mut participant_1 = None;
    let mut participant_2 = None;
    for (index, leaf) in input.stats.iter().enumerate() {
        let target = match leaf.stat.key {
            1 => &mut participant_1,
            2 => &mut participant_2,
            _ => continue,
        };
        require!(target.is_none(), ProoflineError::DuplicateScoreStat);
        *target = Some((index, &leaf.stat));
    }

    let (participant_1_index, participant_1_stat) =
        participant_1.ok_or_else(|| error!(ProoflineError::MissingParticipant1Stat))?;
    let (participant_2_index, participant_2_stat) =
        participant_2.ok_or_else(|| error!(ProoflineError::MissingParticipant2Stat))?;
    require_eq!(
        participant_1_stat.period,
        participant_2_stat.period,
        ProoflineError::ScorePeriodMismatch
    );
    require_eq!(
        participant_1_stat.period,
        FINAL_PERIOD,
        ProoflineError::NotFinalPeriod
    );
    require!(
        participant_1_index <= u8::MAX as usize && participant_2_index <= u8::MAX as usize,
        ProoflineError::ScoreStatIndexOverflow
    );
    require!(
        has_exact_equality_predicate(
            &args.strategy,
            participant_1_index as u8,
            participant_1_stat.value,
        ),
        ProoflineError::MissingExactScorePredicate
    );
    require!(
        has_exact_equality_predicate(
            &args.strategy,
            participant_2_index as u8,
            participant_2_stat.value,
        ),
        ProoflineError::MissingExactScorePredicate
    );

    let input_bytes = input
        .try_to_vec()
        .map_err(|_| error!(ProoflineError::SerializationFailed))?;
    let proof_bundle_hash = keccak::hash(&input_bytes).to_bytes();

    Ok(DerivedOutcome {
        fixture_id: input.fixture_summary.fixture_id,
        proof_timestamp_ms,
        period: participant_1_stat.period,
        participant_1_score: participant_1_stat.value,
        participant_2_score: participant_2_stat.value,
        proof_bundle_hash,
        daily_root_account: Pubkey::default(),
        validation_instruction_hash: [0u8; 32],
    })
}

#[derive(Accounts)]
#[instruction(args: VerifyOutcomeArgs)]
pub struct VerifyOutcome<'info> {
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
    /// CHECK: checked against `daily_scores_pda(min_timestamp)` before CPI.
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
    pub system_program: Program<'info, System>,
}

pub fn verify_outcome(ctx: Context<VerifyOutcome>, args: VerifyOutcomeArgs) -> Result<()> {
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

/// Invoke the official mainnet ABI, require its exact return value, and
/// fingerprint the exact instruction data that was executed.
pub fn run_txline_verification<'info>(
    config: &Config,
    txline_program: &AccountInfo<'info>,
    daily_root: &AccountInfo<'info>,
    args: &VerifyOutcomeArgs,
) -> Result<DerivedOutcome> {
    require_keys_eq!(
        config.txline_program_id,
        MAINNET_PROGRAM_ID,
        ProoflineError::WrongTxlineProgram
    );
    require_keys_eq!(
        *txline_program.key,
        MAINNET_PROGRAM_ID,
        ProoflineError::WrongTxlineProgram
    );
    require!(
        txline_program.executable,
        ProoflineError::WrongTxlineProgram
    );

    let mut derived = derive_outcome(args)?;
    let expected_daily_root = txline_cpi::daily_scores_pda(derived.proof_timestamp_ms)?.0;
    require_keys_eq!(
        *daily_root.key,
        expected_daily_root,
        ProoflineError::WrongDailyRoot
    );

    let ix =
        txline_cpi::validate_stat_v2_instruction(*daily_root.key, &args.input, &args.strategy)?;
    invoke(&ix, &[daily_root.clone(), txline_program.clone()])?;
    require_txline_true(&MAINNET_PROGRAM_ID)?;

    derived.daily_root_account = *daily_root.key;
    derived.validation_instruction_hash =
        validation_instruction_hash(&MAINNET_PROGRAM_ID, daily_root.key, &ix.data);
    Ok(derived)
}

/// Freeze verified facts into the PDA. From here on, only the optional
/// Wormhole publication stamp may mutate.
pub fn record_verified_outcome(
    outcome: &mut VerifiedOutcome,
    config: &Config,
    derived: &DerivedOutcome,
    bump: u8,
) -> Result<()> {
    outcome.fixture_id = derived.fixture_id;
    outcome.proof_timestamp_ms = derived.proof_timestamp_ms;
    outcome.period = derived.period;
    outcome.participant_1_score = derived.participant_1_score;
    outcome.participant_2_score = derived.participant_2_score;
    outcome.result = derive_result(derived.participant_1_score, derived.participant_2_score);
    outcome.source_validation_version = SOURCE_VALIDATION_V2;
    outcome.destination_chain = config.destination_chain;
    outcome.txline_program_id = MAINNET_PROGRAM_ID;
    outcome.daily_root_account = derived.daily_root_account;
    outcome.validation_instruction_hash = derived.validation_instruction_hash;
    outcome.proof_bundle_hash = derived.proof_bundle_hash;
    outcome.verified_slot = Clock::get()?.slot;
    outcome.published = false;
    outcome.wormhole_emitter = Pubkey::default();
    outcome.wormhole_sequence = 0;
    outcome.wormhole_message = Pubkey::default();
    outcome.bump = bump;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use txline_cpi::{ScoreStat, ScoresBatchSummary, ScoresUpdateStats, StatLeaf, TraderPredicate};

    fn sample_args() -> VerifyOutcomeArgs {
        VerifyOutcomeArgs {
            input: StatValidationInput {
                ts: 1_783_126_172_907,
                fixture_summary: ScoresBatchSummary {
                    fixture_id: 18_175_918,
                    update_stats: ScoresUpdateStats {
                        update_count: 2,
                        min_timestamp: 1_783_126_172_907,
                        max_timestamp: 1_783_126_189_288,
                    },
                    events_sub_tree_root: [3u8; 32],
                },
                fixture_proof: vec![],
                main_tree_proof: vec![],
                event_stat_root: [4u8; 32],
                stats: vec![
                    StatLeaf {
                        stat: ScoreStat {
                            key: 1,
                            value: 3,
                            period: FINAL_PERIOD,
                        },
                        stat_proof: vec![],
                    },
                    StatLeaf {
                        stat: ScoreStat {
                            key: 2,
                            value: 2,
                            period: FINAL_PERIOD,
                        },
                        stat_proof: vec![],
                    },
                ],
            },
            strategy: NDimensionalStrategy {
                geometric_targets: vec![],
                distance_predicate: None,
                discrete_predicates: vec![
                    StatPredicate::Single {
                        index: 0,
                        predicate: TraderPredicate {
                            threshold: 3,
                            comparison: Comparison::EqualTo,
                        },
                    },
                    StatPredicate::Single {
                        index: 1,
                        predicate: TraderPredicate {
                            threshold: 2,
                            comparison: Comparison::EqualTo,
                        },
                    },
                ],
            },
        }
    }

    #[test]
    fn derives_only_verified_fields_and_pda_identity() {
        let args = sample_args();
        let derived = derive_outcome(&args).unwrap();
        assert_eq!(derived.fixture_id, 18_175_918);
        assert_eq!(derived.proof_timestamp_ms, 1_783_126_172_907);
        assert_eq!(derived.participant_1_score, 3);
        assert_eq!(derived.participant_2_score, 2);
        assert_eq!(derived.period, FINAL_PERIOD);
        assert_eq!(fixture_seed(&args), 18_175_918i64.to_be_bytes());
        assert_eq!(
            proof_timestamp_seed(&args),
            1_783_126_172_907i64.to_be_bytes()
        );
    }

    #[test]
    fn tampered_stat_changes_derived_bundle_hash_not_pda_identity() {
        let args = sample_args();
        let mut tampered = args.clone();
        tampered.input.stats[0].stat.value = 4;
        if let StatPredicate::Single { predicate, .. } =
            &mut tampered.strategy.discrete_predicates[0]
        {
            predicate.threshold = 4;
        }
        assert_ne!(
            derive_outcome(&args).unwrap().proof_bundle_hash,
            derive_outcome(&tampered).unwrap().proof_bundle_hash
        );
        assert_eq!(fixture_seed(&args), fixture_seed(&tampered));
        assert_eq!(proof_timestamp_seed(&args), proof_timestamp_seed(&tampered));
    }

    #[test]
    fn rejects_missing_duplicate_nonfinal_and_unbound_scores() {
        let mut missing = sample_args();
        missing.input.stats.remove(1);
        assert!(derive_outcome(&missing).is_err());

        let mut duplicate = sample_args();
        duplicate.input.stats.push(duplicate.input.stats[0].clone());
        assert!(derive_outcome(&duplicate).is_err());

        let mut nonfinal = sample_args();
        nonfinal.input.stats[0].stat.period = 99;
        assert!(derive_outcome(&nonfinal).is_err());

        let mut unbound = sample_args();
        unbound.strategy.discrete_predicates.clear();
        assert!(derive_outcome(&unbound).is_err());
    }

    #[test]
    fn rejects_timestamp_mismatch() {
        let mut args = sample_args();
        args.input.ts += 1;
        assert!(derive_outcome(&args).is_err());
    }
}
