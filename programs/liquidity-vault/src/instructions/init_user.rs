use anchor_lang::prelude::*;

use crate::{
    constants::*,
    state::{UserPosition, Vault},
};

#[derive(Accounts)]
pub struct InitUser<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    pub vault: Account<'info, Vault>,

    #[account(
        init,
        payer = owner,
        space = 8 + UserPosition::INIT_SPACE,
        seeds = [USER_SEED, vault.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub user_position: Account<'info, UserPosition>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitUser>) -> Result<()> {
    ctx.accounts.user_position.set_inner(UserPosition {
        owner: ctx.accounts.owner.key(),
        vault: ctx.accounts.vault.key(),
        bump: ctx.bumps.user_position,
    });
    Ok(())
}
