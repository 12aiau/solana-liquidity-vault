use anchor_lang::prelude::*;

use crate::constants::*;

/// Vault settings. One vault per underlying mint: PDA ["vault", underlying_mint].
#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub admin: Pubkey,
    pub underlying_mint: Pubkey,
    /// Share token, PDA ["share", vault]; mint authority is `vault_authority`.
    pub share_mint: Pubkey,
    /// ATA of `vault_authority` holding idle underlying tokens.
    pub vault_token_account: Pubkey,
    /// Max total assets the vault accepts (0 = no limit).
    pub deposit_cap: u64,
    /// Book value (in underlying) of tokens moved out of the vault account into strategies.
    pub deployed_assets: u64,
    pub paused: bool,
    pub bump: u8,
    pub authority_bump: u8,
    pub share_mint_bump: u8,
}

impl Vault {
    /// Seeds of the `vault_authority` PDA: the signer for every vault-owned token account.
    pub fn authority_seeds<'a>(vault: &'a Pubkey, bump: &'a [u8; 1]) -> [&'a [u8]; 3] {
        [AUTHORITY_SEED, vault.as_ref(), bump]
    }

    /// Idle tokens in the vault account plus the book value deployed into strategies.
    pub fn total_assets(&self, idle: u64) -> u64 {
        idle.saturating_add(self.deployed_assets)
    }

    /// Updates the book value of deployed assets from the change of the idle balance
    /// around a strategy action (swap / add / remove liquidity). Tokens that come back
    /// above book value stay idle and raise the share price (realized profit).
    pub fn sync_deployed(&mut self, idle_before: u64, idle_after: u64) {
        if idle_after < idle_before {
            self.deployed_assets = self.deployed_assets.saturating_add(idle_before - idle_after);
        } else {
            self.deployed_assets = self.deployed_assets.saturating_sub(idle_after - idle_before);
        }
    }
}

/// Per-user bookkeeping: PDA ["user", vault, owner].
#[account]
#[derive(InitSpace)]
pub struct UserPosition {
    pub owner: Pubkey,
    pub vault: Pubkey,
    /// Lifetime totals in underlying tokens (informational).
    pub total_deposited: u64,
    pub total_withdrawn: u64,
    pub bump: u8,
}
