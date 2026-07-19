#[cfg(feature = "wormhole")]
pub mod emitter;
pub mod payload;

/// Seed of this program's optional Wormhole emitter PDA.
pub const EMITTER_SEED: &[u8] = b"emitter";
