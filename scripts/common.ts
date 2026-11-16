import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { DEVNET_PROGRAM_ID, Raydium } from "@raydium-io/raydium-sdk-v2";
import fs from "fs";
import os from "os";
import path from "path";

export const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
export const CLMM_PROGRAM_ID = DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID;
export const DEPLOYMENTS = path.join(__dirname, "..", "deployments", "devnet.json");

/** Wallet keypair path: never stored in the repo. */
export function loadWallet(): Keypair {
  const file =
    process.env.ANCHOR_WALLET ?? path.join(os.homedir(), ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
}

export const connection = new Connection(RPC_URL, "confirmed");

export async function initRaydium(owner: Keypair) {
  return Raydium.load({
    connection,
    owner,
    cluster: "devnet",
    disableFeatureCheck: true,
    disableLoadToken: true,
    blockhashCommitment: "confirmed",
  });
}

export type Deployments = {
  mintA?: string;
  mintB?: string;
  decimals?: number;
  poolId?: string;
  ammConfig?: string;
  vault?: string;
  txs?: Record<string, string>;
};

export function readDeployments(): Deployments {
  return fs.existsSync(DEPLOYMENTS) ? JSON.parse(fs.readFileSync(DEPLOYMENTS, "utf8")) : {};
}

export function saveDeployments(d: Deployments) {
  fs.mkdirSync(path.dirname(DEPLOYMENTS), { recursive: true });
  fs.writeFileSync(DEPLOYMENTS, JSON.stringify(d, null, 2) + "\n");
}

export function recordTx(d: Deployments, name: string, sig: string) {
  d.txs = { ...(d.txs ?? {}), [name]: sig };
  saveDeployments(d);
  console.log(`${name}: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

export function vaultProgram(wallet: Keypair) {
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const idl = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "target", "idl", "liquidity_vault.json"), "utf8")
  );
  return new anchor.Program(idl, provider);
}

export const TICK_ARRAY_SIZE = 60;
export const tickArrayStart = (tick: number, tickSpacing: number) =>
  Math.floor(tick / (tickSpacing * TICK_ARRAY_SIZE)) * tickSpacing * TICK_ARRAY_SIZE;
export const alignTick = (tick: number, tickSpacing: number) =>
  Math.floor(tick / tickSpacing) * tickSpacing;

export const pk = (s: string) => new PublicKey(s);
