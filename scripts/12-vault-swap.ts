/**
 * Task 12: swap tokens held by the vault through the Raydium CLMM pool,
 * with a minimum-amount-out (slippage) guard enforced on-chain.
 *
 *   yarn task12
 */
import * as anchor from "@coral-xyz/anchor";
import { PoolUtils, getPdaExBitmapAccount } from "@raydium-io/raydium-sdk-v2";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { AccountMeta, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { CLMM_PROGRAM_ID, initRaydium, loadWallet, pk, readDeployments, recordTx, vaultProgram } from "./common";
import { balance, cu, ensureVaultWithDeposit } from "./vault";

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const SLIPPAGE = 0.01; // 1%

/** Quotes an exact-input swap and returns min out + the tick arrays it touches. */
export async function quoteSwap(
  raydium: Awaited<ReturnType<typeof initRaydium>>,
  poolId: string,
  inputMint: PublicKey,
  amountIn: BN,
  slippage = SLIPPAGE
) {
  const { poolInfo, poolKeys, computePoolInfo, tickData } = await raydium.clmm.getPoolInfoFromRpc(poolId);
  const aToB = inputMint.toBase58() === poolInfo.mintA.address;
  const quote = PoolUtils.computeAmountOutFormat({
    poolInfo: computePoolInfo,
    tickarrayBitmapExtension: computePoolInfo.exBitmapInfo,
    tickArrayCache: tickData[poolId],
    amountIn,
    tokenOut: aToB ? poolInfo.mintB : poolInfo.mintA,
    slippage,
    epochInfo: await raydium.fetchEpochInfo(),
    blockTimestamp: Math.floor(Date.now() / 1000),
  });
  const remaining: AccountMeta[] = [
    { pubkey: getPdaExBitmapAccount(CLMM_PROGRAM_ID, pk(poolId)).publicKey, isSigner: false, isWritable: true },
    ...quote.remainingAccounts.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
  ];
  return { poolInfo, poolKeys, aToB, quote, remaining };
}

/** Builds the vault `swap` instruction (vault PDA is the Raydium payer). */
export async function vaultSwap(
  program: anchor.Program,
  admin: PublicKey,
  v: { vault: PublicKey; authority: PublicKey; ataA: PublicKey; ataB: PublicKey },
  q: Awaited<ReturnType<typeof quoteSwap>>,
  amountIn: BN,
  minOut: BN
) {
  const { poolKeys, aToB } = q;
  return program.methods
    .swap(amountIn, minOut, new BN(0))
    .accountsPartial({
      admin,
      vault: v.vault,
      vaultAuthority: v.authority,
      vaultTokenAccount: v.ataA,
      clmmProgram: CLMM_PROGRAM_ID,
      ammConfig: pk(poolKeys.config.id),
      poolState: pk(poolKeys.id),
      inputTokenAccount: aToB ? v.ataA : v.ataB,
      outputTokenAccount: aToB ? v.ataB : v.ataA,
      inputVault: pk(aToB ? poolKeys.vault.A : poolKeys.vault.B),
      outputVault: pk(aToB ? poolKeys.vault.B : poolKeys.vault.A),
      observationState: pk(poolKeys.observationId),
      tokenProgram: TOKEN_PROGRAM_ID,
      tokenProgram2022: TOKEN_2022_PROGRAM_ID,
      memoProgram: MEMO_PROGRAM_ID,
      inputVaultMint: pk(aToB ? poolKeys.mintA.address : poolKeys.mintB.address),
      outputVaultMint: pk(aToB ? poolKeys.mintB.address : poolKeys.mintA.address),
    })
    .remainingAccounts(q.remaining);
}

async function main() {
  const wallet = loadWallet();
  const d = readDeployments();
  const program = vaultProgram(wallet);
  const raydium = await initRaydium(wallet);
  const v = await ensureVaultWithDeposit(program, wallet, d, 10_000);

  const amountIn = new BN(1_000 * v.unit);
  const q = await quoteSwap(raydium, d.poolId!, v.mintA, amountIn);
  const expected = q.quote.amountOut.amount.raw;
  const minOut = q.quote.minAmountOut.amount.raw;
  console.log(`quote: ${amountIn} A -> ${expected} B, min out (1% slippage) ${minOut}`);

  // 1. min out above what the pool can give -> must revert (slippage protection)
  try {
    await (await vaultSwap(program, wallet.publicKey, v, q, amountIn, expected.muln(2)))
      .preInstructions([cu])
      .rpc();
    throw new Error("swap with an impossible min_amount_out should fail");
  } catch (e: any) {
    const logs: string[] = e.logs ?? e.transactionLogs ?? [];
    if (!logs.length) throw e;
    const reason = logs.find((l) => /TooLittleOutputReceived|SlippageExceeded|Error Code|custom program error/.test(l)) ?? e.message;
    console.log("slippage guard works, tx reverted:", reason);
  }

  // 2. real swap with 1% slippage tolerance
  const [a0, b0] = [await balance(v.ataA), await balance(v.ataB)];
  const sig = await (await vaultSwap(program, wallet.publicKey, v, q, amountIn, minOut))
    .preInstructions([cu])
    .rpc();
  recordTx(d, "vaultSwap", sig);
  const [a1, b1] = [await balance(v.ataA), await balance(v.ataB)];
  console.log(`vault A: ${a0} -> ${a1}, vault B: ${b0} -> ${b1}`);
  const vault: any = await (program.account as any).vault.fetch(v.vault);
  console.log("deployed_assets (book value in A):", vault.deployedAssets.toString());
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
