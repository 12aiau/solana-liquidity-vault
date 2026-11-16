import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import {
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";
import { LiquidityVault } from "../target/types/liquidity_vault";
import { airdrop, userPda, vaultPdas } from "./helpers";

describe("liquidity-vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.liquidityVault as Program<LiquidityVault>;
  const connection = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;
  const alice = Keypair.generate();

  const DECIMALS = 6;
  let mint: anchor.web3.PublicKey;
  let pdas: ReturnType<typeof vaultPdas>;
  let vaultTokenAccount: anchor.web3.PublicKey;

  before(async () => {
    await airdrop(connection, alice.publicKey);
    mint = await createMint(connection, admin, admin.publicKey, null, DECIMALS);
    pdas = vaultPdas(program.programId, mint);
    vaultTokenAccount = getAssociatedTokenAddressSync(mint, pdas.vaultAuthority, true);
  });

  describe("vault skeleton", () => {
    it("initializes vault config, share mint and vault token account", async () => {
      await program.methods
        .initializeVault(new anchor.BN(0))
        .accounts({ admin: admin.publicKey, underlyingMint: mint })
        .rpc();

      const vault = await program.account.vault.fetch(pdas.vault);
      expect(vault.admin.toBase58()).to.eq(admin.publicKey.toBase58());
      expect(vault.underlyingMint.toBase58()).to.eq(mint.toBase58());
      expect(vault.shareMint.toBase58()).to.eq(pdas.shareMint.toBase58());
      expect(vault.vaultTokenAccount.toBase58()).to.eq(vaultTokenAccount.toBase58());
      expect(vault.paused).to.eq(false);

      const shareMint = await getMint(connection, pdas.shareMint);
      expect(shareMint.decimals).to.eq(DECIMALS);
      expect(shareMint.mintAuthority!.toBase58()).to.eq(pdas.vaultAuthority.toBase58());
      expect(shareMint.supply).to.eq(0n);

      const vta = await getAccount(connection, vaultTokenAccount);
      expect(vta.owner.toBase58()).to.eq(pdas.vaultAuthority.toBase58());
    });

    it("creates the user PDA", async () => {
      await program.methods
        .initUser()
        .accounts({ owner: alice.publicKey, vault: pdas.vault })
        .signers([alice])
        .rpc();
      const pos = await program.account.userPosition.fetch(
        userPda(program.programId, pdas.vault, alice.publicKey)
      );
      expect(pos.owner.toBase58()).to.eq(alice.publicKey.toBase58());
      expect(pos.vault.toBase58()).to.eq(pdas.vault.toBase58());
    });

    it("rejects config updates from a non-admin", async () => {
      try {
        await program.methods
          .updateConfig(null, true)
          .accounts({ admin: alice.publicKey, vault: pdas.vault })
          .signers([alice])
          .rpc();
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e.error?.errorCode?.code).to.eq("Unauthorized");
      }
    });
  });

  const ONE = 1_000_000;
  const bob = Keypair.generate();
  let aliceTokens: anchor.web3.PublicKey;
  let bobTokens: anchor.web3.PublicKey;

  const tokenBalance = async (account: anchor.web3.PublicKey) =>
    Number((await getAccount(connection, account)).amount);
  const shareBalance = (owner: anchor.web3.PublicKey) =>
    tokenBalance(getAssociatedTokenAddressSync(pdas.shareMint, owner));

  const expectError = async (p: Promise<unknown>, code: string) => {
    try {
      await p;
      expect.fail("should have thrown");
    } catch (e: any) {
      expect(e.error?.errorCode?.code).to.eq(code);
    }
  };

  const deposit = (user: Keypair, from: anchor.web3.PublicKey, amount: number, minShares = 0) =>
    program.methods
      .deposit(new anchor.BN(amount), new anchor.BN(minShares))
      .accounts({ user: user.publicKey, vault: pdas.vault, userTokenAccount: from })
      .signers([user])
      .rpc();

  const updateConfig = (cap: number | null, paused: boolean | null) =>
    program.methods
      .updateConfig(cap === null ? null : new anchor.BN(cap), paused)
      .accounts({ admin: admin.publicKey, vault: pdas.vault })
      .rpc();

  describe("deposit", () => {
    before(async () => {
      await airdrop(connection, bob.publicKey);
      aliceTokens = (
        await getOrCreateAssociatedTokenAccount(connection, admin, mint, alice.publicKey)
      ).address;
      bobTokens = (await getOrCreateAssociatedTokenAccount(connection, admin, mint, bob.publicKey))
        .address;
      await mintTo(connection, admin, mint, aliceTokens, admin, 1_000 * ONE);
      await mintTo(connection, admin, mint, bobTokens, admin, 1_000 * ONE);
      await program.methods
        .initUser()
        .accounts({ owner: bob.publicKey, vault: pdas.vault })
        .signers([bob])
        .rpc();
    });

    it("first deposit mints shares 1:1", async () => {
      await deposit(alice, aliceTokens, 100 * ONE);
      expect(await shareBalance(alice.publicKey)).to.eq(100 * ONE);
      expect(await tokenBalance(vaultTokenAccount)).to.eq(100 * ONE);
      const pos = await program.account.userPosition.fetch(
        userPda(program.programId, pdas.vault, alice.publicKey)
      );
      expect(pos.totalDeposited.toNumber()).to.eq(100 * ONE);
    });

    it("mints proportionally fewer shares after the vault earns yield", async () => {
      // simulate yield: +100 tokens land in the vault -> 1 share ~ 2 tokens
      await mintTo(connection, admin, mint, vaultTokenAccount, admin, 100 * ONE);
      await deposit(bob, bobTokens, 50 * ONE);
      expect(await shareBalance(bob.publicKey)).to.be.closeTo(25 * ONE, 1);
    });

    it("enforces min_shares_out (slippage)", async () => {
      await expectError(deposit(bob, bobTokens, 10 * ONE, 10 * ONE), "SlippageExceeded");
    });

    it("rejects zero deposits", async () => {
      await expectError(deposit(bob, bobTokens, 0), "ZeroAmount");
    });

    it("respects the deposit cap and the pause flag", async () => {
      await updateConfig(260 * ONE, null);
      await expectError(deposit(bob, bobTokens, 20 * ONE), "DepositCapExceeded");
      await updateConfig(0, true);
      await expectError(deposit(bob, bobTokens, ONE), "Paused");
      await updateConfig(null, false);
    });
  });
});
