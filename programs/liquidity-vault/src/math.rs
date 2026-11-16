use anchor_lang::prelude::*;

use crate::error::VaultError;

/// Virtual offset (as in ERC-4626) that protects the first depositor from
/// share-price inflation attacks. With an empty vault, 1 token = 1 share.
const VIRTUAL_SHARES: u128 = 1;
const VIRTUAL_ASSETS: u128 = 1;

/// Shares minted for `assets` deposited, rounded down (in favour of the vault).
pub fn assets_to_shares(assets: u64, total_assets: u64, total_shares: u64) -> Result<u64> {
    mul_div(
        assets as u128,
        total_shares as u128 + VIRTUAL_SHARES,
        total_assets as u128 + VIRTUAL_ASSETS,
    )
}

/// Assets returned for `shares` burned, rounded down (in favour of the vault).
pub fn shares_to_assets(shares: u64, total_assets: u64, total_shares: u64) -> Result<u64> {
    mul_div(
        shares as u128,
        total_assets as u128 + VIRTUAL_ASSETS,
        total_shares as u128 + VIRTUAL_SHARES,
    )
}

fn mul_div(a: u128, b: u128, c: u128) -> Result<u64> {
    let r = a
        .checked_mul(b)
        .and_then(|x| x.checked_div(c))
        .ok_or(VaultError::MathOverflow)?;
    u64::try_from(r).map_err(|_| VaultError::MathOverflow.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_deposit_is_one_to_one() {
        assert_eq!(assets_to_shares(1_000, 0, 0).unwrap(), 1_000);
    }

    #[test]
    fn proportional_after_yield() {
        // 1000 shares backed by 2000 assets -> price 2
        // (virtual offset makes results round down by a hair)
        assert_eq!(assets_to_shares(500, 2_000, 1_000).unwrap(), 250);
        assert_eq!(shares_to_assets(250, 2_000, 1_000).unwrap(), 499);
    }

    #[test]
    fn round_trip_never_profits() {
        let shares = assets_to_shares(777, 12_345, 9_999).unwrap();
        let back = shares_to_assets(shares, 12_345 + 777, 9_999 + shares).unwrap();
        assert!(back <= 777);
    }
}
