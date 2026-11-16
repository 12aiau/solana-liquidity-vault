import { useCallback, useState } from "react";
import { explorerTx } from "../config";
import { short } from "../lib/format";
import { errorMessage } from "../lib/vault";

export type TxItem = {
  id: number;
  label: string;
  status: "pending" | "success" | "error";
  signature?: string;
  error?: string;
};

/** Runs a transaction and tracks its status. Returns true on success. */
export type RunTx = (label: string, send: () => Promise<string>) => Promise<boolean>;

export function useTxLog() {
  const [items, setItems] = useState<TxItem[]>([]);
  const [busy, setBusy] = useState(false);

  const run: RunTx = useCallback(async (label, send) => {
    const id = Date.now() + Math.random();
    const patch = (p: Partial<TxItem>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...p } : i)));
    setItems((list) => [{ id, label, status: "pending" as const }, ...list].slice(0, 8));
    setBusy(true);
    try {
      const signature = await send();
      patch({ status: "success", signature });
      return true;
    } catch (e) {
      console.error(e);
      patch({ status: "error", error: errorMessage(e) });
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { items, busy, run };
}

const STATUS = { pending: "Отправляется…", success: "Подтверждена", error: "Ошибка" };

export function TxLog({ items }: { items: TxItem[] }) {
  if (!items.length) return null;
  return (
    <section className="card">
      <h2>Транзакции</h2>
      <ul className="txlog">
        {items.map((t) => (
          <li key={t.id} className={`tx tx-${t.status}`}>
            <span className="tx-dot" aria-hidden />
            <div className="tx-body">
              <div className="tx-title">
                <span>{t.label}</span>
                <span className="tx-status">{STATUS[t.status]}</span>
              </div>
              {t.signature && (
                <a href={explorerTx(t.signature)} target="_blank" rel="noreferrer">
                  {short(t.signature)} · открыть в Explorer ↗
                </a>
              )}
              {t.error && <div className="tx-error">{t.error}</div>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
