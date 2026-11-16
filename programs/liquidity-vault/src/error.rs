use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Only the vault admin can do this")]
    Unauthorized,
    #[msg("Vault is paused")]
    Paused,
}
