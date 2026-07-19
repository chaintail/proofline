// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AttestationIds
/// @notice Canonical derivation of the Proofline `attestationId` — the digest
///         both the Level 3 (CRE fast lane) and Level 4 (Wormhole proof lane)
///         must independently reproduce for `DualFinalized` reconciliation.
/// @dev abi.encodePacked encodes int64 as 8 bytes big-endian two's complement,
///      matching the TS implementation in packages/protocol and the vector in
///      packages/test-vectors/match-outcome-v1.json.
library AttestationIds {
    bytes32 internal constant DOMAIN_SEPARATOR = keccak256("proofline.attestation.v1");

    function compute(
        bytes32 sourceEmitter,
        int64 fixtureId,
        int64 scoreSequence,
        bytes32 validationInstructionHash,
        bytes32 proofBundleHash
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                DOMAIN_SEPARATOR,
                sourceEmitter,
                fixtureId,
                scoreSequence,
                validationInstructionHash,
                proofBundleHash
            )
        );
    }
}
