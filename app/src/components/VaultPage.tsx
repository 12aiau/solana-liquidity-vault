import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { useState } from "react";
import { SYMBOL_A } from "../config";
import { fromRaw, pretty, toRaw } from "../lib/format";
import { VaultState, assetsToShares, buildDeposit, buildWithdraw, sharesToAssets } from "../lib/vault";
import { RunTx } from "./TxLog";

type Props = {
  program: Program;
  state: VaultState;
  owner: PublicKey | null;
  busy: boolean;
  run: RunTx;
  reload: () => void;
};

/** Accept up to 0.5% worse than the previewed result. */
const withSlippage = (x: BN) => x.muln(995).divn(1000);

export function VaultPage({ program, state, owner, busy, run, reload }: Props) {
  const [depositInput, setDepositInput] = useState("");
  const [withdrawInput, setWithdrawInput] = useState("");
  const user = state.user;

  const sharePrice =
    Number(sharesToAssets(new BN(1_000_000), state.totalAssets, state.shareSupply).toString()) / 1_000_000;

  const depositRaw = toRaw(depositInput);
  const depositShares = depositRaw && assetsToShares(depositRaw, state.totalAssets, state.shareSupply);
  const depositError =
    !depositInput || !user
      ? null
      : !depositRaw || depositRaw.isZero()
      ? "Введите сумму больше нуля"
      : depositRaw.gt(user.tokens)
      ? `На кошельке только ${pretty(user.tokens)} ${SYMBOL_A}`
      : null;

  const withdrawRaw = toRaw(withdrawInput);
  const withdrawAssets = withdrawRaw && sharesToAssets(withdrawRaw, state.totalAssets, state.shareSupply);
  const withdrawError =
    !withdrawInput || !user
      ? null
      : !withdrawRaw || withdrawRaw.isZero()
      ? "Введите количество больше нуля"
      : withdrawRaw.gt(user.shares)
      ? `У вас только ${pretty(user.shares)} share-токенов`
      : withdrawAssets!.gt(state.idle)
      ? `Сейчас в vault свободно ${pretty(state.idle)} ${SYMBOL_A}: остальное размещено в пуле`
      : null;

  const deposit = async () => {
    if (!owner || !depositRaw || !depositShares) return;
    const ok = await run(`Внести ${pretty(depositRaw)} ${SYMBOL_A}`, async () =>
      (await buildDeposit(program, owner, depositRaw, withSlippage(depositShares))).rpc()
    );
    if (ok) setDepositInput("");
    reload();
  };

  const withdraw = async () => {
    if (!owner || !withdrawRaw || !withdrawAssets) return;
    const ok = await run(`Вывести ${pretty(withdrawRaw)} share`, async () =>
      (await buildWithdraw(program, owner, withdrawRaw, withSlippage(withdrawAssets))).rpc()
    );
    if (ok) setWithdrawInput("");
    reload();
  };

  return (
    <>
      <section className="stats">
        <Stat label="Всего в vault" value={pretty(state.totalAssets)} unit={SYMBOL_A} />
        <Stat label="Цена доли" value={sharePrice.toFixed(4)} unit={`${SYMBOL_A} за share`} />
        <Stat label="Ваш баланс" value={user ? pretty(user.tokens) : "—"} unit={SYMBOL_A} />
        <Stat
          label="Ваши share-токены"
          value={user ? pretty(user.shares) : "—"}
          unit={user ? `≈ ${pretty(user.sharesValue)} ${SYMBOL_A}` : "share"}
        />
      </section>

      {state.paused && <div className="notice warn">Vault на паузе: новые депозиты временно не принимаются.</div>}
      {!owner && <div className="notice">Подключите кошелёк (Phantom или Solflare в режиме devnet), чтобы внести или вывести токены.</div>}
      {owner && user && user.tokens.isZero() && user.shares.isZero() && (
        <div className="notice">
          На этом кошельке нет тестовых токенов {SYMBOL_A}. Попросите администратора выдать их на ваш адрес
          (команда <code>yarn faucet &lt;адрес&gt;</code>).
        </div>
      )}

      <section className="grid2">
        <div className="card">
          <h2>Внести</h2>
          <AmountField
            label={`Сумма, ${SYMBOL_A}`}
            value={depositInput}
            onChange={setDepositInput}
            onMax={user ? () => setDepositInput(fromRaw(user.tokens)) : undefined}
            error={depositError}
          />
          <p className="hint">
            {depositShares && !depositError ? `Вы получите ≈ ${pretty(depositShares)} share-токенов` : "Вы получите share-токены — вашу долю в vault"}
          </p>
          <button className="primary" disabled={!owner || busy || state.paused || !depositRaw || !!depositError} onClick={deposit}>
            Внести
          </button>
        </div>

        <div className="card">
          <h2>Вывести</h2>
          <AmountField
            label="Количество share-токенов"
            value={withdrawInput}
            onChange={setWithdrawInput}
            onMax={user ? () => setWithdrawInput(fromRaw(user.shares)) : undefined}
            error={withdrawError}
          />
          <p className="hint">
            {withdrawAssets && !withdrawError ? `Вы получите ≈ ${pretty(withdrawAssets)} ${SYMBOL_A}` : "Share-токены сжигаются, vault возвращает токены"}
          </p>
          <button className="primary" disabled={!owner || busy || !withdrawRaw || !!withdrawError} onClick={withdraw}>
            Вывести
          </button>
        </div>
      </section>
    </>
  );
}

export function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {unit && <div className="stat-unit">{unit}</div>}
    </div>
  );
}

export function AmountField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onMax?: () => void;
  error?: string | null;
}) {
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      <span className="field-row">
        <input
          inputMode="decimal"
          placeholder="0.0"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          aria-invalid={!!props.error}
        />
        {props.onMax && (
          <button type="button" className="ghost" onClick={props.onMax}>
            Макс
          </button>
        )}
      </span>
      {props.error && <span className="field-error">{props.error}</span>}
    </label>
  );
}
