import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, PublicKey, Transaction, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";
import { MINT_A, MINT_B } from "../config";
import idl from "../idl/liquidity_vault.json";

export type WalletLike = {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
};

const READ_ONLY: WalletLike = {
  publicKey: PublicKey.default,
  signTransaction: async () => {
    throw new Error("Кошелёк не подключён");
  },
  signAllTransactions: async () => {
    throw new Error("Кошелёк не подключён");
  },
};

export function getProgram(connection: Connection, wallet?: WalletLike | null): Program {
  const provider = new AnchorProvider(connection, (wallet ?? READ_ONLY) as any, { commitment: "confirmed" });
  return new Program(idl as Idl, provider);
}

const seed = (s: string) => new TextEncoder().encode(s);
const pda = (programId: PublicKey, ...seeds: Uint8Array[]) =>
  PublicKey.findProgramAddressSync(seeds, programId)[0];

export function vaultPdas(programId: PublicKey) {
  const vault = pda(programId, seed("vault"), MINT_A.toBytes());
  const authority = pda(programId, seed("authority"), vault.toBytes());
  const shareMint = pda(programId, seed("share"), vault.toBytes());
  const strategyPosition = pda(programId, seed("position"), vault.toBytes());
  return {
    vault,
    authority,
    shareMint,
    strategyPosition,
    ataA: getAssociatedTokenAddressSync(MINT_A, authority, true),
    ataB: getAssociatedTokenAddressSync(MINT_B, authority, true),
  };
}

export const userPda = (programId: PublicKey, vault: PublicKey, owner: PublicKey) =>
  pda(programId, seed("user"), vault.toBytes(), owner.toBytes());

const ZERO = new BN(0);

export async function tokenAmount(connection: Connection, account: PublicKey): Promise<BN> {
  try {
    return new BN((await connection.getTokenAccountBalance(account)).value.amount);
  } catch {
    return ZERO; // account does not exist yet
  }
}

// Same formulas as programs/liquidity-vault/src/math.rs
export const assetsToShares = (assets: BN, totalAssets: BN, totalShares: BN) =>
  assets.mul(totalShares.addn(1)).div(totalAssets.addn(1));
export const sharesToAssets = (shares: BN, totalAssets: BN, totalShares: BN) =>
  shares.mul(totalAssets.addn(1)).div(totalShares.addn(1));

export type VaultState = {
  admin: PublicKey;
  paused: boolean;
  depositCap: BN;
  /** tokens sitting in the vault account, available for withdrawals */
  idle: BN;
  /** book value of tokens deployed to Raydium */
  deployed: BN;
  totalAssets: BN;
  shareSupply: BN;
  /** vault balance of the second pool token */
  idleB: BN;
  position: { active: boolean; nftMint: PublicKey; tickLower: number; tickUpper: number } | null;
  user: { tokens: BN; shares: BN; sharesValue: BN } | null;
};

export async function fetchVaultState(program: Program, owner?: PublicKey | null): Promise<VaultState | null> {
  const connection = program.provider.connection;
  const p = vaultPdas(program.programId);
  const accounts = program.account as any;
  const vault = await accounts.vault.fetchNullable(p.vault);
  if (!vault) return null;

  const [idle, idleB, supply, position, userTokens, userShares] = await Promise.all([
    tokenAmount(connection, p.ataA),
    tokenAmount(connection, p.ataB),
    connection.getTokenSupply(p.shareMint).then((r) => new BN(r.value.amount)),
    accounts.strategyPosition.fetchNullable(p.strategyPosition),
    owner ? tokenAmount(connection, getAssociatedTokenAddressSync(MINT_A, owner)) : ZERO,
    owner ? tokenAmount(connection, getAssociatedTokenAddressSync(p.shareMint, owner)) : ZERO,
  ]);
  const deployed: BN = vault.deployedAssets;
  const totalAssets = idle.add(deployed);
  return {
    admin: vault.admin,
    paused: vault.paused,
    depositCap: vault.depositCap,
    idle,
    deployed,
    totalAssets,
    shareSupply: supply,
    idleB,
    position: position
      ? {
          active: position.active,
          nftMint: position.nftMint,
          tickLower: position.tickLower,
          tickUpper: position.tickUpper,
        }
      : null,
    user: owner
      ? { tokens: userTokens, shares: userShares, sharesValue: sharesToAssets(userShares, totalAssets, supply) }
      : null,
  };
}

/** Deposit `amount` of the underlying token; creates the user's PDA on first use. */
export async function buildDeposit(program: Program, owner: PublicKey, amount: BN, minSharesOut: BN) {
  const p = vaultPdas(program.programId);
  const pre: TransactionInstruction[] = [];
  const user = userPda(program.programId, p.vault, owner);
  if (!(await program.provider.connection.getAccountInfo(user))) {
    pre.push(await program.methods.initUser().accounts({ owner, vault: p.vault }).instruction());
  }
  return program.methods
    .deposit(amount, minSharesOut)
    .accounts({ user: owner, vault: p.vault, userTokenAccount: getAssociatedTokenAddressSync(MINT_A, owner) })
    .preInstructions(pre);
}

/** Burn `shares` and receive underlying tokens back. */
export async function buildWithdraw(program: Program, owner: PublicKey, shares: BN, minAmountOut: BN) {
  const p = vaultPdas(program.programId);
  const userTokenAccount = getAssociatedTokenAddressSync(MINT_A, owner);
  return program.methods
    .withdraw(shares, minAmountOut)
    .accounts({
      user: owner,
      vault: p.vault,
      userTokenAccount,
      userShareAccount: getAssociatedTokenAddressSync(p.shareMint, owner),
    })
    .preInstructions([createAssociatedTokenAccountIdempotentInstruction(owner, userTokenAccount, owner, MINT_A)]);
}

/** Turns Anchor / wallet errors into a short readable message. */
export function errorMessage(e: any): string {
  const code = e?.error?.errorCode?.code;
  const known: Record<string, string> = {
    Paused: "Vault на паузе",
    ZeroAmount: "Сумма должна быть больше нуля",
    DepositCapExceeded: "Превышен лимит депозитов vault",
    SlippageExceeded: "Цена изменилась сильнее допустимого (slippage)",
    InsufficientShares: "Недостаточно share-токенов",
    InsufficientLiquidity: "В vault сейчас мало свободных токенов: часть средств размещена в пуле",
    Unauthorized: "Это действие доступно только администратору vault",
    PositionAlreadyOpen: "У vault уже есть открытая позиция",
    NoActivePosition: "У vault нет открытой позиции",
  };
  if (code && known[code]) return known[code];
  const logs: string[] = e?.logs ?? e?.transactionLogs ?? [];
  const logErr = logs.find((l) => /Error Message|Error: /.test(l));
  if (logErr) return logErr.replace(/^Program log: /, "");
  if (/User rejected|rejected the request/i.test(e?.message ?? "")) return "Транзакция отклонена в кошельке";
  return e?.error?.errorMessage ?? e?.message ?? String(e);
}
