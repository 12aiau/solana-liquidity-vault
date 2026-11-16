import { Program } from "@coral-xyz/anchor";
import type { Raydium } from "@raydium-io/raydium-sdk-v2";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { SYMBOL_A, SYMBOL_B, explorerAddress } from "../config";
import {
  PoolState,
  buildClose,
  buildDecrease,
  buildOpenPosition,
  buildSwap,
  fetchPool,
  loadRaydium,
  positionLiquidity,
  quoteSwap,
  rangeAround,
} from "../lib/admin";
import { pretty, short, toRaw } from "../lib/format";
import { VaultState, errorMessage } from "../lib/vault";
import { RunTx } from "./TxLog";
import { AmountField, Stat } from "./VaultPage";

type Props = {
  program: Program;
  state: VaultState;
  owner: PublicKey | null;
  busy: boolean;
  run: RunTx;
  reload: () => void;
};

const tickPrice = (tick: number) => Math.pow(1.0001, tick).toFixed(4);

export default function AdminPage({ program, state, owner, busy, run, reload }: Props) {
  const connection = program.provider.connection;
  const raydium = useRef<Raydium | null>(null);
  const [pool, setPool] = useState<PoolState | null>(null);
  const [liquidity, setLiquidity] = useState<BN | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [aToB, setAToB] = useState(true);
  const [swapInput, setSwapInput] = useState("");
  const [slippage, setSlippage] = useState("1");
  const [amountA, setAmountA] = useState("1000");
  const [amountB, setAmountB] = useState("500");
  const [halfWidth, setHalfWidth] = useState("2");

  const isAdmin = !!owner && owner.equals(state.admin);
  const position = state.position?.active ? state.position : null;
  const nftMint = position?.nftMint.toBase58();

  const refreshPool = useCallback(async () => {
    try {
      raydium.current ??= await loadRaydium(connection);
      const p = await fetchPool(raydium.current);
      setPool(p);
      setLiquidity(nftMint ? await positionLiquidity(connection, new PublicKey(nftMint)) : null);
      setLoadError(null);
      return p;
    } catch (e) {
      setLoadError(errorMessage(e));
      return null;
    }
  }, [connection, nftMint]);

  useEffect(() => {
    refreshPool();
  }, [refreshPool]);

  const after = () => {
    reload();
    refreshPool();
  };

  const inRange = pool && position && pool.tick >= position.tickLower && pool.tick < position.tickUpper;
  const swapRaw = toRaw(swapInput);
  const swapBalance = aToB ? state.idle : state.idleB;
  const swapError =
    !swapInput
      ? null
      : !swapRaw || swapRaw.isZero()
      ? "Введите сумму больше нуля"
      : swapRaw.gt(swapBalance)
      ? `В vault только ${pretty(swapBalance)} ${aToB ? SYMBOL_A : SYMBOL_B}`
      : null;
  const slippagePct = Number(slippage.replace(",", "."));
  const slippageOk = slippagePct > 0 && slippagePct <= 50;
  const width = Math.max(1, Math.min(50, Math.round(Number(halfWidth)) || 1));
  const plannedRange = pool ? rangeAround(pool, width) : null;
  const rawA = toRaw(amountA);
  const rawB = toRaw(amountB);

  const swap = async () => {
    if (!owner || !swapRaw) return;
    await run(`Обмен ${pretty(swapRaw)} ${aToB ? `${SYMBOL_A} → ${SYMBOL_B}` : `${SYMBOL_B} → ${SYMBOL_A}`}`, async () => {
      const fresh = (await refreshPool())!;
      const q = await quoteSwap(raydium.current!, fresh, aToB, swapRaw, slippagePct / 100);
      return buildSwap(program, owner, fresh, aToB, swapRaw, q).rpc();
    });
    setSwapInput("");
    after();
  };

  const open = async () => {
    if (!owner || !rawA || !rawB) return;
    await run("Открыть позицию", async () => {
      const fresh = (await refreshPool())!;
      const { builder } = await buildOpenPosition(program, owner, fresh, rangeAround(fresh, width), rawA, rawB);
      return builder.rpc();
    });
    after();
  };

  const collect = async () => {
    if (!owner || !pool || !position) return;
    await run("Собрать комиссии", () => buildDecrease(program, owner, pool, position, new BN(0)).rpc());
    after();
  };

  const close = async () => {
    if (!owner || !pool || !position) return;
    const liq = await positionLiquidity(connection, position.nftMint);
    if (!liq.isZero()) {
      const ok = await run("Снять ликвидность", () => buildDecrease(program, owner, pool, position, liq).rpc());
      if (!ok) return after();
    }
    await run("Закрыть позицию", () => buildClose(program, owner, pool, position).rpc());
    after();
  };

  return (
    <>
      {!isAdmin && (
        <div className="notice warn">
          Действия на этой странице доступны только администратору vault (
          <a href={explorerAddress(state.admin)} target="_blank" rel="noreferrer">
            {short(state.admin)}
          </a>
          ). {owner ? "Подключён другой кошелёк." : "Подключите кошелёк администратора."}
        </div>
      )}
      {loadError && <div className="notice warn">Не удалось загрузить данные пула: {loadError}</div>}

      <section className="stats">
        <Stat label={`Свободно ${SYMBOL_A}`} value={pretty(state.idle)} unit="на счёте vault" />
        <Stat label={`Свободно ${SYMBOL_B}`} value={pretty(state.idleB)} unit="на счёте vault" />
        <Stat label="Размещено" value={pretty(state.deployed)} unit={`${SYMBOL_A}, балансовая стоимость`} />
        <Stat label="Цена в пуле" value={pool ? pool.price.toFixed(4) : "…"} unit={pool ? `${SYMBOL_B} за ${SYMBOL_A} · тик ${pool.tick}` : ""} />
      </section>

      <section className="grid2">
        <div className="card">
          <h2>Обмен через Raydium</h2>
          <div className="segmented" role="group" aria-label="Направление обмена">
            <button className={aToB ? "on" : ""} onClick={() => setAToB(true)}>
              {SYMBOL_A} → {SYMBOL_B}
            </button>
            <button className={!aToB ? "on" : ""} onClick={() => setAToB(false)}>
              {SYMBOL_B} → {SYMBOL_A}
            </button>
          </div>
          <AmountField label={`Сумма, ${aToB ? SYMBOL_A : SYMBOL_B}`} value={swapInput} onChange={setSwapInput} error={swapError} />
          <AmountField
            label="Допустимое проскальзывание, %"
            value={slippage}
            onChange={setSlippage}
            error={slippageOk ? null : "От 0 до 50%"}
          />
          <p className="hint">Минимальная сумма получения считается по котировке пула и проверяется в программе.</p>
          <button className="primary" disabled={!isAdmin || busy || !pool || !swapRaw || !!swapError || !slippageOk} onClick={swap}>
            Обменять
          </button>
        </div>

        <div className="card">
          <h2>Позиция в CLMM-пуле</h2>
          {position ? (
            <>
              <dl className="kv">
                <dt>Диапазон</dt>
                <dd>
                  {tickPrice(position.tickLower)} – {tickPrice(position.tickUpper)} {SYMBOL_B} за {SYMBOL_A}
                  <small>
                    тики {position.tickLower} … {position.tickUpper}
                  </small>
                </dd>
                <dt>Статус</dt>
                <dd>
                  {pool ? (
                    <span className={`badge ${inRange ? "ok" : "bad"}`}>{inRange ? "В диапазоне" : "Вне диапазона"}</span>
                  ) : (
                    "…"
                  )}
                </dd>
                <dt>Ликвидность</dt>
                <dd>{liquidity ? liquidity.toString() : "…"}</dd>
                <dt>NFT позиции</dt>
                <dd>
                  <a href={explorerAddress(position.nftMint)} target="_blank" rel="noreferrer">
                    {short(position.nftMint)} ↗
                  </a>
                </dd>
              </dl>
              {pool && !inRange && (
                <p className="hint">Цена вышла из диапазона: позиция не зарабатывает комиссии. Закройте её и откройте новую вокруг текущей цены.</p>
              )}
              <div className="row">
                <button disabled={!isAdmin || busy || !pool} onClick={collect}>
                  Собрать комиссии
                </button>
                <button className="danger" disabled={!isAdmin || busy || !pool} onClick={close}>
                  Закрыть позицию
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="hint">Открытой позиции нет. Новая позиция откроется вокруг текущей цены пула.</p>
              <AmountField label={`До, ${SYMBOL_A}`} value={amountA} onChange={setAmountA} error={rawA ? null : "Введите число"} />
              <AmountField label={`До, ${SYMBOL_B}`} value={amountB} onChange={setAmountB} error={rawB ? null : "Введите число"} />
              <AmountField label="Полуширина диапазона, в шагах тика" value={halfWidth} onChange={setHalfWidth} />
              {plannedRange && (
                <p className="hint">
                  Диапазон: {tickPrice(plannedRange.tickLower)} – {tickPrice(plannedRange.tickUpper)} {SYMBOL_B} за {SYMBOL_A} (тики{" "}
                  {plannedRange.tickLower} … {plannedRange.tickUpper})
                </p>
              )}
              <button className="primary" disabled={!isAdmin || busy || !pool || !rawA || !rawB} onClick={open}>
                Открыть позицию
              </button>
            </>
          )}
        </div>
      </section>
    </>
  );
}
