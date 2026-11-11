import type { ExtSnapshot, RulesView } from "../src/lib/types";

export const VAULT = "B9fCLC48ySs6R7E58zS8NcrvqtFFhNtV6RgMBqQG9Fty";
export const DEST = "DmpPGVKPkhsxAWxW5WaxReDa2QxdJZvXk8BaG1SwQXAC";
export const MINT = "Fdk8pnieuenEVDiBFxz6Bp7rsm8BFQc2o7V1cTTzHTow";
export const SOL = "11111111111111111111111111111111";
export const NOW = 1_800_000_000;

export const rules = (p: Partial<RulesView> = {}): RulesView => ({
  signers: 1,
  threshold: 1,
  slowDelay: 0,
  instantLimit: "0",
  whitelist: [],
  recoveryDelay: null,
  testament: null,
  keysLeft: 256,
  keysTotal: 256,
  ...p,
});

export const snap = (p: Partial<ExtSnapshot> = {}): ExtSnapshot => ({
  vault: VAULT,
  cluster: "devnet",
  takenAt: NOW,
  lamports: 42_000_000_000,
  pending: null,
  lockdownUntil: 0,
  recoveryAt: null,
  testamentAt: null,
  schedules: [],
  letters: [],
  rules: rules(),
  tokens: [],
  createdAt: NOW - 86_400,
  lastActive: NOW - 3600,
  actions: 1,
  ...p,
});
