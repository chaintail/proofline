use anchor_lang::prelude::*;
use solana_keccak_hasher as keccak;

/// Legacy generic staging account retained for API compatibility.
///
/// `verify_outcome` intentionally does not consume this account: the real
/// TxLINE ABI requires its complete typed input and strategy as instruction
/// arguments. A sealed buffer therefore confers no verification authority.
#[account]
pub struct ProofBuffer {
    /// Only key allowed to append, seal and close (rent recovery). Untrusted
    /// for correctness purposes — see above.
    pub uploader: Pubkey,
    /// Uploader-chosen namespace value so one uploader can stage several
    /// proofs concurrently.
    pub buffer_seed: u64,
    /// Maximum payload bytes this buffer was allocated for.
    pub capacity: u32,
    /// Once true the buffer is immutable (no appends, no re-seal).
    pub sealed: bool,
    /// keccak256 the uploader claims for the final contents.
    pub expected_hash: [u8; 32],
    pub bump: u8,
    /// The staged proof bytes.
    pub data: Vec<u8>,
}

impl ProofBuffer {
    pub const SEED: &'static [u8] = b"proof_buffer";
    /// discriminator + uploader + buffer_seed + capacity + sealed
    /// + expected_hash + bump + Vec length prefix.
    pub const BASE_SPACE: usize = 8 + 32 + 8 + 4 + 1 + 32 + 1 + 4;
    /// Keep total account size safely under the 10 KiB CPI-allocation limit.
    pub const MAX_CAPACITY: u32 = 10_000;

    pub fn space(capacity: u32) -> usize {
        Self::BASE_SPACE + capacity as usize
    }
}

/// Pure seal check retained for the staging lifecycle's conformance tests.
pub fn seal_matches(data: &[u8], expected_hash: &[u8; 32]) -> bool {
    keccak::hash(data).to_bytes() == *expected_hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seal_hash_accepts_matching_bytes() {
        let data = b"txline proof bundle bytes".to_vec();
        let expected = keccak::hash(&data).to_bytes();
        assert!(seal_matches(&data, &expected));
    }

    #[test]
    fn seal_hash_rejects_mutated_bytes() {
        let data = b"txline proof bundle bytes".to_vec();
        let expected = keccak::hash(&data).to_bytes();
        let mut tampered = data.clone();
        tampered[0] ^= 0x01;
        assert!(!seal_matches(&tampered, &expected));
    }

    #[test]
    fn seal_hash_rejects_truncation_and_extension() {
        let data = b"txline proof bundle bytes".to_vec();
        let expected = keccak::hash(&data).to_bytes();
        assert!(!seal_matches(&data[..data.len() - 1], &expected));
        let mut extended = data.clone();
        extended.push(0);
        assert!(!seal_matches(&extended, &expected));
    }

    #[test]
    fn seal_hash_rejects_wrong_expected_hash() {
        let data = b"txline proof bundle bytes".to_vec();
        let mut wrong = keccak::hash(&data).to_bytes();
        wrong[31] ^= 0xff;
        assert!(!seal_matches(&data, &wrong));
    }
}
