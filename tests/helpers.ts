import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export const VAULT_SEED = Buffer.from("vault");
export const AUTHORITY_SEED = Buffer.from("authority");
export const SHARE_MINT_SEED = Buffer.from("share");
export const USER_SEED = Buffer.from("user");

export function vaultPdas(programId: PublicKey, underlyingMint: PublicKey) {
  const [vault] = PublicKey.findProgramAddressSync(
    [VAULT_SEED, underlyingMint.toBuffer()],
    programId
  );
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [AUTHORITY_SEED, vault.toBuffer()],
    programId
  );
  const [shareMint] = PublicKey.findProgramAddressSync(
    [SHARE_MINT_SEED, vault.toBuffer()],
    programId
  );
  return { vault, vaultAuthority, shareMint };
}

export function userPda(programId: PublicKey, vault: PublicKey, owner: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [USER_SEED, vault.toBuffer(), owner.toBuffer()],
    programId
  )[0];
}

export async function airdrop(
  connection: anchor.web3.Connection,
  to: PublicKey,
  sol = 10
) {
  const sig = await connection.requestAirdrop(to, sol * anchor.web3.LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}
