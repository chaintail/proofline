//! Hard ABI gate against the exact instruction that returned true on the
//! deployed mainnet TxLINE program.

use proofline_adapter::instructions::verify_outcome::{
    fixture_seed, proof_timestamp_seed, VerifyOutcomeArgs,
};
use serde_json::Value;
use txline_cpi::{
    Comparison, NDimensionalStrategy, ProofNode, ScoreStat, ScoresBatchSummary, ScoresUpdateStats,
    StatLeaf, StatPredicate, StatValidationInput, TraderPredicate, VALIDATE_STAT_V2_DISCRIMINATOR,
};

const EVIDENCE_ROOT: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../../evidence/mainnet/rehearsal-18175918"
);

fn read_json(name: &str) -> Value {
    let path = std::path::Path::new(EVIDENCE_ROOT).join(name);
    let bytes = std::fs::read(path).expect("golden evidence must be readable");
    serde_json::from_slice(&bytes).expect("golden evidence must be valid JSON")
}

fn field<'a>(value: &'a Value, name: &str) -> &'a Value {
    value
        .get(name)
        .unwrap_or_else(|| panic!("missing JSON field {name}"))
}

fn i64_value(value: &Value) -> i64 {
    value.as_i64().expect("expected signed integer")
}

fn i32_value(value: &Value) -> i32 {
    i32::try_from(i64_value(value)).expect("integer must fit i32")
}

fn u32_value(value: &Value) -> u32 {
    u32::try_from(value.as_u64().expect("expected unsigned integer")).expect("integer must fit u32")
}

fn u8_value(value: &Value) -> u8 {
    u8::try_from(value.as_u64().expect("expected unsigned integer")).expect("integer must fit u8")
}

fn bytes32(value: &Value) -> [u8; 32] {
    let values = value.as_array().expect("expected byte array");
    assert_eq!(values.len(), 32, "expected exactly 32 bytes");
    let mut out = [0u8; 32];
    for (target, source) in out.iter_mut().zip(values) {
        *target = u8_value(source);
    }
    out
}

fn proof_nodes(value: &Value) -> Vec<ProofNode> {
    value
        .as_array()
        .expect("expected proof-node array")
        .iter()
        .map(|node| ProofNode {
            hash: bytes32(field(node, "hash")),
            is_right_sibling: field(node, "isRightSibling")
                .as_bool()
                .expect("isRightSibling must be boolean"),
        })
        .collect()
}

fn build_input(raw: &Value) -> StatValidationInput {
    let summary = field(raw, "summary");
    let update_stats = field(summary, "updateStats");
    let stats = field(raw, "statsToProve")
        .as_array()
        .expect("statsToProve must be an array");
    let stat_proofs = field(raw, "statProofs")
        .as_array()
        .expect("statProofs must be an array");
    assert_eq!(stats.len(), stat_proofs.len(), "one proof per stat leaf");

    let min_timestamp = i64_value(field(update_stats, "minTimestamp"));
    StatValidationInput {
        // This is intentionally not raw.ts: deployed TxLINE requires the
        // daily-root timestamp to equal summary.updateStats.minTimestamp.
        ts: min_timestamp,
        fixture_summary: ScoresBatchSummary {
            fixture_id: i64_value(field(summary, "fixtureId")),
            update_stats: ScoresUpdateStats {
                update_count: i32_value(field(update_stats, "updateCount")),
                min_timestamp,
                max_timestamp: i64_value(field(update_stats, "maxTimestamp")),
            },
            events_sub_tree_root: bytes32(field(summary, "eventStatsSubTreeRoot")),
        },
        fixture_proof: proof_nodes(field(raw, "subTreeProof")),
        main_tree_proof: proof_nodes(field(raw, "mainTreeProof")),
        event_stat_root: bytes32(field(raw, "eventStatRoot")),
        stats: stats
            .iter()
            .zip(stat_proofs)
            .map(|(stat, proof)| StatLeaf {
                stat: ScoreStat {
                    key: u32_value(field(stat, "key")),
                    value: i32_value(field(stat, "value")),
                    period: i32_value(field(stat, "period")),
                },
                stat_proof: proof_nodes(proof),
            })
            .collect(),
    }
}

fn comparison(value: &Value) -> Comparison {
    if value.get("equalTo").is_some() {
        Comparison::EqualTo
    } else if value.get("greaterThan").is_some() {
        Comparison::GreaterThan
    } else if value.get("lessThan").is_some() {
        Comparison::LessThan
    } else {
        panic!("unsupported comparison in golden strategy")
    }
}

fn build_strategy(raw: &Value) -> NDimensionalStrategy {
    let predicates = field(raw, "discretePredicates")
        .as_array()
        .expect("discretePredicates must be an array")
        .iter()
        .map(|entry| {
            let single = field(entry, "single");
            let predicate = field(single, "predicate");
            StatPredicate::Single {
                index: u8_value(field(single, "index")),
                predicate: TraderPredicate {
                    threshold: i32_value(field(predicate, "threshold")),
                    comparison: comparison(field(predicate, "comparison")),
                },
            }
        })
        .collect();
    assert_eq!(
        field(raw, "geometricTargets")
            .as_array()
            .expect("geometricTargets must be an array")
            .len(),
        0,
        "golden strategy must not add geometric targets"
    );
    assert!(field(raw, "distancePredicate").is_null());
    NDimensionalStrategy {
        geometric_targets: vec![],
        distance_predicate: None,
        discrete_predicates: predicates,
    }
}

fn golden_args() -> VerifyOutcomeArgs {
    VerifyOutcomeArgs {
        input: build_input(&read_json("raw-proof-response.json")),
        strategy: build_strategy(&read_json("strategy.canonical.json")),
    }
}

#[test]
fn official_builder_matches_mainnet_golden_vector_byte_for_byte() {
    let args = golden_args();
    let actual = txline_cpi::validate_stat_v2_data(&args.input, &args.strategy).unwrap();
    let expected = std::fs::read(std::path::Path::new(EVIDENCE_ROOT).join("instruction-data.bin"))
        .expect("golden instruction bytes must be readable");

    assert_eq!(expected.len(), 726, "golden vector length changed");
    assert_eq!(&actual[..8], &VALIDATE_STAT_V2_DISCRIMINATOR);
    assert_eq!(
        actual, expected,
        "pinned Rust ABI differs from mainnet bytes"
    );
    assert_eq!(fixture_seed(&args), 18_175_918i64.to_be_bytes());
    assert_eq!(
        proof_timestamp_seed(&args),
        1_783_126_172_907i64.to_be_bytes()
    );
}

#[test]
fn tampered_stat_value_changes_official_instruction_bytes() {
    let args = golden_args();
    let original = txline_cpi::validate_stat_v2_data(&args.input, &args.strategy).unwrap();
    let mut tampered = args.clone();
    tampered.input.stats[0].stat.value += 1;
    let changed = txline_cpi::validate_stat_v2_data(&tampered.input, &tampered.strategy).unwrap();
    assert_ne!(changed, original);
}
