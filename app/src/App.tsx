import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { TxLog, useTxLog } from "./components/TxLog";
import { VaultPage } from "./components/VaultPage";
import { explorerAddress } from "./config";
import { short } from "./lib/format";
import { VaultState, errorMessage, fetchVaultState, getProgram, vaultPdas } from "./lib/vault";

// The admin page pulls in the Raydium SDK, so load it only when opened.
const AdminPage = lazy(() => import("./components/AdminPage"));

type Tab = "vault" | "admin";

export default function App() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const program = useMemo(() => getProgram(connection, wallet), [connection, wallet]);
  const owner = wallet?.publicKey ?? null;
  const tx = useTxLog();

  const [tab, setTab] = useState<Tab>("vault");
  const [state, setState] = useState<VaultState | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setState(await fetchVaultState(program, owner));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [program, owner]);

  useEffect(() => {
    reload();
    const timer = setInterval(reload, 30_000);
    return () => clearInterval(timer);
  }, [reload]);

  const pageProps = state ? { program, state, owner, busy: tx.busy, run: tx.run, reload } : null;

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden>
            ◈
          </span>
          <div>
            <h1>Liquidity Vault</h1>
            <span className="net">Solana devnet</span>
          </div>
        </div>
        <nav className="tabs">
          <button className={tab === "vault" ? "on" : ""} onClick={() => setTab("vault")}>
            Vault
          </button>
          <button className={tab === "admin" ? "on" : ""} onClick={() => setTab("admin")}>
            Администратор
          </button>
        </nav>
        <WalletMultiButton />
      </header>

      <main>
        {error && (
          <div className="notice warn">
            Не удалось загрузить данные: {error}{" "}
            <button className="ghost" onClick={reload}>
              Повторить
            </button>
          </div>
        )}
        {state === undefined && !error && <div className="notice">Загружаем данные vault…</div>}
        {state === null && <div className="notice warn">Vault ещё не создан в этой сети.</div>}

        {pageProps && tab === "vault" && <VaultPage {...pageProps} />}
        {pageProps && tab === "admin" && (
          <Suspense fallback={<div className="notice">Загружаем страницу администратора…</div>}>
            <AdminPage {...pageProps} />
          </Suspense>
        )}

        <TxLog items={tx.items} />
      </main>

      <footer>
        Программа{" "}
        <a href={explorerAddress(program.programId)} target="_blank" rel="noreferrer">
          {short(program.programId)}
        </a>{" "}
        · Vault{" "}
        <a href={explorerAddress(vaultPdas(program.programId).vault)} target="_blank" rel="noreferrer">
          {short(vaultPdas(program.programId).vault)}
        </a>
      </footer>
    </div>
  );
}
