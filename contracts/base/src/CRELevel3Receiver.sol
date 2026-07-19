// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "./Ownable.sol";
import {FinalityRegistry} from "./FinalityRegistry.sol";

/// @title CRELevel3Receiver — Proofline Level 3 fast-lane receiver (spec §3.5)
/// @notice ReceiverTemplate-style gate for CRE-signed Level 3 attestations.
///
/// HONEST DISCLOSURE: a real Chainlink CRE DON + Keystone Forwarder does not
/// exist in this build, so `onReport` is gated on a configured `forwarder`
/// address exactly the way ReceiverTemplate validates the Keystone Forwarder.
/// In the demo the relay CLI plays the forwarder role. Swapping in the real
/// forwarder address is a one-call owner change; report semantics are
/// unchanged.
contract CRELevel3Receiver is Ownable {
    struct Level3Attestation {
        bytes32 attestationId;
        int64 fixtureId;
        int32 participant1Score;
        int32 participant2Score;
        bytes32 proofBundleHash;
        uint8 result; // 1 = HOME, 2 = DRAW, 3 = AWAY
        uint64 receivedAt;
    }

    /// @dev ABI shape of the CRE report payload (abi.encode of these fields, in order).
    struct Level3Report {
        bytes32 attestationId;
        int64 fixtureId;
        int32 participant1Score;
        int32 participant2Score;
        bytes32 proofBundleHash;
        uint8 result;
    }

    FinalityRegistry public immutable registry;
    /// @notice Only this address may deliver reports (demo: the relay CLI EOA).
    address public forwarder;

    mapping(bytes32 => bool) public consumedAttestations;
    mapping(int64 => Level3Attestation) private _attestations;

    event ForwarderSet(address indexed forwarder);
    event Level3AttestationReceived(int64 indexed fixtureId, bytes32 indexed attestationId, uint8 result);

    error NotForwarder();
    error AlreadyConsumed(bytes32 attestationId);

    constructor(address initialOwner, FinalityRegistry registry_, address forwarder_) Ownable(initialOwner) {
        registry = registry_;
        forwarder = forwarder_;
        emit ForwarderSet(forwarder_);
    }

    function setForwarder(address forwarder_) external onlyOwner {
        if (forwarder_ == address(0)) revert ZeroAddress();
        forwarder = forwarder_;
        emit ForwarderSet(forwarder_);
    }

    /// @notice CRE/forwarder entrypoint. `metadata` is accepted for interface
    ///         parity with ReceiverTemplate and intentionally unused here.
    function onReport(bytes calldata, /* metadata */ bytes calldata report) external {
        if (msg.sender != forwarder) revert NotForwarder();

        Level3Report memory r = abi.decode(report, (Level3Report));

        if (consumedAttestations[r.attestationId]) revert AlreadyConsumed(r.attestationId);
        consumedAttestations[r.attestationId] = true;

        _attestations[r.fixtureId] = Level3Attestation({
            attestationId: r.attestationId,
            fixtureId: r.fixtureId,
            participant1Score: r.participant1Score,
            participant2Score: r.participant2Score,
            proofBundleHash: r.proofBundleHash,
            result: r.result,
            receivedAt: uint64(block.timestamp)
        });

        emit Level3AttestationReceived(r.fixtureId, r.attestationId, r.result);

        registry.reportLevel3(r.fixtureId, r.attestationId, r.participant1Score, r.participant2Score, r.result);
    }

    function attestation(int64 fixtureId) external view returns (Level3Attestation memory) {
        return _attestations[fixtureId];
    }
}
