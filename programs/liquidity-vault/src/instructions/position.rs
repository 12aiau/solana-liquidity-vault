use anchor_lang::{prelude::*, system_program};
use anchor_spl::token::TokenAccount;

use crate::{
    constants::*,
    error::VaultError,
    raydium::{self, r, rs, w, ws},
    state::{StrategyPosition, Vault},
};

/// Accounts shared by every position instruction.
#[derive(Accounts)]
pub struct PositionBase<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(mut, has_one = admin @ VaultError::Unauthorized, has_one = vault_token_account)]
    pub vault: Box<Account<'info, Vault>>,

    /// CHECK: data-less PDA: owns the position NFT and vault tokens, pays Raydium rent.
    #[account(mut, seeds = [AUTHORITY_SEED, vault.key().as_ref()], bump = vault.authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub vault_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + StrategyPosition::INIT_SPACE,
        seeds = [POSITION_SEED, vault.key().as_ref()],
        bump,
    )]
    pub strategy_position: Box<Account<'info, StrategyPosition>>,

    /// CHECK: address checked against `raydium::CLMM_PROGRAM_ID`.
    pub clmm_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    pub base: PositionBase<'info>,

    /// CHECK: fresh keypair, signs the transaction; becomes the position NFT mint.
    #[account(mut, signer)]
    pub position_nft_mint: UncheckedAccount<'info>,
    /// CHECK: ATA(vault_authority, position_nft_mint), created by Raydium.
    #[account(mut)]
    pub position_nft_account: UncheckedAccount<'info>,
    /// CHECK: Metaplex metadata PDA (unused when with_metadata = false).
    #[account(mut)]
    pub metadata_account: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium.
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium.
    #[account(mut)]
    pub protocol_position: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium (seeds).
    #[account(mut)]
    pub tick_array_lower: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium (seeds).
    #[account(mut)]
    pub tick_array_upper: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium (seeds).
    #[account(mut)]
    pub personal_position: UncheckedAccount<'info>,
    /// CHECK: vault-owned token account for mint 0 (checked in handler).
    #[account(mut)]
    pub token_account_0: UncheckedAccount<'info>,
    /// CHECK: vault-owned token account for mint 1 (checked in handler).
    #[account(mut)]
    pub token_account_1: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium.
    #[account(mut)]
    pub token_vault_0: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium.
    #[account(mut)]
    pub token_vault_1: UncheckedAccount<'info>,
    /// CHECK: rent sysvar.
    pub rent: UncheckedAccount<'info>,
    /// CHECK: SPL Token program.
    pub token_program: UncheckedAccount<'info>,
    /// CHECK: Associated Token program.
    pub associated_token_program: UncheckedAccount<'info>,
    /// CHECK: Metaplex Token Metadata program.
    pub metadata_program: UncheckedAccount<'info>,
    /// CHECK: Token-2022 program.
    pub token_program_2022: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium.
    pub vault_0_mint: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium.
    pub vault_1_mint: UncheckedAccount<'info>,
    // remaining accounts: [tickarray_bitmap_extension]
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct OpenPositionArgs {
    pub tick_lower_index: i32,
    pub tick_upper_index: i32,
    pub tick_array_lower_start_index: i32,
    pub tick_array_upper_start_index: i32,
    pub liquidity: u128,
    pub amount_0_max: u64,
    pub amount_1_max: u64,
    /// SOL moved from admin to the vault PDA to pay Raydium rent (NFT, tick arrays...).
    pub rent_lamports: u64,
}

pub fn open_handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, OpenPosition<'info>>,
    args: OpenPositionArgs,
) -> Result<()> {
    require!(!ctx.accounts.base.strategy_position.active, VaultError::PositionAlreadyOpen);
    require!(args.tick_lower_index < args.tick_upper_index, VaultError::InvalidRange);
    let a = &ctx.accounts;
    let authority = a.base.vault_authority.key();
    raydium::vault_token_balance(&a.token_account_0, &authority)?;
    raydium::vault_token_balance(&a.token_account_1, &authority)?;

    if args.rent_lamports > 0 {
        system_program::transfer(
            CpiContext::new(
                a.base.system_program.to_account_info(),
                system_program::Transfer {
                    from: a.base.admin.to_account_info(),
                    to: a.base.vault_authority.to_account_info(),
                },
            ),
            args.rent_lamports,
        )?;
    }

    let idle_before = a.base.vault_token_account.amount;
    let vault_key = a.base.vault.key();
    let bump = [a.base.vault.authority_bump];
    let seeds = Vault::authority_seeds(&vault_key, &bump);
    let system = a.base.system_program.to_account_info();

    raydium::invoke_clmm(
        &a.base.clmm_program,
        "open_position_v2",
        &(
            args.tick_lower_index,
            args.tick_upper_index,
            args.tick_array_lower_start_index,
            args.tick_array_upper_start_index,
            args.liquidity,
            args.amount_0_max,
            args.amount_1_max,
            false,          // with_metadata
            None::<bool>,   // base_flag: liquidity is given explicitly
        ),
        &[
            ws(&a.base.vault_authority), // payer
            r(&a.base.vault_authority),  // position_nft_owner
            ws(&a.position_nft_mint),
            w(&a.position_nft_account),
            w(&a.metadata_account),
            w(&a.pool_state),
            w(&a.protocol_position),
            w(&a.tick_array_lower),
            w(&a.tick_array_upper),
            w(&a.personal_position),
            w(&a.token_account_0),
            w(&a.token_account_1),
            w(&a.token_vault_0),
            w(&a.token_vault_1),
            r(&a.rent),
            r(&system),
            r(&a.token_program),
            r(&a.associated_token_program),
            r(&a.metadata_program),
            r(&a.token_program_2022),
            r(&a.vault_0_mint),
            r(&a.vault_1_mint),
        ],
        ctx.remaining_accounts,
        &[&seeds],
    )?;

    let base = &mut ctx.accounts.base;
    base.vault_token_account.reload()?;
    base.vault.sync_deployed(idle_before, base.vault_token_account.amount);
    base.strategy_position.set_inner(StrategyPosition {
        vault: vault_key,
        pool: ctx.accounts.pool_state.key(),
        nft_mint: ctx.accounts.position_nft_mint.key(),
        tick_lower: args.tick_lower_index,
        tick_upper: args.tick_upper_index,
        active: true,
        bump: ctx.bumps.base.strategy_position,
    });
    emit!(PositionOpened {
        vault: vault_key,
        nft_mint: ctx.accounts.position_nft_mint.key(),
        tick_lower: args.tick_lower_index,
        tick_upper: args.tick_upper_index,
        liquidity: args.liquidity,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct DecreaseLiquidity<'info> {
    pub base: PositionBase<'info>,

    /// CHECK: vault PDA's position NFT account; validated by Raydium.
    pub nft_account: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium; must belong to the active position (handler).
    #[account(mut)]
    pub personal_position: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium.
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium.
    #[account(mut)]
    pub protocol_position: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium.
    #[account(mut)]
    pub token_vault_0: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium.
    #[account(mut)]
    pub token_vault_1: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium.
    #[account(mut)]
    pub tick_array_lower: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium.
    #[account(mut)]
    pub tick_array_upper: UncheckedAccount<'info>,
    /// CHECK: vault-owned (checked in handler).
    #[account(mut)]
    pub recipient_token_account_0: UncheckedAccount<'info>,
    /// CHECK: vault-owned (checked in handler).
    #[account(mut)]
    pub recipient_token_account_1: UncheckedAccount<'info>,
    /// CHECK: SPL Token program.
    pub token_program: UncheckedAccount<'info>,
    /// CHECK: Token-2022 program.
    pub token_program_2022: UncheckedAccount<'info>,
    /// CHECK: Memo program.
    pub memo_program: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium.
    pub vault_0_mint: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium.
    pub vault_1_mint: UncheckedAccount<'info>,
    // remaining accounts: [tickarray_bitmap_extension], reward accounts
}

/// `liquidity = 0` only collects accumulated trading fees.
pub fn decrease_handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, DecreaseLiquidity<'info>>,
    liquidity: u128,
    amount_0_min: u64,
    amount_1_min: u64,
) -> Result<()> {
    let a = &ctx.accounts;
    require!(a.base.strategy_position.active, VaultError::NoActivePosition);
    let authority = a.base.vault_authority.key();
    raydium::vault_token_balance(&a.recipient_token_account_0, &authority)?;
    raydium::vault_token_balance(&a.recipient_token_account_1, &authority)?;

    let idle_before = a.base.vault_token_account.amount;
    let vault_key = a.base.vault.key();
    let bump = [a.base.vault.authority_bump];
    let seeds = Vault::authority_seeds(&vault_key, &bump);

    raydium::invoke_clmm(
        &a.base.clmm_program,
        "decrease_liquidity_v2",
        &(liquidity, amount_0_min, amount_1_min),
        &[
            rs(&a.base.vault_authority), // nft_owner
            r(&a.nft_account),
            w(&a.personal_position),
            w(&a.pool_state),
            w(&a.protocol_position),
            w(&a.token_vault_0),
            w(&a.token_vault_1),
            w(&a.tick_array_lower),
            w(&a.tick_array_upper),
            w(&a.recipient_token_account_0),
            w(&a.recipient_token_account_1),
            r(&a.token_program),
            r(&a.token_program_2022),
            r(&a.memo_program),
            r(&a.vault_0_mint),
            r(&a.vault_1_mint),
        ],
        ctx.remaining_accounts,
        &[&seeds],
    )?;

    let base = &mut ctx.accounts.base;
    base.vault_token_account.reload()?;
    base.vault.sync_deployed(idle_before, base.vault_token_account.amount);
    emit!(LiquidityDecreased { vault: vault_key, liquidity });
    Ok(())
}

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    pub base: PositionBase<'info>,

    /// CHECK: must match the active position (handler); validated by Raydium.
    #[account(mut)]
    pub position_nft_mint: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium.
    #[account(mut)]
    pub position_nft_account: UncheckedAccount<'info>,
    /// CHECK: validated by Raydium.
    #[account(mut)]
    pub personal_position: UncheckedAccount<'info>,
    /// CHECK: SPL Token program.
    pub token_program: UncheckedAccount<'info>,
    // remaining accounts: [pool_state] (needed when the NFT account is frozen)
}

/// Burns the (empty) position NFT; rent goes back to the vault PDA.
pub fn close_handler<'info>(ctx: Context<'_, '_, 'info, 'info, ClosePosition<'info>>) -> Result<()> {
    let a = &ctx.accounts;
    require!(a.base.strategy_position.active, VaultError::NoActivePosition);
    require_keys_eq!(
        a.position_nft_mint.key(),
        a.base.strategy_position.nft_mint,
        VaultError::NoActivePosition
    );
    let vault_key = a.base.vault.key();
    let bump = [a.base.vault.authority_bump];
    let seeds = Vault::authority_seeds(&vault_key, &bump);
    let system = a.base.system_program.to_account_info();

    raydium::invoke_clmm(
        &a.base.clmm_program,
        "close_position",
        &(),
        &[
            ws(&a.base.vault_authority), // nft_owner
            w(&a.position_nft_mint),
            w(&a.position_nft_account),
            w(&a.personal_position),
            r(&system),
            r(&a.token_program),
        ],
        ctx.remaining_accounts,
        &[&seeds],
    )?;

    ctx.accounts.base.strategy_position.active = false;
    emit!(PositionClosed {
        vault: vault_key,
        nft_mint: ctx.accounts.position_nft_mint.key(),
    });
    Ok(())
}

#[event]
pub struct PositionOpened {
    pub vault: Pubkey,
    pub nft_mint: Pubkey,
    pub tick_lower: i32,
    pub tick_upper: i32,
    pub liquidity: u128,
}

#[event]
pub struct LiquidityDecreased {
    pub vault: Pubkey,
    pub liquidity: u128,
}

#[event]
pub struct PositionClosed {
    pub vault: Pubkey,
    pub nft_mint: Pubkey,
}
