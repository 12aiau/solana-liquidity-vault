/**
 * Simulates every transaction the UI can send against devnet, using the same
 * builders as the app. Nothing is sent on-chain.
 *
 *   ANCHOR_WALLET=/path/to/admin-wallet.json npm run smoke
 */
import { Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import { Connection } from "@solana/web3.js";
import BN from "bn.js";
import fs from "fs";
import {
  buildClose,
  buildDecrease,
  buildOpenPosition,
  buildSwap,
  fetchPool,
  loadRaydium,
  positionLiquidity,
  quoteSwap,
  rangeAround,
} from "../src/lib/admin";
import { pretty } from "../src/lib/format";
import { buildDeposit, buildWithdraw, errorMessage, fetchVaultState, getProgram } from "../src/lib/vault";

async function main() {
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_WALLET!, "utf8"))));
  const wallet = {
    publicKey: kp.publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => {
      tx instanceof Transaction ? tx.partialSign(kp) : tx.sign([kp]);
      return tx;
    },
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => txs,
  };
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const program = getProgram(connection, wallet);
  const me = kp.publicKey;

  const check = async (name: string, builder: { simulate(): Promise<unknown> } | Promise<any>) => {
    try {
      await (await builder).simulate();
      console.log(`ok    ${name}`);
    } catch (e) {
      console.log(`FAIL  ${name}: ${errorMessage(e)}`);
      process.exitCode = 1;
    }
  };

  const s = (await fetchVaultState(program, me))!;
  console.log(
    `vault: total ${pretty(s.totalAssets)}, idle ${pretty(s.idle)}, deployed ${pretty(s.deployed)}, shares ${pretty(s.shareSupply)}`
  );
  console.log(`user: tokens ${pretty(s.user!.tokens)}, shares ${pretty(s.user!.shares)} ~ ${pretty(s.user!.sharesValue)}`);

  await check("deposit 10", buildDeposit(program, me, new BN(10_000_000), new BN(0)));
  await check("withdraw 5 shares", buildWithdraw(program, me, new BN(5_000_000), new BN(0)));

  const raydium = await loadRaydium(connection, me);
  const pool = await fetchPool(raydium);
  console.log(`pool: tick ${pool.tick}, price ${pool.price.toFixed(5)}`);

  for (const aToB of [true, false]) {
    const amount = new BN(10_000_000);
    const q = await quoteSwap(raydium, pool, aToB, amount, 0.01);
    await check(`swap 10 ${aToB ? "A->B" : "B->A"} (min out ${pretty(q.minAmountOut)})`, buildSwap(program, me, pool, aToB, amount, q));
  }

  if (s.position?.active) {
    await check("collect fees", buildDecrease(program, me, pool, s.position, new BN(0)));
    const liq = await positionLiquidity(connection, s.position.nftMint);
    await check("remove all liquidity", buildDecrease(program, me, pool, s.position, liq));
    // close needs an empty position, so it can only be simulated after a real removal
    void buildClose;
  } else {
    const { builder } = await buildOpenPosition(program, me, pool, rangeAround(pool, 2), new BN(100_000_000), new BN(100_000_000));
    await check("open position", builder);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
