use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::{constants::*, state::Vault};

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    pub underlying_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = admin,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED, underlying_mint.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,

    /// CHECK: data-less PDA that owns the vault's tokens and signs CPIs.
    #[account(seeds = [AUTHORITY_SEED, vault.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = admin,
        seeds = [SHARE_MINT_SEED, vault.key().as_ref()],
        bump,
        mint::decimals = underlying_mint.decimals,
        mint::authority = vault_authority,
    )]
    pub share_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = admin,
        associated_token::mint = underlying_mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeVault>, deposit_cap: u64) -> Result<()> {
    ctx.accounts.vault.set_inner(Vault {
        admin: ctx.accounts.admin.key(),
        underlying_mint: ctx.accounts.underlying_mint.key(),
        share_mint: ctx.accounts.share_mint.key(),
        vault_token_account: ctx.accounts.vault_token_account.key(),
        deposit_cap,
        paused: false,
        bump: ctx.bumps.vault,
        authority_bump: ctx.bumps.vault_authority,
        share_mint_bump: ctx.bumps.share_mint,
    });
    msg!(
        "vault {} for mint {} initialized",
        ctx.accounts.vault.key(),
        ctx.accounts.underlying_mint.key()
    );
    Ok(())
}
