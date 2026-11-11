// Shared shapes. Everything stored in chrome.storage is plain JSON (no bigint, no PublicKey).
import type { VaultSnapshot } from "../../../web/lib/alerts/logic";
import type { ConfigJson } from "../../../web/lib/configJson";

export type ClusterId = "devnet" | "mainnet-beta" | "custom";

/** How this extension relates to a vault. "watch": address only (v0.1). The others belong to an account. */
export type VaultRole = "watch" | "owner" | "cosigner" | "duress";

export interface Watched {
  address: string;
  cluster: ClusterId;
  label: string;
  addedAt: number;
  /** v0.2: absent on v0.1 entries (= "watch"). */
  role?: VaultRole;
  /** The account (phrase) whose tree signs for this vault. */
  accountId?: string;
  /** Vault number of that phrase (docs/SPEC.md §2) and the slot its tree sits in (0..2 signer, 4 duress). */
  vaultNumber?: number;
  slot?: number;
  /** The full public config (web/lib/configJson.ts), saved at creation so an uninitialized vault can be initialized later. */
  config?: ConfigJson;
  /** Preset used at creation. */
  preset?: string;
}

export interface Settings {
  /** Network the popup shows and new vaults are added to. */
  cluster: ClusterId;
  /** https URL; used when cluster === "custom". */
  customRpc: string;
  /** Background poll interval, minutes (1..5). */
  intervalMin: number;
  notify: boolean;
  /** Lock the wallet after this many minutes without use. */
  autoLockMin: number;
  /** v0.3: network of the wallet view (holdings, send). Vaults stay on `cluster` (devnet). */
  walletCluster: WalletCluster;
  /** v0.3: optional own mainnet RPC for the wallet view (https). */
  mainnetRpc: string;
  /** v0.3: hide zero balances and likely spam tokens. */
  hideSpam: boolean;
}

export type WalletCluster = "mainnet-beta" | "devnet";

export const AUTOLOCK_CHOICES = [5, 15, 30, 60] as const;
export const DEFAULT_SETTINGS: Settings = { cluster: "devnet", customRpc: "", intervalMin: 2, notify: true, autoLockMin: 15, walletCluster: "mainnet-beta", mainnetRpc: "", hideSpam: true };

/** The vault's rules, flattened for display. Amounts are lamports as decimal strings; durations seconds. */
export interface RulesView {
  /** Signer slots in use (1..3) and how many must sign. */
  signers: number;
  threshold: number;
  /** Wait for restricted withdrawals; 0 = refused. */
  slowDelay: number;
  /** Lamports per 24 h a restricted SOL withdrawal may skip the wait. */
  instantLimit: string;
  whitelist: string[];
  /** Recovery key: full takeover after this much owner inactivity; null without one. */
  recoveryDelay: number | null;
  testament: { delay: number; heirs: { addr: string; bps: number }[] } | null;
  /** One-time keys left in the creating owner's tree. */
  keysLeft: number;
  keysTotal: number;
}

export interface TokenBalance {
  mint: string;
  /** Human amount, e.g. "12.5". */
  ui: string;
  /** Raw base units. */
  raw: string;
  decimals: number;
}

export interface ExtSnapshot extends VaultSnapshot {
  cluster: ClusterId;
  rules: RulesView;
  tokens: TokenBalance[];
  createdAt: number;
  lastActive: number;
  actions: number;
}

/** Last poll result per watched vault, keyed by watchKey(). */
export interface VaultStatus {
  checkedAt: number;
  snap: ExtSnapshot | null;
  /** The address holds no Noxvault state on that cluster. */
  notFound?: boolean;
  error?: string;
}

export type AlertKind = "pending" | "migrate" | "lockdown" | "recovery" | "testament" | "letter" | "schedule";

export interface ExtAlert {
  /** Globally unique dedupe key: cluster:vault:alertKey. */
  id: string;
  kind: AlertKind;
  vault: string;
  title: string;
  message: string;
  /** Where clicking the notification goes. */
  url: string;
  /** Counts toward the red badge while it holds. */
  urgent: boolean;
}

export const watchKey = (w: { cluster: ClusterId; address: string }) => `${w.cluster}:${w.address}`;
