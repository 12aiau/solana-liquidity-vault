use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::{
    constants::*,
    error::VaultError,
    raydium::{self, r, rs, w},
    state::Vault,
};

/// Swap vault tokens through a Raydium CLMM pool (`swap_v2`, exact input).
#[derive(Accounts)]
pub struct Swap<'info> {
    pub admin: Signer<'info>,

    #[account(mut, has_one = admin @ VaultError::Unauthorized, has_one = vault_token_account)]
    pub vault: Box<Account<'info, Vault>>,

    /// CHECK: PDA signer of the vault, verified by seeds; acts as the Raydium `payer`.
    #[account(seeds = [AUTHORITY_SEED, vault.key().as_ref()], bump = vault.authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,

    /// Vault's underlying token account; reloaded after the swap for accounting.
    /// It is also passed again as the input or output account below.
    #[account(mut)]
    pub vault_token_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: address checked against `raydium::CLMM_PROGRAM_ID`.
    pub clmm_program: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium (must equal pool_state.amm_config).
    pub amm_config: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium.
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: must be owned by the vault PDA (checked in handler).
    #[account(mut)]
    pub input_token_account: UncheckedAccount<'info>,
    /// CHECK: must be owned by the vault PDA (checked in handler).
    #[account(mut)]
    pub output_token_account: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium.
    #[account(mut)]
    pub input_vault: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium.
    #[account(mut)]
    pub output_vault: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium (pool_state.observation_key).
    #[account(mut)]
    pub observation_state: UncheckedAccount<'info>,
    /// CHECK: SPL Token program.
    pub token_program: UncheckedAccount<'info>,
    /// CHECK: Token-2022 program.
    pub token_program_2022: UncheckedAccount<'info>,
    /// CHECK: Memo program.
    pub memo_program: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium.
    pub input_vault_mint: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium.
    pub output_vault_mint: UncheckedAccount<'info>,
    // remaining accounts: [tickarray_bitmap_extension], tick arrays in swap direction
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, Swap<'info>>,
    amount_in: u64,
    min_amount_out: u64,
    sqrt_price_limit_x64: u128,
) -> Result<()> {
    require!(amount_in > 0, VaultError::ZeroAmount);
    let authority = ctx.accounts.vault_authority.key();
    let (_, out_before) = raydium::vault_token_balance(&ctx.accounts.output_token_account, &authority)?;
    raydium::vault_token_balance(&ctx.accounts.input_token_account, &authority)?;
    let underlying_before = ctx.accounts.vault_token_account.amount;

    let vault_key = ctx.accounts.vault.key();
    let bump = [ctx.accounts.vault.authority_bump];
    let seeds = Vault::authority_seeds(&vault_key, &bump);
    let a = &ctx.accounts;
    raydium::invoke_clmm(
        &a.clmm_program,
        "swap_v2",
        // amount, other_amount_threshold (= min out -> slippage guard), sqrt_price_limit_x64, is_base_input
        &(amount_in, min_amount_out, sqrt_price_limit_x64, true),
        &[
            rs(&a.vault_authority),
            r(&a.amm_config),
            w(&a.pool_state),
            w(&a.input_token_account),
            w(&a.output_token_account),
            w(&a.input_vault),
            w(&a.output_vault),
            w(&a.observation_state),
            r(&a.token_program),
            r(&a.token_program_2022),
            r(&a.memo_program),
            r(&a.input_vault_mint),
            r(&a.output_vault_mint),
        ],
        ctx.remaining_accounts,
        &[&seeds],
    )?;

    // Raydium already enforced other_amount_threshold; double-check on our side.
    let (_, out_after) = raydium::vault_token_balance(&ctx.accounts.output_token_account, &authority)?;
    let received = out_after.saturating_sub(out_before);
    require!(received >= min_amount_out, VaultError::SlippageExceeded);

    ctx.accounts.vault_token_account.reload()?;
    let underlying_after = ctx.accounts.vault_token_account.amount;
    ctx.accounts.vault.sync_deployed(underlying_before, underlying_after);

    emit!(SwapEvent {
        vault: vault_key,
        amount_in,
        amount_out: received,
    });
    Ok(())
}

#[event]
pub struct SwapEvent {
    pub vault: Pubkey,
    pub amount_in: u64,
    pub amount_out: u64,
}
