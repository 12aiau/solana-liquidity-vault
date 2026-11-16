use anchor_lang::prelude::*;

use crate::{error::VaultError, state::Vault};

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,

    #[account(mut, has_one = admin @ VaultError::Unauthorized)]
    pub vault: Account<'info, Vault>,
}

pub fn handler(ctx: Context<UpdateConfig>, deposit_cap: Option<u64>, paused: Option<bool>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    if let Some(cap) = deposit_cap {
        vault.deposit_cap = cap;
    }
    if let Some(paused) = paused {
        vault.paused = paused;
    }
    Ok(())
}
