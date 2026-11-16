//! Minimal hand-written CPI client for Raydium CLMM (program `amm_v3`).
//!
//! Instruction layouts follow raydium-io/raydium-clmm `programs/amm/src`:
//! data = sha256("global:<name>")[..8] ++ borsh(args), accounts in the order of
//! the corresponding `#[derive(Accounts)]` struct, then remaining accounts.

use anchor_lang::{
    prelude::*,
    solana_program::{
        hash::hash,
        instruction::{AccountMeta, Instruction},
        program::invoke_signed,
    },
};
use anchor_spl::token::TokenAccount;

use crate::error::VaultError;

#[cfg(not(feature = "mainnet"))]
pub const CLMM_PROGRAM_ID: Pubkey = pubkey!("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH");
#[cfg(feature = "mainnet")]
pub const CLMM_PROGRAM_ID: Pubkey = pubkey!("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");

pub const MEMO_PROGRAM_ID: Pubkey = pubkey!("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
pub const METADATA_PROGRAM_ID: Pubkey = pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

/// Account passed to a CPI: (account, is_writable, is_signer).
pub type Meta<'a, 'info> = (&'a AccountInfo<'info>, bool, bool);

pub fn w<'a, 'info>(a: &'a AccountInfo<'info>) -> Meta<'a, 'info> {
    (a, true, false)
}
pub fn r<'a, 'info>(a: &'a AccountInfo<'info>) -> Meta<'a, 'info> {
    (a, false, false)
}
pub fn ws<'a, 'info>(a: &'a AccountInfo<'info>) -> Meta<'a, 'info> {
    (a, true, true)
}
pub fn rs<'a, 'info>(a: &'a AccountInfo<'info>) -> Meta<'a, 'info> {
    (a, false, true)
}

fn discriminator(name: &str) -> [u8; 8] {
    let h = hash(format!("global:{name}").as_bytes()).to_bytes();
    let mut d = [0u8; 8];
    d.copy_from_slice(&h[..8]);
    d
}

/// Builds and invokes a Raydium CLMM instruction signed by the vault PDA.
pub fn invoke_clmm<'info, A: AnchorSerialize>(
    clmm_program: &AccountInfo<'info>,
    name: &str,
    args: &A,
    accounts: &[Meta<'_, 'info>],
    remaining: &[AccountInfo<'info>],
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    require_keys_eq!(clmm_program.key(), CLMM_PROGRAM_ID, VaultError::InvalidProgram);

    let mut data = discriminator(name).to_vec();
    args.serialize(&mut data)?;

    let mut metas = Vec::with_capacity(accounts.len() + remaining.len());
    let mut infos = Vec::with_capacity(accounts.len() + remaining.len() + 1);
    for (info, writable, signer) in accounts {
        metas.push(AccountMeta {
            pubkey: info.key(),
            is_signer: *signer,
            is_writable: *writable,
        });
        infos.push((*info).clone());
    }
    for info in remaining {
        metas.push(AccountMeta {
            pubkey: info.key(),
            is_signer: false,
            is_writable: info.is_writable,
        });
        infos.push(info.clone());
    }
    infos.push(clmm_program.clone());

    let ix = Instruction {
        program_id: CLMM_PROGRAM_ID,
        accounts: metas,
        data,
    };
    invoke_signed(&ix, &infos, signer_seeds).map_err(Into::into)
}

/// Reads an SPL token account and checks it belongs to the vault PDA.
pub fn vault_token_balance(info: &AccountInfo, vault_authority: &Pubkey) -> Result<(Pubkey, u64)> {
    let acc = TokenAccount::try_deserialize(&mut &info.try_borrow_data()?[..])?;
    require_keys_eq!(acc.owner, *vault_authority, VaultError::NotVaultTokenAccount);
    Ok((acc.mint, acc.amount))
}
