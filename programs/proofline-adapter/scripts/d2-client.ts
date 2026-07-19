import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
const BPF_UPGRADEABLE_LOADER_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const FIXTURE_ID = new BN("18175918");
const PROOF_TIMESTAMP = new BN("1783126172907");
const DESTINATION_CHAIN = 30;
const PRIORITY_FEE_MICROLAMPORTS = 10_000;
const TXLINE_DISCRIMINATOR = Buffer.from([208, 215, 194, 214, 241, 71, 246, 178]);

const evidenceRoot = resolve(repoRoot, "evidence/mainnet/rehearsal-18175918");
const evidenceOutputRoot = resolve(repoRoot, "evidence/mainnet/full-deploy");
const evidenceOutput = resolve(evidenceOutputRoot, "d2-mainnet.json");
const idl = JSON.parse(
  readFileSync(resolve(adapterRoot, "target/idl/proofline_adapter.json"), "utf8"),
);
const proof = JSON.parse(readFileSync(resolve(evidenceRoot, "raw-proof-response.json"), "utf8"));
const strategyJson = JSON.parse(
  readFileSync(resolve(evidenceRoot, "strategy.canonical.json"), "utf8"),
);
const goldenInstruction = readFileSync(resolve(evidenceRoot, "instruction-data.bin"));
const deployedSo = readFileSync(resolve(adapterRoot, "target/deploy/proofline_adapter.so"));

function requiredEnv(name: string): string {
  const value = process.env[name];
  assert(value, `${name} is required`);
  return value;
}

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
  const parts: Buffer[] = [Buffer.alloc(4), Buffer.from([0])];
  const predicateCount = Buffer.alloc(4);
  predicateCount.writeUInt32LE(strategy.discretePredicates.length);
  parts.push(predicateCount);
  for (const entry of strategy.discretePredicates) {
    const single = entry.single;
    assert(single, "D2 canonical strategy supports single predicates only");
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

async function finalizedTransaction(connection: any, signature: string, label: string) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const transaction = await connection.getTransaction(signature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
    if (transaction) {
      assert.equal(transaction.meta?.err, null, `${label} transaction failed`);
      return transaction;
    }
    if (attempt % 5 === 0) {
      console.log(`D2 waiting_for_finalized label=${label} attempt=${attempt}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
  }
  assert.fail(`${label} transaction was not visible at finalized commitment`);
}

function decodeProgramDataAddress(data: Buffer): any {
  assert.equal(data.length, 36, "unexpected upgradeable program account length");
  assert.equal(data.readUInt32LE(0), 2, "account is not UpgradeableLoaderState::Program");
  return new PublicKey(data.subarray(4, 36));
}

function decodeUpgradeAuthority(data: Buffer): any {
  assert(data.length >= 45, "unexpected ProgramData account length");
  assert.equal(data.readUInt32LE(0), 3, "account is not UpgradeableLoaderState::ProgramData");
  assert.equal(data[12], 1, "ProgramData has no upgrade authority");
  return new PublicKey(data.subarray(13, 45));
}

async function main() {
  const primaryRpc = requiredEnv("D2_PRIMARY_RPC");
  const secondaryRpc = requiredEnv("D2_SECONDARY_RPC");
  const payerPath = requiredEnv("PROOFLINE_SIGNER_KEYPAIR");
  const deploySignature = requiredEnv("D2_DEPLOY_SIGNATURE");
  const preDeployBalanceLamports = Number(requiredEnv("D2_PREDEPLOY_BALANCE_LAMPORTS"));
  const quotedProgramDataRentLamports = Number(requiredEnv("D2_PROGRAMDATA_RENT_LAMPORTS"));
  assert.equal(deployedSo.length, 339_128, "deployed .so changed after D2 preflight");

  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(payerPath, "utf8"))),
  );
  const primary = new Connection(primaryRpc, "finalized");
  const primaryWallet = new anchor.Wallet(payer);
  const primaryProvider = new anchor.AnchorProvider(primary, primaryWallet, {
    commitment: "finalized",
    preflightCommitment: "confirmed",
  });
  const primaryProgram = new anchor.Program(idl, primaryProvider);
  assert(primaryProgram.programId.equals(ADAPTER_ID));

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], ADAPTER_ID);
  const [outcomePda, outcomeBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("verified_outcome"), i64be(FIXTURE_ID), i64be(PROOF_TIMESTAMP)],
    ADAPTER_ID,
  );

  const existingConfig = await primary.getAccountInfo(configPda, "finalized");
  assert.equal(existingConfig, null, "config PDA already exists; refusing to reinitialize");

  const initializeSignature = await primaryProgram.methods
    .initializeConfig(TXLINE_ID, SystemProgram.programId, payer.publicKey, DESTINATION_CHAIN)
    .accountsStrict({
      admin: payer.publicKey,
      config: configPda,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICROLAMPORTS }),
    ])
    .rpc({ commitment: "finalized" });
  const initializeTransaction = await finalizedTransaction(
    primary,
    initializeSignature,
    "initialize_config primary",
  );
  console.log(
    `D2 initialize_config signature=${initializeSignature} slot=${initializeTransaction.slot}`,
  );

  const args = buildArgs();
  const strategyBytes = encodeCanonicalStrategy(args.strategy);
  const inputBytes = goldenInstruction.subarray(8, goldenInstruction.length - strategyBytes.length);
  assert.deepEqual(goldenInstruction.subarray(goldenInstruction.length - strategyBytes.length), strategyBytes);
  assert.deepEqual(goldenInstruction.subarray(0, 8), TXLINE_DISCRIMINATOR);

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
    // The Rust golden-vector test proves this payload is exactly the official
    // StatValidationInput || NDimensionalStrategy serialization.
    data: Buffer.concat([Buffer.from(verifyIdl.discriminator), goldenInstruction.subarray(8)]),
  });
  const verifyTransaction = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICROLAMPORTS }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    verifyIx,
  );
  const verifySignature = await sendAndConfirmTransaction(primary, verifyTransaction, [payer], {
    commitment: "finalized",
    preflightCommitment: "confirmed",
  });
  const verifyPrimary = await finalizedTransaction(primary, verifySignature, "verify_outcome primary");
  const primaryLogs = verifyPrimary.meta?.logMessages ?? [];
  assert(
    primaryLogs.some((line: string) => line.includes(`Program ${TXLINE_ID.toBase58()} invoke`)),
    "verify transaction did not CPI into TxLINE",
  );
  assert(
    primaryLogs.some((line: string) =>
      line.includes(`Program return: ${TXLINE_ID.toBase58()} AQ==`),
    ),
    "TxLINE did not return exact one-byte true",
  );
  console.log(
    `D2 verify_outcome signature=${verifySignature} slot=${verifyPrimary.slot} cu_limit=1400000 priority_micro_lamports=${PRIORITY_FEE_MICROLAMPORTS}`,
  );
  console.log(
    `D2 TxLINE_CPI=observed return=AQ== compute_units=${verifyPrimary.meta?.computeUnitsConsumed}`,
  );

  console.log(`D2 secondary_readback rpc=${secondaryRpc} commitment=finalized`);
  const secondary = new Connection(secondaryRpc, "finalized");
  const secondaryProvider = new anchor.AnchorProvider(secondary, primaryWallet, {
    commitment: "finalized",
    preflightCommitment: "finalized",
  });
  const secondaryProgram = new anchor.Program(idl, secondaryProvider);

  const deploySecondary = await finalizedTransaction(secondary, deploySignature, "deploy secondary");
  const initializeSecondary = await finalizedTransaction(
    secondary,
    initializeSignature,
    "initialize_config secondary",
  );
  const verifySecondary = await finalizedTransaction(secondary, verifySignature, "verify_outcome secondary");
  const secondaryLogs = verifySecondary.meta?.logMessages ?? [];
  assert(
    secondaryLogs.some((line: string) => line.includes(`Program ${TXLINE_ID.toBase58()} invoke`)),
    "secondary RPC did not expose TxLINE CPI log",
  );
  assert(
    secondaryLogs.some((line: string) =>
      line.includes(`Program return: ${TXLINE_ID.toBase58()} AQ==`),
    ),
    "secondary RPC did not expose exact TxLINE true return",
  );

  const programContext = await secondary.getAccountInfoAndContext(ADAPTER_ID, "finalized");
  const programAccount = programContext.value;
  assert(programAccount, "adapter program account is missing on secondary RPC");
  assert.equal(programAccount.executable, true, "adapter program account is not executable");
  assert(programAccount.owner.equals(BPF_UPGRADEABLE_LOADER_ID));
  const programDataAddress = decodeProgramDataAddress(programAccount.data);

  const programDataContext = await secondary.getAccountInfoAndContext(
    programDataAddress,
    "finalized",
  );
  const programDataAccount = programDataContext.value;
  assert(programDataAccount, "adapter ProgramData account is missing on secondary RPC");
  assert(programDataAccount.owner.equals(BPF_UPGRADEABLE_LOADER_ID));
  assert.equal(programDataAccount.data.length, deployedSo.length + 45);
  const upgradeAuthority = decodeUpgradeAuthority(programDataAccount.data);
  assert(upgradeAuthority.equals(payer.publicKey), "upgrade authority does not equal burner");

  const configContext = await secondary.getAccountInfoAndContext(configPda, "finalized");
  const outcomeContext = await secondary.getAccountInfoAndContext(outcomePda, "finalized");
  assert(configContext.value, "config PDA missing on secondary RPC");
  assert(outcomeContext.value, "VerifiedOutcome PDA missing on secondary RPC");
  const config: any = await secondaryProgram.account.config.fetch(configPda, "finalized");
  const outcome: any = await secondaryProgram.account.verifiedOutcome.fetch(
    outcomePda,
    "finalized",
  );
  assert(config.txlineProgramId.equals(TXLINE_ID));
  assert.equal(config.destinationChain, DESTINATION_CHAIN);
  assert(config.admin.equals(payer.publicKey));
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

  const finalBalanceLamports = await secondary.getBalance(payer.publicKey, "finalized");
  const rent = {
    programLamports: programAccount.lamports,
    programDataLamports: programDataAccount.lamports,
    configLamports: configContext.value.lamports,
    verifiedOutcomeLamports: outcomeContext.value.lamports,
  };
  const totalRentLamports = Object.values(rent).reduce((sum, value) => sum + value, 0);
  assert.equal(rent.programDataLamports, quotedProgramDataRentLamports);
  const explorerBase = "https://explorer.solana.com";
  const evidence = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    cluster: "mainnet-beta",
    rpc: { primary: primaryRpc, finalizedReadback: secondaryRpc },
    program: {
      id: ADAPTER_ID.toBase58(),
      programDataAddress: programDataAddress.toBase58(),
      executable: programAccount.executable,
      upgradeAuthority: upgradeAuthority.toBase58(),
      soBytes: deployedSo.length,
      soSha256: createHash("sha256").update(deployedSo).digest("hex"),
      maxLen: programDataAccount.data.length - 45,
    },
    transactions: {
      deploy: { signature: deploySignature, slot: deploySecondary.slot },
      initializeConfig: { signature: initializeSignature, slot: initializeSecondary.slot },
      verifyOutcome: {
        signature: verifySignature,
        slot: verifySecondary.slot,
        computeUnitLimit: 1_400_000,
        computeUnitPriceMicroLamports: PRIORITY_FEE_MICROLAMPORTS,
        computeUnitsConsumed: verifySecondary.meta?.computeUnitsConsumed ?? null,
        txlineCpiObserved: true,
        txlineReturnBase64: "AQ==",
      },
    },
    accounts: {
      configPda: configPda.toBase58(),
      verifiedOutcomePda: outcomePda.toBase58(),
      dailyRoot: DAILY_ROOT.toBase58(),
      txlineProgram: TXLINE_ID.toBase58(),
    },
    verifiedOutcome: {
      fixtureId: outcome.fixtureId.toString(),
      proofTimestampMs: outcome.proofTimestampMs.toString(),
      participant1Score: outcome.participant1Score,
      participant2Score: outcome.participant2Score,
      period: outcome.period,
      result: outcome.result,
      sourceValidationVersion: outcome.sourceValidationVersion,
      destinationChain: outcome.destinationChain,
      proofBundleHash: hex(outcome.proofBundleHash),
      validationInstructionHash: hex(outcome.validationInstructionHash),
      verifiedSlot: outcome.verifiedSlot.toString(),
      published: outcome.published,
      providerSequencePresent: false,
    },
    balance: {
      preDeployLamports: preDeployBalanceLamports,
      finalLamports: finalBalanceLamports,
      spentLamports: preDeployBalanceLamports - finalBalanceLamports,
    },
    rent: { ...rent, totalLamports: totalRentLamports },
    finalizedReadbackSlots: {
      program: programContext.context.slot,
      programData: programDataContext.context.slot,
      config: configContext.context.slot,
      verifiedOutcome: outcomeContext.context.slot,
    },
    explorer: {
      deploy: `${explorerBase}/tx/${deploySignature}`,
      initializeConfig: `${explorerBase}/tx/${initializeSignature}`,
      verifyOutcome: `${explorerBase}/tx/${verifySignature}`,
      program: `${explorerBase}/address/${ADAPTER_ID.toBase58()}`,
      verifiedOutcome: `${explorerBase}/address/${outcomePda.toBase58()}`,
    },
  };

  mkdirSync(evidenceOutputRoot, { recursive: true });
  const temporaryEvidence = `${evidenceOutput}.tmp`;
  writeFileSync(temporaryEvidence, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o644 });
  renameSync(temporaryEvidence, evidenceOutput);

  console.log(
    `D2 secondary_program executable=true program_data=${programDataAddress.toBase58()} upgrade_authority=${upgradeAuthority.toBase58()} readback_slot=${programContext.context.slot}`,
  );
  console.log(
    `D2 verified_outcome_pda=${outcomePda.toBase58()} fixture=${outcome.fixtureId.toString()} proof_timestamp=${outcome.proofTimestampMs.toString()} score=${outcome.participant1Score}-${outcome.participant2Score} period=${outcome.period} result=${outcome.result}`,
  );
  console.log(
    `D2 bundle_hash=${hex(outcome.proofBundleHash)} instruction_hash=${hex(outcome.validationInstructionHash)} verified_slot=${outcome.verifiedSlot.toString()} published=${outcome.published}`,
  );
  console.log(
    `D2 rent_lamports program=${rent.programLamports} program_data=${rent.programDataLamports} config=${rent.configLamports} verified_outcome=${rent.verifiedOutcomeLamports} total=${totalRentLamports}`,
  );
  console.log(
    `D2 burner_balance_lamports pre_deploy=${preDeployBalanceLamports} final=${finalBalanceLamports} spent=${preDeployBalanceLamports - finalBalanceLamports}`,
  );
  console.log(`D2 evidence=${evidenceOutput}`);
  console.log(`D2 explorer_program=${evidence.explorer.program}`);
  console.log(`D2 explorer_verify=${evidence.explorer.verifyOutcome}`);
  console.log("D2 RESULT=GREEN");
}

void main().catch((error: unknown) => {
  const signerPath = process.env.PROOFLINE_SIGNER_KEYPAIR ?? "";
  const raw = error instanceof Error ? error.stack ?? error.message : String(error);
  const sanitized = signerPath ? raw.split(signerPath).join("<redacted-signer-keypair>") : raw;
  console.error(`D2 CLIENT ERROR ${sanitized}`);
  process.exitCode = 1;
});
