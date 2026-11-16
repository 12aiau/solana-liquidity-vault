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
    #[msg("Not enough share tokens")]
    InsufficientShares,
    #[msg("Not enough idle tokens in the vault; liquidity is deployed")]
    InsufficientLiquidity,
    #[msg("Wrong Raydium CLMM program")]
    InvalidProgram,
    #[msg("Token account is not owned by the vault")]
    NotVaultTokenAccount,
    #[msg("Vault already has an open position; close it first")]
    PositionAlreadyOpen,
    #[msg("Vault has no open position")]
    NoActivePosition,
    #[msg("tick_lower must be below tick_upper")]
    InvalidRange,
}
