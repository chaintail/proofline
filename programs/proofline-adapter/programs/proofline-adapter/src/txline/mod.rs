pub mod instruction;
pub mod return_data;

use anchor_lang::prelude::*;

/// The only TxLINE deployment this adapter will invoke or trust.
pub const MAINNET_PROGRAM_ID: Pubkey = txline_cpi::MAINNET_PROGRAM_ID;

/// TxLINE final-settlement period/status marker.
pub const FINAL_PERIOD: i32 = 100;

/// `validate_stat_v2` source-validation version stored in outcomes.
pub const SOURCE_VALIDATION_V2: u8 = 2;
