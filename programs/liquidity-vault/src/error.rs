use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Only the vault admin can do this")]
    Unauthorized,
    #[msg("Vault is paused")]
    Paused,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Deposit would exceed the vault cap")]
    DepositCapExceeded,
    #[msg("Result is below the requested minimum (slippage)")]
    SlippageExceeded,
    #[msg("Math overflow")]
    MathOverflow,
}
