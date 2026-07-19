import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const adapterRoot = resolve(dirname(process.argv[1]), "..");
const repoRoot = resolve(adapterRoot, "../..");
const requireFromAttestor = createRequire(resolve(repoRoot, "apps/mainnet-attestor/package.json"));
const anchor = requireFromAttestor("@coral-xyz/anchor");
const {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} = requireFromAttestor("@solana/web3.js");
const BN = requireFromAttestor("bn.js");

const ADAPTER_ID = new PublicKey("PRF5wS3RSArKNCC2pYtDvBciM9KxtDw6tqAUzimKqbN");
const TXLINE_ID = new PublicKey("9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA");
const DAILY_ROOT = new PublicKey("CdrFdcGqLpGxq3qDxcj4aNQT8jsUU2vBHd3JEEAQ55jd");
const FIXTURE_ID = new BN("18175918");
const PROOF_TIMESTAMP = new BN("1783126172907");
const DESTINATION_CHAIN = 30;

const evidenceRoot = resolve(repoRoot, "evidence/mainnet/rehearsal-18175918");
const idl = JSON.parse(
  readFileSync(resolve(adapterRoot, "target/idl/proofline_adapter.json"), "utf8"),
);
const proof = JSON.parse(readFileSync(resolve(evidenceRoot, "raw-proof-response.json"), "utf8"));
const strategyJson = JSON.parse(
  readFileSync(resolve(evidenceRoot, "strategy.canonical.json"), "utf8"),
);
const goldenInstruction = readFileSync(resolve(evidenceRoot, "instruction-data.bin"));

function bytes32(value: unknown): number[] {
  assert(Array.isArray(value), "expected byte array");
  assert.equal(value.length, 32, "expected 32 bytes");
  return value.map((byte) => {
    assert(Number.isInteger(byte) && byte >= 0 && byte <= 255, "invalid byte");
    return byte;
  });
}

function proofNodes(value: unknown): Array<{ hash: number[]; isRightSibling: boolean }> {
  assert(Array.isArray(value), "proof nodes must be an array");
  return value.map((node: any) => ({
    hash: bytes32(node.hash),
    isRightSibling: Boolean(node.isRightSibling),
  }));
}

function buildArgs() {
  const minTimestamp = proof.summary.updateStats.minTimestamp;
  assert.equal(minTimestamp, Number(PROOF_TIMESTAMP.toString()));
  assert.equal(proof.summary.fixtureId, Number(FIXTURE_ID.toString()));
  assert.equal(proof.statsToProve.length, proof.statProofs.length);

  const input = {
    ts: new BN(minTimestamp),
    fixtureSummary: {
      fixtureId: new BN(proof.summary.fixtureId),
      updateStats: {
        updateCount: proof.summary.updateStats.updateCount,
        minTimestamp: new BN(minTimestamp),
        maxTimestamp: new BN(proof.summary.updateStats.maxTimestamp),
      },
      eventsSubTreeRoot: bytes32(proof.summary.eventStatsSubTreeRoot),
    },
    fixtureProof: proofNodes(proof.subTreeProof),
    mainTreeProof: proofNodes(proof.mainTreeProof),
    eventStatRoot: bytes32(proof.eventStatRoot),
    stats: proof.statsToProve.map((stat: any, index: number) => ({
      stat: { key: stat.key, value: stat.value, period: stat.period },
      statProof: proofNodes(proof.statProofs[index]),
    })),
  };
  const strategy = {
    geometricTargets: strategyJson.geometricTargets,
    distancePredicate: strategyJson.distancePredicate,
    discretePredicates: strategyJson.discretePredicates,
  };
  return { input, strategy };
}

function i64be(value: any): Buffer {
  return value.toArrayLike(Buffer, "be", 8);
}

function hex(value: Uint8Array | number[]): string {
  return Buffer.from(value).toString("hex");
}

function encodeCanonicalStrategy(strategy: any): Buffer {
  assert.deepEqual(strategy.geometricTargets, []);
  assert.equal(strategy.distancePredicate, null);
  const parts: Buffer[] = [];
  const emptyGeometricTargets = Buffer.alloc(4);
  parts.push(emptyGeometricTargets, Buffer.from([0]));
  const predicateCount = Buffer.alloc(4);
  predicateCount.writeUInt32LE(strategy.discretePredicates.length);
  parts.push(predicateCount);
  for (const entry of strategy.discretePredicates) {
    const single = entry.single;
    assert(single, "D1 canonical strategy supports single predicates only");
    const threshold = Buffer.alloc(4);
    threshold.writeInt32LE(single.predicate.threshold);
    const comparison = single.predicate.comparison.equalTo
      ? 2
      : single.predicate.comparison.greaterThan
        ? 0
        : single.predicate.comparison.lessThan
          ? 1
          : -1;
    assert.notEqual(comparison, -1, "unsupported comparison");
    parts.push(Buffer.from([0, single.index]), threshold, Buffer.from([comparison]));
  }
  return Buffer.concat(parts);
}

async function main() {
  const rpcUrl = process.env.D1_RPC_URL;
  const payerPath = process.env.D1_PAYER_KEYPAIR;
  assert(rpcUrl, "D1_RPC_URL is required");
  assert(payerPath, "D1_PAYER_KEYPAIR is required");

  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(payerPath, "utf8"))),
  );
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const program = new anchor.Program(idl, provider);
  assert(program.programId.equals(ADAPTER_ID));

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], ADAPTER_ID);
  const [outcomePda, outcomeBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("verified_outcome"), i64be(FIXTURE_ID), i64be(PROOF_TIMESTAMP)],
    ADAPTER_ID,
  );

  const initializeSignature = await program.methods
    .initializeConfig(TXLINE_ID, SystemProgram.programId, payer.publicKey, DESTINATION_CHAIN)
    .accountsStrict({
      admin: payer.publicKey,
      config: configPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`D1 initialize_config signature=${initializeSignature}`);

  const args = buildArgs();
  const strategyBytes = encodeCanonicalStrategy(args.strategy);
  const inputBytes = goldenInstruction.subarray(8, goldenInstruction.length - strategyBytes.length);
  assert.deepEqual(goldenInstruction.subarray(goldenInstruction.length - strategyBytes.length), strategyBytes);
  assert.deepEqual(
    goldenInstruction.subarray(0, 8),
    Buffer.from([208, 215, 194, 214, 241, 71, 246, 178]),
  );

  const nobleModule = pathToFileURL(
    resolve(
      repoRoot,
      "node_modules/.pnpm/@noble+hashes@1.8.0/node_modules/@noble/hashes/sha3.js",
    ),
  ).href;
  const { keccak_256 } = (await import(nobleModule)) as {
    keccak_256: (bytes: Uint8Array) => Uint8Array;
  };
  const expectedBundleHash = keccak_256(inputBytes);
  const expectedInstructionHash = keccak_256(
    Buffer.concat([TXLINE_ID.toBuffer(), DAILY_ROOT.toBuffer(), goldenInstruction]),
  );

  const verifyIdl: any = (idl.instructions as any[]).find(
    (instruction) => instruction.name === "verify_outcome",
  );
  assert(verifyIdl, "generated IDL is missing verify_outcome");
  const verifyIx = new TransactionInstruction({
    programId: ADAPTER_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: TXLINE_ID, isSigner: false, isWritable: false },
      { pubkey: DAILY_ROOT, isSigner: false, isWritable: false },
      { pubkey: outcomePda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    // VerifyOutcomeArgs is exactly StatValidationInput || NDimensionalStrategy.
    // The Rust golden test reconstructs goldenInstruction[8..] from both JSON
    // files; only the outer program discriminator differs here.
    data: Buffer.concat([
      Buffer.from(verifyIdl.discriminator),
      goldenInstruction.subarray(8),
    ]),
  });
  const transaction = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    verifyIx,
  );
  const verifySignature = await sendAndConfirmTransaction(connection, transaction, [payer], {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  console.log(`D1 verify_outcome signature=${verifySignature} cu_limit=1400000`);

  const transactionReadback = await connection.getTransaction(verifySignature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  assert(transactionReadback?.meta?.err == null, "verify_outcome transaction failed");
  const logs = transactionReadback?.meta?.logMessages ?? [];
  assert(
    logs.some((line) => line.includes(`Program ${TXLINE_ID.toBase58()} invoke`)),
    "transaction did not CPI into cloned TxLINE",
  );
  assert(
    logs.some((line) => line.includes(`Program return: ${TXLINE_ID.toBase58()} AQ==`)),
    "TxLINE did not return exact one-byte true",
  );
  console.log(
    `D1 TxLINE CPI=observed return=AQ== compute_units=${transactionReadback?.meta?.computeUnitsConsumed}`,
  );

  const config: any = await program.account.config.fetch(configPda);
  const outcome: any = await program.account.verifiedOutcome.fetch(outcomePda);
  assert(config.txlineProgramId.equals(TXLINE_ID));
  assert.equal(config.destinationChain, DESTINATION_CHAIN);
  assert(outcome.fixtureId.eq(FIXTURE_ID));
  assert(outcome.proofTimestampMs.eq(PROOF_TIMESTAMP));
  assert.equal(outcome.period, 100);
  assert.equal(outcome.participant1Score, 3);
  assert.equal(outcome.participant2Score, 2);
  assert.equal(outcome.result, 1);
  assert.equal(outcome.sourceValidationVersion, 2);
  assert.equal(outcome.destinationChain, DESTINATION_CHAIN);
  assert(outcome.txlineProgramId.equals(TXLINE_ID));
  assert(outcome.dailyRootAccount.equals(DAILY_ROOT));
  assert.equal(hex(outcome.proofBundleHash), hex(expectedBundleHash));
  assert.equal(hex(outcome.validationInstructionHash), hex(expectedInstructionHash));
  assert.equal(outcome.published, false);
  assert.equal(outcome.bump, outcomeBump);
  assert(outcome.verifiedSlot.gtn(0));
  assert(!("scoreSequence" in outcome), "provider sequence must not exist on-chain");

  console.log(
    `D1 config_pda=${configPda.toBase58()} txline=${config.txlineProgramId.toBase58()} destination_chain=${config.destinationChain}`,
  );
  console.log(
    `D1 verified_outcome_pda=${outcomePda.toBase58()} fixture=${outcome.fixtureId.toString()} proof_timestamp=${outcome.proofTimestampMs.toString()} score=${outcome.participant1Score}-${outcome.participant2Score} period=${outcome.period} result=${outcome.result}`,
  );
  console.log(
    `D1 daily_root=${outcome.dailyRootAccount.toBase58()} bundle_hash=${hex(outcome.proofBundleHash)} instruction_hash=${hex(outcome.validationInstructionHash)} verified_slot=${outcome.verifiedSlot.toString()} published=${outcome.published}`,
  );
  console.log("D1 publish_outcome=not_compiled (default mainnet build; wormhole feature off)");
  console.log("D1 RESULT=GREEN");
}

void main();
