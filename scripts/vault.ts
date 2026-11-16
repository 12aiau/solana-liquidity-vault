import * as anchor from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotent,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, PublicKey } from "@solana/web3.js";
import { connection, Deployments, pk, recordTx, saveDeployments } from "./common";

export const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });

export function vaultPdas(programId: PublicKey, underlyingMint: PublicKey) {
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), underlyingMint.toBuffer()], programId);
  const [authority] = PublicKey.findProgramAddressSync([Buffer.from("authority"), vault.toBuffer()], programId);
  const [shareMint] = PublicKey.findProgramAddressSync([Buffer.from("share"), vault.toBuffer()], programId);
  const [strategyPosition] = PublicKey.findProgramAddressSync([Buffer.from("position"), vault.toBuffer()], programId);
  return { vault, authority, shareMint, strategyPosition };
}

/** Creates the vault for mintA (if needed), deposits, and returns its addresses. */
export async function ensureVaultWithDeposit(
  program: anchor.Program,
  wallet: Keypair,
  d: Deployments,
  depositTokens: number
) {
  const mintA = pk(d.mintA!);
  const mintB = pk(d.mintB!);
  const p = vaultPdas(program.programId, mintA);
  const unit = 10 ** d.decimals!;

  if (!(await connection.getAccountInfo(p.vault))) {
    const sig = await program.methods
      .initializeVault(new anchor.BN(0))
      .accounts({ admin: wallet.publicKey, underlyingMint: mintA })
      .rpc();
    d.vault = p.vault.toBase58();
    recordTx(d, "initializeVault", sig);
  }
  const userPda = PublicKey.findProgramAddressSync(
    [Buffer.from("user"), p.vault.toBuffer(), wallet.publicKey.toBuffer()],
    program.programId
  )[0];
  if (!(await connection.getAccountInfo(userPda))) {
    const sig = await program.methods
      .initUser()
      .accounts({ owner: wallet.publicKey, vault: p.vault })
      .rpc();
    recordTx(d, "initUser", sig);
  }
  const idleAta = getAssociatedTokenAddressSync(mintA, p.authority, true);
  // top up only when the vault holds less than requested (keeps reruns idempotent)
  if (depositTokens > 0 && (await balance(idleAta)) < depositTokens * unit) {
    const from = (await getOrCreateAssociatedTokenAccount(connection, wallet, mintA, wallet.publicKey)).address;
    const sig = await program.methods
      .deposit(new anchor.BN(depositTokens * unit), new anchor.BN(0))
      .accounts({ user: wallet.publicKey, vault: p.vault, userTokenAccount: from })
      .rpc();
    recordTx(d, `deposit${depositTokens}`, sig);
  }
  // vault PDA's account for the second pool token
  await createAssociatedTokenAccountIdempotent(connection, wallet, mintB, p.authority, {}, undefined, undefined, true);
  saveDeployments(d);

  return {
    ...p,
    mintA,
    mintB,
    unit,
    ataA: getAssociatedTokenAddressSync(mintA, p.authority, true),
    ataB: getAssociatedTokenAddressSync(mintB, p.authority, true),
  };
}

export async function balance(account: PublicKey) {
  return Number((await connection.getTokenAccountBalance(account)).value.amount);
}
