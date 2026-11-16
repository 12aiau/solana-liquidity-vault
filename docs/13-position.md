# Задание 13. Позиция в CLMM-пуле Raydium

Vault сам владеет позицией: NFT позиции лежит на ATA PDA `vault_authority`,
все CPI в Raydium подписываются сидами `["authority", vault]`.
Код: [`instructions/position.rs`](../programs/liquidity-vault/src/instructions/position.rs).

| Инструкция vault | CPI в Raydium | Что делает |
|---|---|---|
| `open_position` | `open_position_v2` | открывает позицию в диапазоне `[tick_lower, tick_upper]` |
| `decrease_liquidity` (`liquidity = 0`) | `decrease_liquidity_v2` | собирает накопленные комиссии |
| `decrease_liquidity` (`liquidity = L`) | `decrease_liquidity_v2` | снимает ликвидность (и комиссии) |
| `close_position` | `close_position` | сжигает NFT пустой позиции |

Текущая позиция записана в аккаунте `StrategyPosition`
(PDA `["position", vault]`): пул, NFT, тики, флаг `active`. Одновременно у vault
одна позиция; **перестановка** = снять всю ликвидность -> закрыть -> открыть
новую вокруг текущей цены.

Скрипт [`scripts/13-vault-position.ts`](../scripts/13-vault-position.ts) в devnet:

1. открывает позицию в диапазоне ±2 tick spacing вокруг текущего тика;
2. «трейдер» (кошелёк) делает обмены туда-обратно, позиция копит комиссии;
3. собирает комиссии в vault;
4. крупный обмен выводит цену из диапазона (позиция целиком в токене A и
   больше не зарабатывает);
5. ребаланс: снимает ликвидность, закрывает позицию, открывает новую вокруг
   новой цены.

```bash
ANCHOR_WALLET=/path/to/devnet-wallet.json yarn task13
```

Результат прогона (тики): позиция `[-180, 120]` при тике `-18` -> цена ушла на
тик `-291` -> новая позиция `[-420, -120]`. Подписи транзакций лежат в
[`deployments/devnet.json`](../deployments/devnet.json).
