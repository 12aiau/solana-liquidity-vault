import { Program } from "@coral-xyz/anchor";
import {
  LiquidityMathUtil,
  PersonalPositionLayout,
  PoolUtils,
  Raydium,
  TickUtil,
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
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
} from "@solana/web3.js";
import BN from "bn.js";
import { CLMM_PROGRAM_ID, MINT_A, MINT_B, POOL_ID } from "../config";
import { VaultState, tokenAmount, vaultPdas } from "./vault";

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const TICK_ARRAY_SIZE = 60;
/** SOL the vault PDA keeps to pay Raydium rent when opening a position. */
const RENT_LAMPORTS = 30_000_000;

const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });
const pk = (s: string | PublicKey) => new PublicKey(s);
const tickArrayStart = (tick: number, spacing: number) =>
  Math.floor(tick / (spacing * TICK_ARRAY_SIZE)) * spacing * TICK_ARRAY_SIZE;
const exBitmap = () => getPdaExBitmapAccount(CLMM_PROGRAM_ID, POOL_ID).publicKey;

export function loadRaydium(connection: Connection, owner?: PublicKey) {
  return Raydium.load({
    connection,
    owner,
    cluster: "devnet",
    disableFeatureCheck: true,
    disableLoadToken: true,
    blockhashCommitment: "confirmed",
  });
}

export type PoolState = {
  poolKeys: any;
  poolInfo: any;
  computePoolInfo: any;
  tickData: any;
  tick: number;
  spacing: number;
  sqrtPriceX64: BN;
  /** price of token A in token B */
  price: number;
};

export async function fetchPool(raydium: Raydium): Promise<PoolState> {
  const { poolInfo, poolKeys, computePoolInfo, tickData } = await raydium.clmm.getPoolInfoFromRpc(
    POOL_ID.toBase58()
  );
  const tick = computePoolInfo.tickCurrent;
  return {
    poolInfo,
    poolKeys,
    computePoolInfo,
    tickData,
    tick,
    spacing: computePoolInfo.tickSpacing,
    sqrtPriceX64: computePoolInfo.sqrtPriceX64,
    price: Math.pow(1.0001, tick),
  };
}

export async function positionLiquidity(connection: Connection, nftMint: PublicKey): Promise<BN> {
  const info = await connection.getAccountInfo(getPdaPersonalPositionAddress(CLMM_PROGRAM_ID, nftMint).publicKey);
  return info ? PersonalPositionLayout.decode(info.data).liquidity : new BN(0);
}

function baseAccounts(program: Program, admin: PublicKey) {
  const p = vaultPdas(program.programId);
  return {
    admin,
    vault: p.vault,
    vaultAuthority: p.authority,
    vaultTokenAccount: p.ataA,
    strategyPosition: p.strategyPosition,
    clmmProgram: CLMM_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };
}

function positionAccounts(program: Program, nftMint: PublicKey, tickLower: number, tickUpper: number, spacing: number) {
  const p = vaultPdas(program.programId);
  const arr = (tick: number) =>
    getPdaTickArrayAddress(CLMM_PROGRAM_ID, POOL_ID, tickArrayStart(tick, spacing)).publicKey;
  return {
    nftAccount: getAssociatedTokenAddressSync(nftMint, p.authority, true),
    personalPosition: getPdaPersonalPositionAddress(CLMM_PROGRAM_ID, nftMint).publicKey,
    protocolPosition: getPdaProtocolPositionAddress(CLMM_PROGRAM_ID, POOL_ID, tickLower, tickUpper).publicKey,
    tickArrayLower: arr(tickLower),
    tickArrayUpper: arr(tickUpper),
  };
}

/** Quote an exact-input swap of vault tokens. */
export async function quoteSwap(raydium: Raydium, pool: PoolState, aToB: boolean, amountIn: BN, slippage: number) {
  const quote = PoolUtils.computeAmountOutFormat({
    poolInfo: pool.computePoolInfo,
    tickarrayBitmapExtension: pool.computePoolInfo.exBitmapInfo,
    tickArrayCache: pool.tickData[POOL_ID.toBase58()],
    amountIn,
    tokenOut: aToB ? pool.poolInfo.mintB : pool.poolInfo.mintA,
    slippage,
    epochInfo: await raydium.fetchEpochInfo(),
    blockTimestamp: Math.floor(Date.now() / 1000),
  });
  return {
    amountOut: quote.amountOut.amount.raw as BN,
    minAmountOut: quote.minAmountOut.amount.raw as BN,
    tickArrays: quote.remainingAccounts as PublicKey[],
  };
}

export function buildSwap(
  program: Program,
  admin: PublicKey,
  pool: PoolState,
  aToB: boolean,
  amountIn: BN,
  q: Awaited<ReturnType<typeof quoteSwap>>
) {
  const p = vaultPdas(program.programId);
  const { poolKeys } = pool;
  return program.methods
    .swap(amountIn, q.minAmountOut, new BN(0))
    .accountsPartial({
      admin,
      vault: p.vault,
      vaultAuthority: p.authority,
      vaultTokenAccount: p.ataA,
      clmmProgram: CLMM_PROGRAM_ID,
      ammConfig: pk(poolKeys.config.id),
      poolState: POOL_ID,
      inputTokenAccount: aToB ? p.ataA : p.ataB,
      outputTokenAccount: aToB ? p.ataB : p.ataA,
      inputVault: pk(aToB ? poolKeys.vault.A : poolKeys.vault.B),
      outputVault: pk(aToB ? poolKeys.vault.B : poolKeys.vault.A),
      observationState: pk(poolKeys.observationId),
      tokenProgram: TOKEN_PROGRAM_ID,
      tokenProgram2022: TOKEN_2022_PROGRAM_ID,
      memoProgram: MEMO_PROGRAM_ID,
      inputVaultMint: aToB ? MINT_A : MINT_B,
      outputVaultMint: aToB ? MINT_B : MINT_A,
    })
    .remainingAccounts([
      { pubkey: exBitmap(), isSigner: false, isWritable: true },
      ...q.tickArrays.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
    ])
    .preInstructions([
      cu,
      // the vault PDA needs a token account for the second pool token
      createAssociatedTokenAccountIdempotentInstruction(admin, p.ataB, p.authority, MINT_B),
    ]);
}

/** Range of +-`halfWidth` tick spacings around the current tick. */
export function rangeAround(pool: PoolState, halfWidth: number) {
  const center = Math.floor(pool.tick / pool.spacing) * pool.spacing;
  return {
    tickLower: center - halfWidth * pool.spacing,
    tickUpper: center + (halfWidth + 1) * pool.spacing,
  };
}

export async function buildOpenPosition(
  program: Program,
  admin: PublicKey,
  pool: PoolState,
  range: { tickLower: number; tickUpper: number },
  maxA: BN,
  maxB: BN
) {
  const p = vaultPdas(program.programId);
  const connection = program.provider.connection;
  // never ask for more than the vault holds
  const [haveA, haveB] = await Promise.all([tokenAmount(connection, p.ataA), tokenAmount(connection, p.ataB)]);
  const useA = BN.min(maxA, haveA.muln(95).divn(100));
  const useB = BN.min(maxB, haveB.muln(95).divn(100));
  const liquidity = LiquidityMathUtil.getLiquidityFromAmounts(
    pool.sqrtPriceX64,
    TickUtil.getSqrtPriceAtTick(range.tickLower),
    TickUtil.getSqrtPriceAtTick(range.tickUpper),
    useA,
    useB
  );
  if (liquidity.isZero()) throw new Error("Недостаточно токенов в vault для позиции в этом диапазоне");

  const nftMint = Keypair.generate();
  const pos = positionAccounts(program, nftMint.publicKey, range.tickLower, range.tickUpper, pool.spacing);
  const pdaLamports = await connection.getBalance(p.authority);
  const builder = program.methods
    .openPosition({
      tickLowerIndex: range.tickLower,
      tickUpperIndex: range.tickUpper,
      tickArrayLowerStartIndex: tickArrayStart(range.tickLower, pool.spacing),
      tickArrayUpperStartIndex: tickArrayStart(range.tickUpper, pool.spacing),
      liquidity,
      amount0Max: useA.muln(101).divn(100).addn(1),
      amount1Max: useB.muln(101).divn(100).addn(1),
      rentLamports: new BN(Math.max(0, RENT_LAMPORTS - pdaLamports)),
    })
    .accountsPartial({
      base: baseAccounts(program, admin),
      positionNftMint: nftMint.publicKey,
      positionNftAccount: pos.nftAccount,
      metadataAccount: getPdaMetadataKey(nftMint.publicKey).publicKey,
      poolState: POOL_ID,
      protocolPosition: pos.protocolPosition,
      tickArrayLower: pos.tickArrayLower,
      tickArrayUpper: pos.tickArrayUpper,
      personalPosition: pos.personalPosition,
      tokenAccount0: p.ataA,
      tokenAccount1: p.ataB,
      tokenVault0: pk(pool.poolKeys.vault.A),
      tokenVault1: pk(pool.poolKeys.vault.B),
      rent: SYSVAR_RENT_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      metadataProgram: METADATA_PROGRAM_ID,
      tokenProgram2022: TOKEN_2022_PROGRAM_ID,
      vault0Mint: MINT_A,
      vault1Mint: MINT_B,
    })
    .remainingAccounts([{ pubkey: exBitmap(), isSigner: false, isWritable: true }])
    .preInstructions([cu])
    .signers([nftMint]);
  return { builder, liquidity };
}

/** `liquidity = 0` only collects the accumulated fees. */
export function buildDecrease(
  program: Program,
  admin: PublicKey,
  pool: PoolState,
  position: NonNullable<VaultState["position"]>,
  liquidity: BN
) {
  const p = vaultPdas(program.programId);
  const pos = positionAccounts(program, position.nftMint, position.tickLower, position.tickUpper, pool.spacing);
  return program.methods
    .decreaseLiquidity(liquidity, new BN(0), new BN(0))
    .accountsPartial({
      base: baseAccounts(program, admin),
      nftAccount: pos.nftAccount,
      personalPosition: pos.personalPosition,
      poolState: POOL_ID,
      protocolPosition: pos.protocolPosition,
      tokenVault0: pk(pool.poolKeys.vault.A),
      tokenVault1: pk(pool.poolKeys.vault.B),
      tickArrayLower: pos.tickArrayLower,
      tickArrayUpper: pos.tickArrayUpper,
      recipientTokenAccount0: p.ataA,
      recipientTokenAccount1: p.ataB,
      tokenProgram: TOKEN_PROGRAM_ID,
      tokenProgram2022: TOKEN_2022_PROGRAM_ID,
      memoProgram: MEMO_PROGRAM_ID,
      vault0Mint: MINT_A,
      vault1Mint: MINT_B,
    })
    .remainingAccounts([{ pubkey: exBitmap(), isSigner: false, isWritable: true }])
    .preInstructions([cu]);
}

export function buildClose(
  program: Program,
  admin: PublicKey,
  pool: PoolState,
  position: NonNullable<VaultState["position"]>
) {
  const pos = positionAccounts(program, position.nftMint, position.tickLower, position.tickUpper, pool.spacing);
  return program.methods
    .closePosition()
    .accountsPartial({
      base: baseAccounts(program, admin),
      positionNftMint: position.nftMint,
      positionNftAccount: pos.nftAccount,
      personalPosition: pos.personalPosition,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions([cu]);
}
