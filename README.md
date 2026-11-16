# Liquidity Vault

DeFi-vault на Solana (Anchor 0.31): принимает токены пользователей, выдаёт
share-токены и размещает ликвидность в CLMM-пуле Raydium.

Program ID (localnet / devnet): `DQiYDQPgUy7S8PP6UTyB957vL3tB234c2r7Eatddfgnu`

## Задания

| № | Тема | Где смотреть |
|---|---|---|
| 8 | Каркас vault: настройки, PDA пользователя, share-токен | `state.rs`, `instructions/initialize_vault.rs`, `init_user.rs`, `update_config.rs` |
| 9 | Депозит и share-токены | `instructions/deposit.rs`, `math.rs` |
| 10 | CPI и вывод (подпись PDA) | `instructions/withdraw.rs` |
| 11 | AMM, CLMM, тестовые токены и пул в devnet | [docs/11-amm-clmm.md](docs/11-amm-clmm.md), `scripts/11-create-pool.ts` |
| 12 | Swap через Raydium со slippage | [docs/12-swap.md](docs/12-swap.md), `instructions/swap.rs`, `raydium.rs`, `scripts/12-vault-swap.ts` |
| 13 | Позиция в CLMM: открыть, собрать комиссии, закрыть, переставить | [docs/13-position.md](docs/13-position.md), `instructions/position.rs`, `scripts/13-vault-position.ts` |

## Аккаунты

| Аккаунт | Seeds | Назначение |
|---|---|---|
| `Vault` | `["vault", underlying_mint]` | настройки: admin, минты, лимит депозита, пауза |
| `vault_authority` | `["authority", vault]` | PDA без данных: владелец токенов vault, подписывает CPI |
| share mint | `["share", vault]` | share-токен, mint authority = `vault_authority` |
| `UserPosition` | `["user", vault, owner]` | учёт пользователя |
| `StrategyPosition` | `["position", vault]` | текущая позиция Raydium CLMM |

Цена доли: `shares = amount * (total_shares + 1) / (total_assets + 1)`,
округление всегда в пользу vault. `total_assets` = свободные токены на счёте
vault + балансовая стоимость средств, размещённых в Raydium (`deployed_assets`).
Вывести можно только свободные токены; средства из позиции admin сначала
возвращает в vault.

## Запуск

```bash
yarn install
anchor test          # localnet: каркас, депозит, вывод
cargo test --lib     # математика долей
```

Devnet (Raydium CLMM `DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH`):

```bash
anchor deploy --provider.cluster devnet
export ANCHOR_WALLET=~/.config/solana/id.json
yarn task11   # токены + пул
yarn task12   # swap из vault
yarn task13   # позиция, комиссии, ребаланс
```

Ключи и seed-фразы в репозитории не хранятся (см. `.gitignore`); работа только
в localnet и devnet.
