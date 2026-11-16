# Задание 12. Swap через Raydium CLMM

Инструкция [`swap`](../programs/liquidity-vault/src/instructions/swap.rs)
обменивает токены, лежащие в vault, через CLMM-пул Raydium (CPI в `swap_v2`).

* Вызвать может только `admin` vault.
* Плательщик и владелец токен-аккаунтов для Raydium это PDA `vault_authority`;
  CPI подписывается через `invoke_signed` сидами `["authority", vault]`.
* **Slippage:** `min_amount_out` передаётся в Raydium как
  `other_amount_threshold` (exact input). Если пул даёт меньше, Raydium
  откатывает транзакцию с `TooLittleOutputReceived`; после CPI программа ещё раз
  сама сверяет фактический прирост баланса и кидает `SlippageExceeded`.
* Инструкция Raydium собирается вручную в
  [`raydium.rs`](../programs/liquidity-vault/src/raydium.rs): дискриминатор
  `sha256("global:swap_v2")[..8]` + borsh-аргументы, аккаунты в порядке
  `SwapSingleV2`, tick array передаются через remaining accounts.
* Учёт: сколько underlying ушло из vault, записывается в `deployed_assets`,
  чтобы цена share-токена не падала из-за обмена.

Скрипт [`scripts/12-vault-swap.ts`](../scripts/12-vault-swap.ts) в devnet:

1. создаёт vault для токена A и вносит депозит;
2. считает котировку через Raydium SDK (ожидаемый выход и min out при 1%);
3. пробует swap с завышенным `min_amount_out` и убеждается, что он откатился;
4. делает настоящий swap 1000 A -> B.

```bash
ANCHOR_WALLET=/path/to/devnet-wallet.json yarn task12
```
