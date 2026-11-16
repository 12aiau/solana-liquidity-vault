use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, MintTo, Token, TokenAccount, Transfer},
};

use crate::{
    constants::*,
    error::VaultError,
    math::assets_to_shares,
    state::{UserPosition, Vault},
};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
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
        init_if_needed,
        payer = user,
        associated_token::mint = share_mint,
        associated_token::authority = user,
    )]
    pub user_share_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Deposit>, amount: u64, min_shares_out: u64) -> Result<()> {
    let vault = &ctx.accounts.vault;
    require!(!vault.paused, VaultError::Paused);
    require!(amount > 0, VaultError::ZeroAmount);

    let total_assets = vault.total_assets(ctx.accounts.vault_token_account.amount);
    if vault.deposit_cap > 0 {
        let after = total_assets.checked_add(amount).ok_or(VaultError::MathOverflow)?;
        require!(after <= vault.deposit_cap, VaultError::DepositCapExceeded);
    }

    // Price is taken before the transfer so the deposit does not dilute itself.
    let shares = assets_to_shares(amount, total_assets, ctx.accounts.share_mint.supply)?;
    require!(shares > 0, VaultError::ZeroAmount);
    require!(shares >= min_shares_out, VaultError::SlippageExceeded);

    // 1. user -> vault: the user signs, no PDA needed.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.vault_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

    // 2. mint shares: the share mint authority is the vault PDA.
    let vault_key = vault.key();
    let bump = [vault.authority_bump];
    let seeds = Vault::authority_seeds(&vault_key, &bump);
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.share_mint.to_account_info(),
                to: ctx.accounts.user_share_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            &[&seeds],
        ),
        shares,
    )?;

    let position = &mut ctx.accounts.user_position;
    position.total_deposited = position.total_deposited.saturating_add(amount);

    emit!(DepositEvent {
        vault: vault_key,
        user: ctx.accounts.user.key(),
        amount,
        shares,
    });
    Ok(())
}

#[event]
pub struct DepositEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub shares: u64,
}
