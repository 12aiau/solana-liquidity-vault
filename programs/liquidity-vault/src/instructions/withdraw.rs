use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

use crate::{
    constants::*,
    error::VaultError,
    math::shares_to_assets,
    state::{UserPosition, Vault},
};

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub user: Signer<'info>,

    #[account(
        has_one = underlying_mint,
        has_one = share_mint,
        has_one = vault_token_account,
    )]
    pub vault: Account<'info, Vault>,

    /// CHECK: PDA signer of the vault, verified by seeds.
    #[account(seeds = [AUTHORITY_SEED, vault.key().as_ref()], bump = vault.authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [USER_SEED, vault.key().as_ref(), user.key().as_ref()],
        bump = user_position.bump,
        constraint = user_position.owner == user.key() @ VaultError::Unauthorized,
    )]
    pub user_position: Account<'info, UserPosition>,

    pub underlying_mint: Account<'info, Mint>,

    #[account(mut)]
    pub share_mint: Account<'info, Mint>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = underlying_mint,
        token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = share_mint,
        token::authority = user,
    )]
    pub user_share_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Withdraw>, shares: u64, min_amount_out: u64) -> Result<()> {
    let vault = &ctx.accounts.vault;
    require!(shares > 0, VaultError::ZeroAmount);
    require!(
        ctx.accounts.user_share_account.amount >= shares,
        VaultError::InsufficientShares
    );

    let idle = ctx.accounts.vault_token_account.amount;
    let amount = shares_to_assets(shares, vault.total_assets(idle), ctx.accounts.share_mint.supply)?;
    require!(amount > 0, VaultError::ZeroAmount);
    require!(amount >= min_amount_out, VaultError::SlippageExceeded);
    // Only idle tokens can leave; liquidity deployed to Raydium must be pulled back first.
    require!(amount <= idle, VaultError::InsufficientLiquidity);

    // 1. burn the user's shares: the user owns them and signs.
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.share_mint.to_account_info(),
                from: ctx.accounts.user_share_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        shares,
    )?;

    // 2. vault -> user via CPI into the Token program, signed by the vault PDA.
    let vault_key = vault.key();
    let bump = [vault.authority_bump];
    let seeds = Vault::authority_seeds(&vault_key, &bump);
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            &[&seeds],
        ),
        amount,
    )?;

    let position = &mut ctx.accounts.user_position;
    position.total_withdrawn = position.total_withdrawn.saturating_add(amount);

    emit!(WithdrawEvent {
        vault: vault_key,
        user: ctx.accounts.user.key(),
        shares,
        amount,
    });
    Ok(())
}

#[event]
pub struct WithdrawEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub shares: u64,
    pub amount: u64,
}
