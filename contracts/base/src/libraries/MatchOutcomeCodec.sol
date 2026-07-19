// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MatchOutcomeCodec
/// @notice Decoder for the fixed-width 176-byte big-endian `MatchOutcomeV1`
///         cross-chain payload (the Proofline canonical wire format, see
///         packages/protocol + packages/test-vectors/match-outcome-v1.json).
///
/// Layout (offset / size / field), all integers big-endian:
///   0   / 4  / magic "PRFL" (0x5052464c)
///   4   / 1  / version (= 1)
///   5   / 1  / messageType (= 1, MATCH_OUTCOME)
///   6   / 2  / flags
///   8   / 2  / destinationChain (Wormhole chain id)
///   10  / 1  / sourceValidationVersion
///   11  / 1  / result (1 = HOME, 2 = DRAW, 3 = AWAY)
///   12  / 8  / fixtureId (int64)
///   20  / 8  / scoreSequence (int64)
///   28  / 8  / proofTimestampMs (int64)
///   36  / 4  / period (int32)
///   40  / 4  / participant1Score (int32)
///   44  / 4  / participant2Score (int32)
///   48  / 32 / txlineProgramId
///   80  / 32 / dailyRootAccount
///   112 / 32 / validationInstructionHash
///   144 / 32 / proofBundleHash
library MatchOutcomeCodec {
    uint256 internal constant PAYLOAD_LENGTH = 176;
    bytes4 internal constant MAGIC = 0x5052464c; // "PRFL"
    uint8 internal constant VERSION = 1;
    uint8 internal constant MESSAGE_TYPE_MATCH_OUTCOME = 1;

    uint8 internal constant RESULT_HOME = 1;
    uint8 internal constant RESULT_DRAW = 2;
    uint8 internal constant RESULT_AWAY = 3;

    error BadPayloadLength(uint256 actual);
    error BadMagic(bytes4 actual);
    error UnsupportedVersion(uint8 actual);
    error UnsupportedMessageType(uint8 actual);
    error InvalidResult(uint8 actual);

    struct MatchOutcome {
        uint8 version;
        uint8 messageType;
        uint16 flags;
        uint16 destinationChain;
        uint8 sourceValidationVersion;
        uint8 result;
        int64 fixtureId;
        int64 scoreSequence;
        int64 proofTimestampMs;
        int32 period;
        int32 participant1Score;
        int32 participant2Score;
        bytes32 txlineProgramId;
        bytes32 dailyRootAccount;
        bytes32 validationInstructionHash;
        bytes32 proofBundleHash;
    }

    /// @notice Decode and validate a MatchOutcomeV1 payload.
    /// @dev Reverts on bad length, magic, version, messageType, or result.
    function decode(bytes memory payload) internal pure returns (MatchOutcome memory o) {
        if (payload.length != PAYLOAD_LENGTH) revert BadPayloadLength(payload.length);

        bytes4 magic = bytes4(_word(payload, 0));
        if (magic != MAGIC) revert BadMagic(magic);

        o.version = _u8(payload, 4);
        if (o.version != VERSION) revert UnsupportedVersion(o.version);

        o.messageType = _u8(payload, 5);
        if (o.messageType != MESSAGE_TYPE_MATCH_OUTCOME) revert UnsupportedMessageType(o.messageType);

        o.flags = _u16(payload, 6);
        o.destinationChain = _u16(payload, 8);
        o.sourceValidationVersion = _u8(payload, 10);

        o.result = _u8(payload, 11);
        if (o.result == 0 || o.result > RESULT_AWAY) revert InvalidResult(o.result);

        o.fixtureId = int64(_u64(payload, 12));
        o.scoreSequence = int64(_u64(payload, 20));
        o.proofTimestampMs = int64(_u64(payload, 28));

        o.period = int32(_u32(payload, 36));
        o.participant1Score = int32(_u32(payload, 40));
        o.participant2Score = int32(_u32(payload, 44));

        o.txlineProgramId = _word(payload, 48);
        o.dailyRootAccount = _word(payload, 80);
        o.validationInstructionHash = _word(payload, 112);
        o.proofBundleHash = _word(payload, 144);
    }

    // --- big-endian readers (bounds are guaranteed by the length check) ---

    function _word(bytes memory buf, uint256 offset) private pure returns (bytes32 w) {
        assembly {
            w := mload(add(add(buf, 32), offset))
        }
    }

    function _u8(bytes memory buf, uint256 offset) private pure returns (uint8) {
        return uint8(buf[offset]);
    }

    function _u16(bytes memory buf, uint256 offset) private pure returns (uint16) {
        return uint16(bytes2(_word(buf, offset)));
    }

    function _u32(bytes memory buf, uint256 offset) private pure returns (uint32) {
        return uint32(bytes4(_word(buf, offset)));
    }

    function _u64(bytes memory buf, uint256 offset) private pure returns (uint64) {
        return uint64(bytes8(_word(buf, offset)));
    }
}
