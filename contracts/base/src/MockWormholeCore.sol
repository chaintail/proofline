// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockWormholeCore — dev-guardian-set Wormhole Core stand-in
///
/// HONEST DISCLOSURE: this is a mock of the Wormhole Core Bridge running a
/// 19-address DEV guardian set (13-of-19 quorum), because the Solana leg of
/// this build is simulated — there is no live Guardian network observing our
/// simulated Solana emitter, so mainnet/testnet guardians can never sign our
/// VAAs. Everything else is real: the VAA v1 wire format, the
/// keccak256(keccak256(body)) double-hash digest, raw ecrecover (no EIP-191
/// prefix), strictly-ascending guardian indices, per-index address matching,
/// and the 13-of-19 quorum rule are byte-for-byte identical to Wormhole's
/// on-chain verification math. Swapping this contract for the canonical
/// Wormhole Core on Base is a constructor-argument change in the receiver.
///
/// VAA v1 wire format parsed here:
///   header: version u8 (=1) | guardianSetIndex u32 BE | numSignatures u8
///           then per signature: guardianIndex u8 | r bytes32 | s bytes32 | v u8 (recovery id; +27 for ecrecover)
///   body (everything after the signatures — this is what guardians sign):
///           timestamp u32 | nonce u32 | emitterChainId u16 | emitterAddress bytes32
///           | sequence u64 | consistencyLevel u8 | payload (rest)
///   digest = keccak256(keccak256(body))
contract MockWormholeCore {
    struct Signature {
        bytes32 r;
        bytes32 s;
        uint8 v; // already +27, ecrecover-ready
        uint8 guardianIndex;
    }

    /// @dev Mirrors Wormhole's IWormhole.VM struct (signatures kept, hash = digest).
    struct VM {
        uint8 version;
        uint32 timestamp;
        uint32 nonce;
        uint16 emitterChainId;
        bytes32 emitterAddress;
        uint64 sequence;
        uint8 consistencyLevel;
        bytes payload;
        uint32 guardianSetIndex;
        Signature[] signatures;
        bytes32 hash;
    }

    error BadVaa(string reason);

    address[19] public guardianSet;
    uint8 public immutable quorum; // 13
    uint16 public immutable chainId; // 10004 = Base Sepolia in Wormhole numbering

    constructor(address[19] memory guardians, uint8 quorum_, uint16 chainId_) {
        for (uint256 i = 0; i < 19; i++) {
            require(guardians[i] != address(0), "zero guardian");
            guardianSet[i] = guardians[i];
        }
        quorum = quorum_;
        chainId = chainId_;
    }

    function getGuardianSet() external view returns (address[19] memory) {
        return guardianSet;
    }

    /// @notice Parse a VAA and verify guardian signatures against the dev
    ///         guardian set. Structural parse failures revert; signature /
    ///         quorum failures return (vm_, false, reason) like Wormhole.
    function parseAndVerifyVM(bytes calldata encodedVM)
        external
        view
        returns (VM memory vm_, bool valid, string memory reason)
    {
        vm_ = _parseVM(encodedVM);

        if (vm_.signatures.length < quorum) {
            return (vm_, false, "no quorum");
        }

        int256 lastIndex = -1;
        for (uint256 i = 0; i < vm_.signatures.length; i++) {
            Signature memory sig = vm_.signatures[i];
            // Strictly ascending guardian indices: no duplicate signers.
            if (int256(uint256(sig.guardianIndex)) <= lastIndex) {
                return (vm_, false, "signature indices out of order");
            }
            lastIndex = int256(uint256(sig.guardianIndex));

            if (sig.guardianIndex >= 19) {
                return (vm_, false, "guardian index out of bounds");
            }

            address signer = ecrecover(vm_.hash, sig.v, sig.r, sig.s);
            if (signer == address(0) || signer != guardianSet[sig.guardianIndex]) {
                return (vm_, false, "VM signature invalid");
            }
        }

        return (vm_, true, "");
    }

    function _parseVM(bytes calldata encodedVM) internal pure returns (VM memory vm_) {
        uint256 offset = 0;

        if (encodedVM.length < 6) revert BadVaa("vaa too short");
        vm_.version = uint8(encodedVM[offset]);
        offset += 1;
        if (vm_.version != 1) revert BadVaa("unsupported vaa version");

        vm_.guardianSetIndex = uint32(bytes4(encodedVM[offset:offset + 4]));
        offset += 4;

        uint256 numSignatures = uint8(encodedVM[offset]);
        offset += 1;

        if (encodedVM.length < offset + numSignatures * 66) revert BadVaa("truncated signatures");
        vm_.signatures = new Signature[](numSignatures);
        for (uint256 i = 0; i < numSignatures; i++) {
            vm_.signatures[i].guardianIndex = uint8(encodedVM[offset]);
            vm_.signatures[i].r = bytes32(encodedVM[offset + 1:offset + 33]);
            vm_.signatures[i].s = bytes32(encodedVM[offset + 33:offset + 65]);
            vm_.signatures[i].v = uint8(encodedVM[offset + 65]) + 27; // wire carries recovery id
            offset += 66;
        }

        // Body = everything after the signatures; guardians sign keccak256(keccak256(body)).
        if (encodedVM.length < offset + 51) revert BadVaa("truncated body");
        bytes memory body = encodedVM[offset:];
        vm_.hash = keccak256(abi.encodePacked(keccak256(body)));

        vm_.timestamp = uint32(bytes4(encodedVM[offset:offset + 4]));
        vm_.nonce = uint32(bytes4(encodedVM[offset + 4:offset + 8]));
        vm_.emitterChainId = uint16(bytes2(encodedVM[offset + 8:offset + 10]));
        vm_.emitterAddress = bytes32(encodedVM[offset + 10:offset + 42]);
        vm_.sequence = uint64(bytes8(encodedVM[offset + 42:offset + 50]));
        vm_.consistencyLevel = uint8(encodedVM[offset + 50]);
        vm_.payload = encodedVM[offset + 51:];
    }
}
