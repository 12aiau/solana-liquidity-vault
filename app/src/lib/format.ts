import BN from "bn.js";
import { DECIMALS } from "../config";

/** "12.5" -> raw units (BN). Returns null for empty / invalid input. */
export function toRaw(input: string, decimals = DECIMALS): BN | null {
  const s = input.trim().replace(",", ".");
  if (!/^\d+(\.\d*)?$/.test(s)) return null;
  const [int, frac = ""] = s.split(".");
  if (frac.length > decimals) return null;
  return new BN(int + frac.padEnd(decimals, "0"));
}

/** raw units -> "12.5" (trailing zeros trimmed). */
export function fromRaw(raw: BN, decimals = DECIMALS): string {
  const s = raw.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

/** raw units -> "12 345.67" for display. */
export function pretty(raw: BN, decimals = DECIMALS, maxFrac = 4): string {
  const [int, frac = ""] = fromRaw(raw, decimals).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const f = frac.slice(0, maxFrac).replace(/0+$/, "");
  return f ? `${grouped}.${f}` : grouped;
}

export const short = (a: { toString(): string }) => {
  const s = a.toString();
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
};
