/**
 * Devnet faucet: mints test tokens (both pool tokens) to any wallet.
 * Must be run by the mint authority (the wallet that ran task 11).
 *
 *   yarn faucet <wallet address> [amount, default 10000]
 */
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { connection, loadWallet, pk, readDeployments } from "./common";

async function main() {
  const [address, amount = "10000"] = process.argv.slice(2);
  if (!address) throw new Error("usage: yarn faucet <wallet address> [amount]");
  const wallet = loadWallet();
  const d = readDeployments();
  const raw = BigInt(amount) * 10n ** BigInt(d.decimals!);
  for (const mint of [d.mintA!, d.mintB!]) {
    const ata = await getOrCreateAssociatedTokenAccount(connection, wallet, pk(mint), pk(address));
    const sig = await mintTo(connection, wallet, pk(mint), ata.address, wallet, raw);
    console.log(`${amount} of ${mint} -> ${address}: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
