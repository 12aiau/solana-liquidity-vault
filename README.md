# Liquidity Vault

DeFi-vault на Solana (Anchor 0.31). Пользователь вносит токены и получает
share-токены (свою долю). Администратор размещает средства vault в
CLMM-пуле Raydium: обменивает токены, открывает позицию в ценовом диапазоне,
собирает комиссии и переставляет позицию, когда цена уходит из диапазона.
Заработанные комиссии остаются в vault и повышают цену доли.

Работает в **devnet**. Пользоваться можно через веб-интерфейс, без терминала:
**https://12aiau.github.io/solana-liquidity-vault/**

## Адреса в devnet

| Что | Адрес |
|---|---|
| Программа | `DQiYDQPgUy7S8PP6UTyB957vL3tB234c2r7Eatddfgnu` |
| Vault (настройки) | `H3AXNSHYKz1kpz8ndSfzhDG1uiP4nohykzYqGqpABn1z` |
| Токен A (TKA, underlying) | `2ymb33oWsWGQMqJ9u8zA1gypynxiKs6N8DUxM4McpdAU` |
| Токен B (TKB) | `APjEpWCiAwkxFEuGiojA2MBK4d2BAqd4CZJdJ5dBQexq` |
| CLMM-пул Raydium | `EMSCboYCKG6tchGfFaUXPZDjW7ffxoqpLRJ6XHDNqvjG` |
| Raydium CLMM (devnet) | `DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH` |
| Администратор vault | `HjjG9XDGeg66K5gAZohaYhzFFfvJQRBgsxcvGZGNTE51` |

Подписи транзакций: [deployments/devnet.json](deployments/devnet.json).

## Веб-интерфейс

Открыть: https://12aiau.github.io/solana-liquidity-vault/ (GitHub Pages, ветка `gh-pages`).
Код в папке [`app/`](app) (Vite + React, Solana Wallet Adapter). Локальный запуск:

```bash
cd app
npm install
npm run dev      # http://localhost:5173
```

1. Переключите Phantom или Solflare в режим devnet и нажмите **Select Wallet**.
2. Получите немного devnet SOL (https://faucet.solana.com) и тестовые токены
   TKA: администратор выдаёт их командой `yarn faucet <адрес кошелька>`.
3. Вкладка **Vault**: баланс, ваши share-токены, сколько всего в vault,
   кнопки «Внести» и «Вывести». Каждая транзакция показывает статус и ссылку
   на Explorer.
4. Вкладка **Администратор** (только кошелёк администратора): обмен через
   Raydium со slippage, открыть позицию, собрать комиссии, закрыть позицию.

`npm run smoke` симулирует в devnet все транзакции интерфейса, ничего не
отправляя (нужен `ANCHOR_WALLET` администратора).

## Команда

| Участник | Что сделал |
|---|---|
| @12aiau | программа, скрипты devnet, веб-интерфейс |


## Задания

| № | Тема | Где смотреть |
|---|---|---|
| 8 | Каркас vault: настройки, PDA пользователя, share-токен | `state.rs`, `instructions/initialize_vault.rs`, `init_user.rs`, `update_config.rs` |
| 9 | Депозит и share-токены | `instructions/deposit.rs`, `math.rs` |
| 10 | CPI и вывод (подпись PDA) | `instructions/withdraw.rs` |
| 11 | AMM, CLMM, тестовые токены и пул в devnet | [docs/11-amm-clmm.md](docs/11-amm-clmm.md), `scripts/11-create-pool.ts` |
| 12 | Swap через Raydium со slippage | [docs/12-swap.md](docs/12-swap.md), `instructions/swap.rs`, `raydium.rs`, `scripts/12-vault-swap.ts` |
| 13 | Позиция в CLMM: открыть, собрать комиссии, закрыть, переставить | [docs/13-position.md](docs/13-position.md), `instructions/position.rs`, `scripts/13-vault-position.ts` |
| 14 | Capstone: веб-интерфейс и страница администратора | [`app/`](app), `scripts/faucet.ts` |

## Схема аккаунтов

```
пользователь ──deposit──▶ vault_token_account (TKA) ◀──withdraw── пользователь
     ▲                          │ владелец: vault_authority (PDA)
     └── share-токены ◀─ mint ──┤
                                ├── swap ───────────▶ Raydium CLMM пул
                                └── open/decrease/close ─▶ позиция (NFT у PDA)
```

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
yarn faucet <адрес>   # выдать тестовые токены кошельку
```

Ключи и seed-фразы в репозитории не хранятся (см. `.gitignore`); работа только
в localnet и devnet.
