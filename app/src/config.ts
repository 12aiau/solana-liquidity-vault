import { PublicKey } from "@solana/web3.js";

// Devnet deployment (see ../deployments/devnet.json)
export const RPC_URL = import.meta.env?.VITE_RPC_URL ?? "https://api.devnet.solana.com";
export const MINT_A = new PublicKey("2ymb33oWsWGQMqJ9u8zA1gypynxiKs6N8DUxM4McpdAU");
export const MINT_B = new PublicKey("APjEpWCiAwkxFEuGiojA2MBK4d2BAqd4CZJdJ5dBQexq");
export const POOL_ID = new PublicKey("EMSCboYCKG6tchGfFaUXPZDjW7ffxoqpLRJ6XHDNqvjG");
export const CLMM_PROGRAM_ID = new PublicKey("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH");
export const DECIMALS = 6;
export const SYMBOL_A = "TKA";
export const SYMBOL_B = "TKB";

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const explorerAddress = (a: PublicKey | string) =>
  `https://explorer.solana.com/address/${a.toString()}?cluster=devnet`;
