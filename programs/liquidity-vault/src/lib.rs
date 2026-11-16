use anchor_lang::prelude::*;

declare_id!("DQiYDQPgUy7S8PP6UTyB957vL3tB234c2r7Eatddfgnu");

#[program]
pub mod liquidity_vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
