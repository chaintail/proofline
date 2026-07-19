//! Adapter-specific commitment for an official TxLINE instruction.
//!
//! Construction and serialization of `validate_stat_v2` live exclusively in
//! the pinned `txline_cpi` crate. This module deliberately contains no ABI.

use anchor_lang::prelude::*;
use solana_keccak_hasher as keccak;

/// keccak256(txline_program_id ‖ daily_root ‖ raw instruction data) — the
/// `validation_instruction_hash` fingerprint carried in `MatchOutcomeV1`
/// (§3.10 item 8: hash the EXACT TxLINE validation instruction). Level 3
/// computes the identical hash off-chain over the identical bytes, which is
/// what lets both lanes derive the same attestation id on Base.
pub fn validation_instruction_hash(
    txline_program_id: &Pubkey,
    daily_root: &Pubkey,
    ix_data: &[u8],
) -> [u8; 32] {
    keccak::hashv(&[txline_program_id.as_ref(), daily_root.as_ref(), ix_data]).to_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instruction_hash_changes_with_any_component() {
        let p1 = Pubkey::new_unique();
        let p2 = Pubkey::new_unique();
        let root = Pubkey::new_unique();
        let h = validation_instruction_hash(&p1, &root, b"data");
        assert_ne!(h, validation_instruction_hash(&p2, &root, b"data"));
        assert_ne!(h, validation_instruction_hash(&p1, &p2, b"data"));
        assert_ne!(h, validation_instruction_hash(&p1, &root, b"datb"));
    }
}
