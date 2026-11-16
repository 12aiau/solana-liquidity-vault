/**
 * Task 11: create two test SPL tokens and a Raydium CLMM pool on devnet,
 * then seed it with a wide-range liquidity position.
 *
 *   yarn ts-node scripts/11-create-pool.ts
 */
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { getPdaPoolId, TxVersion } from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";
import Decimal from "decimal.js";
import {
  alignTick,
  CLMM_PROGRAM_ID,
  connection,
  initRaydium,
  loadWallet,
  readDeployments,
  recordTx,
  saveDeployments,
} from "./common";

const DECIMALS = 6;
const SUPPLY = 10_000_000; // whole tokens of each mint to the wallet
const INITIAL_PRICE = new Decimal(1); // 1 A = 1 B
const SEED_AMOUNT = 100_000; // whole tokens of A put into the seed position

async function main() {
  const wallet = loadWallet();
  const d = readDeployments();
  console.log("wallet", wallet.publicKey.toBase58());

  // 1. test tokens
  if (!d.mintA || !d.mintB) {
    const m1 = await createMint(connection, wallet, wallet.publicKey, null, DECIMALS);
    const m2 = await createMint(connection, wallet, wallet.publicKey, null, DECIMALS);
    // Raydium orders pool mints by pubkey bytes: mintA < mintB
    const [a, b] = Buffer.compare(m1.toBuffer(), m2.toBuffer()) < 0 ? [m1, m2] : [m2, m1];
    for (const m of [a, b]) {
      const ata = await getOrCreateAssociatedTokenAccount(connection, wallet, m, wallet.publicKey);
      await mintTo(connection, wallet, m, ata.address, wallet, BigInt(SUPPLY) * 10n ** BigInt(DECIMALS));
    }
    Object.assign(d, { mintA: a.toBase58(), mintB: b.toBase58(), decimals: DECIMALS });
    saveDeployments(d);
    console.log("mintA", d.mintA, "\nmintB", d.mintB);
  }

  const raydium = await initRaydium(wallet);

  // 2. CLMM pool
  if (!d.poolId) {
    const configs = await raydium.api.getClmmConfigs();
    // pick the 0.25% fee tier (tick spacing 60) if present
    const cfg = configs.find((c) => c.tickSpacing === 60) ?? configs[0];
    const token = (mint: string) => ({
      address: mint,
      programId: TOKEN_PROGRAM_ID.toBase58(),
      decimals: DECIMALS,
      symbol: "",
      name: "",
      logoURI: "",
      chainId: 0,
      tags: [],
      extensions: {},
    });
    const poolId = getPdaPoolId(
      CLMM_PROGRAM_ID,
      new PublicKey(cfg.id),
      new PublicKey(d.mintA!),
      new PublicKey(d.mintB!)
    ).publicKey;
    if (!(await connection.getAccountInfo(poolId))) {
      const { execute } = await raydium.clmm.createPool({
        programId: CLMM_PROGRAM_ID,
        mint1: token(d.mintA!),
        mint2: token(d.mintB!),
        ammConfig: { ...cfg, id: new PublicKey(cfg.id), fundOwner: "", description: "" },
        initialPrice: INITIAL_PRICE,
        txVersion: TxVersion.V0,
      });
      const { txId } = await execute({ sendAndConfirm: true });
      recordTx(d, "createPool", txId);
    }
    d.poolId = poolId.toBase58();
    d.ammConfig = cfg.id;
    saveDeployments(d);
    console.log("pool", d.poolId, "tickSpacing", cfg.tickSpacing, "fee", cfg.tradeFeeRate / 1e4, "%");
  }

  // 3. seed liquidity: +-20% around the current price
  if (!d.txs?.seedLiquidity) {
    // a fresh pool has no tick arrays yet, so use the "simple" RPC view
    const { poolInfo, rpcData } = await raydium.clmm.getSimplePoolInfo(d.poolId!);
    const poolKeys = { vault: { A: rpcData.vaultA, B: rpcData.vaultB } };
    const spacing = rpcData.tickSpacing;
    const cur = rpcData.tickCurrent;
    const width = Math.round(Math.log(1.2) / Math.log(1.0001));
    const tickLower = alignTick(cur - width, spacing);
    const tickUpper = alignTick(cur + width, spacing) + spacing;
    const base = new BN(SEED_AMOUNT).mul(new BN(10).pow(new BN(DECIMALS)));
    const { execute } = await raydium.clmm.openPositionFromBase({
      poolInfo,
      poolKeys,
      tickLower,
      tickUpper,
      base: "MintA",
      ownerInfo: { useSOLBalance: false },
      baseAmount: base,
      otherAmountMax: base.muln(2),
      txVersion: TxVersion.V0,
    });
    const { txId } = await execute({ sendAndConfirm: true });
    recordTx(d, "seedLiquidity", txId);
    console.log(`seed position ticks [${tickLower}, ${tickUpper}], current ${cur}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
