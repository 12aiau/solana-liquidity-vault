use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;

declare_id!("DQiYDQPgUy7S8PP6UTyB957vL3tB234c2r7Eatddfgnu");

#[program]
pub mod liquidity_vault {
    use super::*;

    /// Creates the vault settings account, the share mint and the vault token account.
    pub fn initialize_vault(ctx: Context<InitializeVault>, deposit_cap: u64) -> Result<()> {
        initialize_vault::handler(ctx, deposit_cap)
    }

    /// Creates the user's PDA inside the vault.
    pub fn init_user(ctx: Context<InitUser>) -> Result<()> {
        init_user::handler(ctx)
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        deposit_cap: Option<u64>,
        paused: Option<bool>,
    ) -> Result<()> {
        update_config::handler(ctx, deposit_cap, paused)
    }

    /// Deposits underlying tokens and mints share tokens to the user.
    pub fn deposit(ctx: Context<Deposit>, amount: u64, min_shares_out: u64) -> Result<()> {
        deposit::handler(ctx, amount, min_shares_out)
    }

    /// Burns share tokens and returns underlying tokens via a PDA-signed Token CPI.
    pub fn withdraw(ctx: Context<Withdraw>, shares: u64, min_amount_out: u64) -> Result<()> {
        withdraw::handler(ctx, shares, min_amount_out)
    }
}
