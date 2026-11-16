/**
 * Task 13: the vault opens a Raydium CLMM position in a chosen price range,
 * collects trading fees, and when the price leaves the range it closes the
 * position and re-opens it around the new price (rebalance).
 *
 *   yarn task13
 */
import * as anchor from "@coral-xyz/anchor";
import {
  LiquidityMathUtil,
  PersonalPositionLayout,
  TickUtil,
  TxVersion,
  getPdaExBitmapAccount,
  getPdaMetadataKey,
  getPdaPersonalPositionAddress,
  getPdaProtocolPositionAddress,
  getPdaTickArrayAddress,
} from "@raydium-io/raydium-sdk-v2";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Keypair, PublicKey, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import BN from "bn.js";
import {
  CLMM_PROGRAM_ID,
  alignTick,
  connection,
  initRaydium,
  loadWallet,
  pk,
  readDeployments,
  recordTx,
  tickArrayStart,
  vaultProgram,
} from "./common";
import { balance, cu, ensureVaultWithDeposit } from "./vault";
import { quoteSwap } from "./12-vault-swap";

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
/** Half-width of the vault's range, in tick spacings (60 ticks ~ 0.6%). */
const RANGE_SPACINGS = 2;
const RENT_LAMPORTS = 30_000_000; // SOL the vault PDA needs to pay Raydium rent

type Ctx = Awaited<ReturnType<typeof setup>>;

async function setup() {
  const wallet = loadWallet();
  const d = readDeployments();
  const program = vaultProgram(wallet);
  const raydium = await initRaydium(wallet);
  const v = await ensureVaultWithDeposit(program, wallet, d, 20_000);
  const poolId = pk(d.poolId!);
  const exBitmap = getPdaExBitmapAccount(CLMM_PROGRAM_ID, poolId).publicKey;
  const base = {
    admin: wallet.publicKey,
    vault: v.vault,
    vaultAuthority: v.authority,
    vaultTokenAccount: v.ataA,
    strategyPosition: v.strategyPosition,
    clmmProgram: CLMM_PROGRAM_ID,
    systemProgram: anchor.web3.SystemProgram.programId,
  };
  return { wallet, d, program, raydium, v, poolId, exBitmap, base };
}

async function poolState(c: Ctx) {
  const { poolKeys, computePoolInfo } = await c.raydium.clmm.getPoolInfoFromRpc(c.d.poolId!);
  return {
    poolKeys,
    tick: computePoolInfo.tickCurrent as number,
    spacing: computePoolInfo.tickSpacing as number,
    sqrtPriceX64: computePoolInfo.sqrtPriceX64 as BN,
  };
}

function positionAccounts(c: Ctx, nftMint: PublicKey, tickLower: number, tickUpper: number, spacing: number) {
  const arr = (tick: number) =>
    getPdaTickArrayAddress(CLMM_PROGRAM_ID, c.poolId, tickArrayStart(tick, spacing)).publicKey;
  return {
    nftAccount: getAssociatedTokenAddressSync(nftMint, c.v.authority, true),
    personalPosition: getPdaPersonalPositionAddress(CLMM_PROGRAM_ID, nftMint).publicKey,
    protocolPosition: getPdaProtocolPositionAddress(CLMM_PROGRAM_ID, c.poolId, tickLower, tickUpper).publicKey,
    tickArrayLower: arr(tickLower),
    tickArrayUpper: arr(tickUpper),
  };
}

/** Opens a position of +-RANGE_SPACINGS around the current tick. */
async function openAroundPrice(c: Ctx, label: string, amountA: number, amountB: number) {
  const s = await poolState(c);
  const center = alignTick(s.tick, s.spacing);
  const tickLower = center - RANGE_SPACINGS * s.spacing;
  const tickUpper = center + (RANGE_SPACINGS + 1) * s.spacing;
  // never ask for more than the vault holds (after a rebalance one side may be thin)
  const cap = async (want: number, ata: PublicKey) =>
    new BN(Math.min(want * c.v.unit, Math.floor((await balance(ata)) * 0.95)));
  const [maxA, maxB] = [await cap(amountA, c.v.ataA), await cap(amountB, c.v.ataB)];
  const liquidity = LiquidityMathUtil.getLiquidityFromAmounts(
    s.sqrtPriceX64,
    TickUtil.getSqrtPriceAtTick(tickLower),
    TickUtil.getSqrtPriceAtTick(tickUpper),
    maxA,
    maxB
  );
  const nftMint = Keypair.generate();
  const p = positionAccounts(c, nftMint.publicKey, tickLower, tickUpper, s.spacing);
  const pda = await connection.getBalance(c.v.authority);

  const sig = await c.program.methods
    .openPosition({
      tickLowerIndex: tickLower,
      tickUpperIndex: tickUpper,
      tickArrayLowerStartIndex: tickArrayStart(tickLower, s.spacing),
      tickArrayUpperStartIndex: tickArrayStart(tickUpper, s.spacing),
      liquidity,
      amount0Max: maxA.muln(101).divn(100).addn(1),
      amount1Max: maxB.muln(101).divn(100).addn(1),
      rentLamports: new BN(Math.max(0, RENT_LAMPORTS - pda)),
    })
    .accountsPartial({
      base: c.base,
      positionNftMint: nftMint.publicKey,
      positionNftAccount: p.nftAccount,
      metadataAccount: getPdaMetadataKey(nftMint.publicKey).publicKey,
      poolState: c.poolId,
      protocolPosition: p.protocolPosition,
      tickArrayLower: p.tickArrayLower,
      tickArrayUpper: p.tickArrayUpper,
      personalPosition: p.personalPosition,
      tokenAccount0: c.v.ataA,
      tokenAccount1: c.v.ataB,
      tokenVault0: pk(s.poolKeys.vault.A),
      tokenVault1: pk(s.poolKeys.vault.B),
      rent: SYSVAR_RENT_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      metadataProgram: METADATA_PROGRAM_ID,
      tokenProgram2022: TOKEN_2022_PROGRAM_ID,
      vault0Mint: c.v.mintA,
      vault1Mint: c.v.mintB,
    })
    .remainingAccounts([{ pubkey: c.exBitmap, isSigner: false, isWritable: true }])
    .preInstructions([cu])
    .signers([nftMint])
    .rpc();
  recordTx(c.d, label, sig);
  console.log(`  range ticks [${tickLower}, ${tickUpper}], current tick ${s.tick}, L = ${liquidity}`);
  return { nftMint: nftMint.publicKey, tickLower, tickUpper, spacing: s.spacing };
}

/** liquidity = 0 -> only collects fees; otherwise removes liquidity (+ fees). */
async function decrease(c: Ctx, label: string, pos: Awaited<ReturnType<typeof openAroundPrice>>, liquidity: BN) {
  const s = await poolState(c);
  const p = positionAccounts(c, pos.nftMint, pos.tickLower, pos.tickUpper, pos.spacing);
  const [a0, b0] = [await balance(c.v.ataA), await balance(c.v.ataB)];
  const sig = await c.program.methods
    .decreaseLiquidity(liquidity, new BN(0), new BN(0))
    .accountsPartial({
      base: c.base,
      nftAccount: p.nftAccount,
      personalPosition: p.personalPosition,
      poolState: c.poolId,
      protocolPosition: p.protocolPosition,
      tokenVault0: pk(s.poolKeys.vault.A),
      tokenVault1: pk(s.poolKeys.vault.B),
      tickArrayLower: p.tickArrayLower,
      tickArrayUpper: p.tickArrayUpper,
      recipientTokenAccount0: c.v.ataA,
      recipientTokenAccount1: c.v.ataB,
      tokenProgram: TOKEN_PROGRAM_ID,
      tokenProgram2022: TOKEN_2022_PROGRAM_ID,
      memoProgram: MEMO_PROGRAM_ID,
      vault0Mint: c.v.mintA,
      vault1Mint: c.v.mintB,
    })
    .remainingAccounts([{ pubkey: c.exBitmap, isSigner: false, isWritable: true }])
    .preInstructions([cu])
    .rpc();
  recordTx(c.d, label, sig);
  const [a1, b1] = [await balance(c.v.ataA), await balance(c.v.ataB)];
  console.log(`  vault received: ${a1 - a0} A, ${b1 - b0} B (raw units)`);
}

async function close(c: Ctx, label: string, pos: Awaited<ReturnType<typeof openAroundPrice>>) {
  const p = positionAccounts(c, pos.nftMint, pos.tickLower, pos.tickUpper, pos.spacing);
  const sig = await c.program.methods
    .closePosition()
    .accountsPartial({
      base: c.base,
      positionNftMint: pos.nftMint,
      positionNftAccount: p.nftAccount,
      personalPosition: p.personalPosition,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions([cu])
    .rpc();
  recordTx(c.d, label, sig);
}

async function positionLiquidity(nftMint: PublicKey): Promise<BN> {
  const info = await connection.getAccountInfo(getPdaPersonalPositionAddress(CLMM_PROGRAM_ID, nftMint).publicKey);
  return PersonalPositionLayout.decode(info!.data).liquidity;
}

/** An outside trader (the wallet) swaps directly on Raydium. */
async function traderSwap(c: Ctx, inputMint: PublicKey, tokens: number) {
  const amountIn = new BN(tokens * c.v.unit);
  const q = await quoteSwap(c.raydium, c.d.poolId!, inputMint, amountIn, 0.05);
  const { execute } = await c.raydium.clmm.swap({
    poolInfo: q.poolInfo,
    poolKeys: q.poolKeys,
    inputMint,
    amountIn,
    amountOutMin: q.quote.minAmountOut.amount.raw,
    observationId: pk(q.poolKeys.observationId),
    ownerInfo: { useSOLBalance: false },
    remainingAccounts: q.quote.remainingAccounts,
    txVersion: TxVersion.V0,
  });
  const { txId } = await execute({ sendAndConfirm: true });
  return txId;
}

async function main() {
  const c = await setup();

  // resume support: if an earlier run already closed the position, only re-open it
  const existing: any = await (c.program.account as any).strategyPosition.fetchNullable(c.v.strategyPosition);
  if (existing && !existing.active) {
    console.log("position was closed earlier -> re-open around the current price");
    await openAroundPrice(c, "reopenPosition", 2_000, 500);
    return;
  }
  if (existing?.active) throw new Error("vault already has an active position");

  console.log("1. open position around the current price");
  const pos = await openAroundPrice(c, "openPosition", 2_000, 500);

  console.log("2. traders swap back and forth -> the position earns fees");
  await traderSwap(c, c.v.mintB, 1_500);
  await traderSwap(c, c.v.mintA, 1_500);

  console.log("3. collect fees (decrease_liquidity with liquidity = 0)");
  await decrease(c, "collectFees", pos, new BN(0));

  console.log("4. a big trade pushes the price out of the range");
  for (let i = 0; i < 6; i++) {
    const { tick } = await poolState(c);
    console.log(`  current tick ${tick}, range [${pos.tickLower}, ${pos.tickUpper}]`);
    if (tick < pos.tickLower || tick >= pos.tickUpper) break;
    recordTx(c.d, "pushPriceOutOfRange", await traderSwap(c, c.v.mintA, 8_000));
  }
  const { tick } = await poolState(c);
  if (tick >= pos.tickLower && tick < pos.tickUpper) throw new Error("price is still in range");

  console.log("5. rebalance: remove all liquidity, close, re-open around the new price");
  await decrease(c, "removeLiquidity", pos, await positionLiquidity(pos.nftMint));
  await close(c, "closePosition", pos);
  const next = await openAroundPrice(c, "reopenPosition", 2_000, 500);

  const sp: any = await (c.program.account as any).strategyPosition.fetch(c.v.strategyPosition);
  console.log("active position NFT:", sp.nftMint.toBase58(), "ticks", sp.tickLower, sp.tickUpper);
  console.log("in range again:", (await poolState(c)).tick >= next.tickLower);
}

main().catch((e) => {
  console.error(e.logs ?? e);
  process.exit(1);
});
