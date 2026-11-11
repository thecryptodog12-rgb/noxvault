// Create a vault inside the extension: the site's presets and settings (src/core/create.ts, a port
// of SetupVault), the same tree generation (the site's worker), a recovery / duress phrase shown ONCE
// and never stored, then fund + initialize (relayer, or the fee account). The public config is saved
// with the vault entry (the site keeps it in localStorage as nox3.config.<vault>) and can be exported.
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { DURESS_TREE, RECOVERY_TREE, TIER_FREE, TIER_NAMES, TIER_SENTINEL, fetchProtocol, fetchState, newMasterSecret, secretToWords, tierNeeded, type Config, type Signer } from "../../../sdk/client";
import { configFromJson, configToJson } from "../../../web/lib/configJson";
import { hex, short, sol } from "../../../web/lib/format";
import { fmtDuration as duration } from "../../../web/lib/alerts/logic";
import { ANTITHEFT_INSTANT_SOL, PRESETS, type Preset } from "../../../web/lib/presets";
import { applyPreset, buildConfig, changeDao, daoCheck, defaultForm, freeVaultNumber, type CreateForm } from "../core/create";
import { faucet, initViaRelayer } from "../core/relayer";
import { buildSignerUncached, getSigner } from "../core/trees";
import { initWithFeeAccount } from "../core/vaults";
import { qrSvg } from "../lib/qr";
import { MAX_WATCHED, load, save } from "../lib/store";
import { watchKey, type Watched } from "../lib/types";
import { activeAccount, app, back, connFor, defineView, errText, esc, expandToTab, findVault, go, needMaster, on, payerOf, programFor, render, send, signingProblem, solNum, tierOf, toast } from "./core";
import { startMove, takeProtect } from "./wallet";
import { wordGrid } from "./onboard";

const RELAY_INIT_MIN = 0.02 * LAMPORTS_PER_SOL;

interface CreateView {
  name: "create";
  stage: "loading" | "settings" | "review";
  accountId: string;
  progress?: [number, number];
  err?: string;
  n?: number;
  signer?: Signer | null;
  form: CreateForm;
  label: string;
  recWords?: string | null;
  recQuiz?: number[];
  recBusy?: boolean;
  duressWords?: string | null;
  duressBusy?: boolean;
  /** v0.3 "Protect it": the wallet account that pays for and then funds this vault */
  fromWallet?: string | null;
}

const cv = () => app.view as unknown as CreateView;

on({
  "create-start": () => {
    const acct = activeAccount();
    if (!app.data.keyring) return go({ name: "welcome" });
    if (!app.unlocked) return go({ name: "lock", next: { name: "home" } });
    const problem = signingProblem(app.data.settings.cluster);
    if (problem) return toast(problem);
    if (!acct) return;
    const fromWallet = takeProtect();
    const fw = app.data.wallets.find((x) => x.id === fromWallet);
    // A vault is signed by a Noxvault phrase: the wallet's own phrase when it is derived, else the active phrase.
    const accountId = fw?.phraseId && app.data.accounts.some((a) => a.id === fw.phraseId) ? fw.phraseId : acct.id;
    go({ name: "create", stage: "loading", accountId, fromWallet, form: defaultForm(), label: fw ? `${fw.name} vault`.slice(0, 24) : `Vault ${app.data.watched.filter((w) => w.accountId === accountId).length + 1}` } as never);
  },
  "create-expand": () => expandToTab("create"),
});

async function findNumber(v: CreateView) {
  try {
    const m = await needMaster(v.accountId);
    const takenRoots = new Set<string>();
    try {
      // Trees this extension already used for a vault that is not initialized yet.
      for (const w of app.data.watched)
        if (w.accountId === v.accountId && w.config && w.vaultNumber != null) takenRoots.add(w.config.trees[w.slot ?? 0]?.root ?? "");
      const { n, signer } = await freeVaultNumber(
        programFor("devnet"),
        (num) => getSigner(m, num, 0, (d, t) => ((v.progress = [d, t]), app.view === (v as never) && render())),
        (root) => takenRoots.has(hex(root))
      );
      v.n = n;
      v.signer = signer;
      v.stage = "settings";
    } finally {
      m.fill(0);
    }
  } catch (e) {
    v.err = `Could not check the chain for vaults this phrase already has (${errText(e)}). Everything is disabled until this works, so an existing vault is never set up twice.`;
  }
  if (app.view === (v as never)) render();
}

// ---------- form helpers ----------

const seg = (name: string, cur: string, opts: [string, string, string][]) =>
  `<div class="opts">${opts.map(([val, t, d]) => `<button type="button" class="opt ${cur === val ? "on" : ""}" data-a="${name}" data-arg="${esc(val)}"><b>${esc(t)}</b><span>${esc(d)}</span></button>`).join("")}</div>`;
const input = (bind: string, val: string, ph = "", attrs = "") => `<input type="text" data-bind="${esc(bind)}" value="${esc(val)}" placeholder="${esc(ph)}" spellcheck="false" ${attrs}/>`;

function settingsHtml(v: CreateView): string {
  const f = v.form;
  const dao = daoCheck(f.daoAddr);
  const presetNote: Record<string, string> = {
    antitheft: `If someone gets your phrase, they can only take ${ANTITHEFT_INSTANT_SOL} SOL a day at once. Anything more, and every token payout, waits 72 hours. Your recovery phrase can cancel it in that time. Tip: whitelist a wallet of your own that does not use this phrase: payouts to it stay instant.`,
    slow: "Payouts above 0.01 SOL a day wait 72 hours and show as pending on the public page. A recovery key can cancel them.",
    team: "Each co-signer opens nox-vault.com/cosign with their own phrase and sends you a code: paste both below.",
    vesting: "Each co-signer sends a code from nox-vault.com/cosign. Add vesting schedules on nox-vault.com after the vault exists.",
    dao: "The DAO address is the only destination; every other address is refused on chain.",
  };
  const recovery =
    f.recMode === "generate"
      ? !f.recRoot && !v.recWords
        ? `<button type="button" class="btn" data-a="cr-rec-gen" ${v.recBusy ? "disabled" : ""}>${v.recBusy ? "Building…" : "Generate recovery phrase"}</button>`
        : v.recWords
          ? `<div class="note warn">Shown <b>once</b>, never stored by this extension. Write it down and keep it apart from your main phrase (another place or a person you trust). It is the key that cancels a thief's payout. Vault number: <b>${esc(v.n)}</b>.</div>
             ${wordGrid(v.recWords)}
             <div class="row"><label class="field grow1"><span>Word #${(v.recQuiz![0] ?? 0) + 1}</span><input type="text" id="rq0" autocapitalize="off" spellcheck="false"/></label><label class="field grow1"><span>Word #${(v.recQuiz![1] ?? 0) + 1}</span><input type="text" id="rq1" autocapitalize="off" spellcheck="false"/></label></div>
             <button type="button" class="btn primary block" data-a="cr-rec-ok">I wrote it down, stored apart</button>`
          : `<div class="note ok-note">✓ Recovery phrase confirmed and dropped from memory. Root ${esc(short(hex(f.recRoot!), 6))}.</div>`
      : f.recMode === "code"
        ? input("recCode", f.recCode, "64 hex characters from the recovery holder (nox-vault.com/cosign)")
        : "";
  const duress = v.duressWords
    ? `<div class="note warn">Shown <b>once</b>, never stored. Write it down separately from your real phrase.</div>${wordGrid(v.duressWords)}
       <label class="check"><input type="checkbox" data-a="cr-duress-ok"/> <span>The duress phrase is written down.</span></label>`
    : f.duressRoot
      ? `<div class="note ok-note">✓ Duress phrase set. Pays at most ${input("duressSol", f.duressSol, "", 'class="mini"')} SOL, then locks for ${input("duressDays", f.duressDays, "", 'class="mini"')} days.</div><button type="button" class="link" data-a="cr-duress-drop">remove duress phrase</button>`
      : `<button type="button" class="btn ghost" data-a="cr-duress-gen" ${v.duressBusy ? "disabled" : ""}>${v.duressBusy ? "Building…" : "+ Make a duress phrase (optional)"}</button>`;
  return `<div class="stack">
    <div class="field"><span>Start from</span>${seg("cr-preset", f.preset, PRESETS.map(([p, t, d]) => [p, t, d]))}</div>
    ${presetNote[f.preset] ? `<div class="note">${esc(presetNote[f.preset])}</div>` : ""}
    ${f.preset === "dao" ? `<label class="field"><span>DAO address (Squads vault / Realms treasury)</span><input type="text" data-a-input="cr-dao" value="${esc(f.daoAddr)}" spellcheck="false"/></label>${dao && !dao.ok ? `<div class="err">${esc(dao.error)}</div>` : dao?.ok && !dao.pda ? `<div class="warn small">This is an ordinary key, not a program address: check it is the vault / treasury, not a member wallet.</div>` : ""}` : ""}
    <div class="field"><span>Recovery key</span>${seg("cr-rec", f.recMode, [["none", "None", "only your phrase"], ["generate", "Make one", "24 words, shown once"], ["code", "Paste code", "holder made it"]])}</div>
    ${recovery}
    ${f.recMode !== "none" ? `<div class="inline">Full control for recovery after ${input("recDays", f.recDays, "", 'class="mini" inputmode="numeric"')} days of owner inactivity. It can always cancel a pending payout.</div>` : ""}
    ${
      f.preset !== "dao"
        ? `<div class="field"><span>Whitelist (instant, up to 4)</span>${f.whitelist.map((w, i) => input(`whitelist.${i}`, w, "wallet address")).join("")}${f.whitelist.length < 4 ? `<button type="button" class="link" data-a="cr-wl-add">+ add address</button>` : ""}</div>
           <div class="inline">Daily instant limit ${input("instantSol", f.instantSol, "", 'class="mini" inputmode="decimal"')} SOL to other addresses (0 = off).</div>
           ${f.whitelist.some((x) => x.trim()) || Number(f.instantSol) > 0 ? `<div class="inline">Other addresses: ${f.strict ? "<b>refused</b>" : `wait ${input("slowHours", f.slowHours, "", 'class="mini" inputmode="numeric"')} h (cancellable)`} <button type="button" class="link" data-a="cr-strict">${f.strict ? "allow with a wait" : "refuse instead"}</button></div>` : ""}`
        : ""
    }
    ${
      f.coCodes.length
        ? `<div class="field"><span>Co-signer codes (64 hex, from nox-vault.com/cosign)</span>${f.coCodes.map((c, i) => input(`coCodes.${i}`, c, `co-signer ${i + 2} code`)).join("")}
           <div class="inline">Approvals needed: <select data-bind="threshold">${Array.from({ length: f.coCodes.length + 1 }, (_, i) => i + 1).map((n) => `<option value="${n}" ${f.threshold === n ? "selected" : ""}>${n} of ${f.coCodes.length + 1}</option>`).join("")}</select></div></div>`
        : ""
    }
    <div class="field"><span>Testament (optional)</span>${f.heirs.map((h, i) => `<div class="row">${input(`heirs.${i}.addr`, h.addr, "heir wallet")}${input(`heirs.${i}.pct`, h.pct, "%", 'class="mini"')}</div>`).join("")}
      ${f.heirs.length < 4 ? `<button type="button" class="link" data-a="cr-heir-add">+ add heir</button>` : ""}
      ${f.heirs.length ? `<div class="inline">Paid out after ${input("testDays", f.testDays, "", 'class="mini" inputmode="numeric"')} days without owner activity. Shares add up to 100%.</div>` : ""}</div>
    <div class="field"><span>Duress phrase</span>${duress}</div>
    <label class="field"><span>Name in this extension</span><input type="text" data-bind="@label" value="${esc(v.label)}" maxlength="24"/></label>
  </div>`;
}

function summary(c: Config): string {
  const signers = [0, 1, 2].filter((t) => c.trees[t].height > 0).length;
  const rows: [string, string][] = [
    ["Signers", `${signers}${signers > 1 ? ` · ${c.threshold} must approve` : " (you)"} · 256 one-time keys each`],
    ["Recovery", c.trees[RECOVERY_TREE].height ? `yes · may always cancel; full control after ${duration(Number(c.recoveryDelay))} inactive` : "none"],
    ["Whitelist", c.whitelist.length ? c.whitelist.map((k) => short(new PublicKey(k).toBase58(), 4)).join(", ") : "none"],
    [
      "Other addresses",
      !c.whitelist.length && c.instantLimit === 0n
        ? "allowed immediately"
        : `${c.instantLimit > 0n ? `up to ${sol(c.instantLimit)} SOL / 24 h at once, then ` : ""}${c.slowDelay === 0n ? "refused" : `wait ${duration(Number(c.slowDelay))} (cancellable)`}; tokens always wait`,
    ],
    ["Testament", c.heirs.length ? `${c.heirs.length} heir(s) after ${duration(Number(c.testamentDelay))} inactive` : "none"],
    ["Duress", c.duressLimit && cv().form.duressRoot ? `pays ≤ ${sol(c.duressLimit)} SOL, then locks ${duration(Number(c.duressLock))}` : "none (a decoy is stored)"],
    ["$NOX tier needed", TIER_NAMES[tierNeeded(c)]],
  ];
  return `<dl class="kv wide">${rows.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${esc(val)}</dd>`).join("")}</dl>`;
}

defineView(
  "create",
  () => {
    const v = cv();
    const expand = app.tab ? "" : `<button class="btn ghost small" data-a="create-expand" style="float:right">Open in a tab ⤢</button>`;
    const fw = app.data.wallets.find((x) => x.id === v.fromWallet);
    const head = `${back("Vaults", "home")}${expand}<div class="h">Create a vault <span class="grow"></span></div>${
      fw ? `<div class="note ok-note" style="margin-bottom:8px">Protecting <b>${esc(fw.name)}</b>: it pays the creation fee and rent and initializes the vault, then you move funds in. devnet · unaudited.</div>` : ""
    }`;
    if (v.err && v.stage === "loading") return `${head}<div class="alert bad"><p style="margin:0">${esc(v.err)}</p></div><button class="btn block" data-a="cr-retry" style="margin-top:8px">Retry</button>`;
    if (v.stage === "loading")
      return `${head}<div class="panel stack"><div>Building your one-time key tree (256 keys) and checking the chain for vaults this phrase already has…</div>
        <div class="bar"><i style="width:${v.progress ? Math.round((v.progress[0] * 100) / v.progress[1]) : 0}%"></i></div><div class="dim small">${v.progress ? `${v.progress[0]} / ${v.progress[1]}` : ""} · a few seconds the first time</div></div>`;
    const built = buildConfig(v.signer ?? null, v.form, programFor("devnet").programId);
    if (v.stage === "settings")
      return `${head}<div class="panel">${settingsHtml(v)}</div>
        <div style="margin-top:10px">${"error" in built ? `<div class="note warn">${esc(built.error)}</div>` : ""}
        <button class="btn primary block" style="margin-top:8px" data-a="cr-review" ${"error" in built || v.recWords || v.duressWords ? "disabled" : ""}>Review vault</button></div>`;
    if ("error" in built) return `${head}<div class="note warn">${esc(built.error)}</div><button class="btn" data-a="cr-edit">Edit</button>`;
    return `${head}<div class="panel stack">${summary(built.config)}
        <div class="field"><span>Vault address (vault #${esc(v.n)})</span><div class="copybox"><code>${esc(built.vault.toBase58())}</code></div></div>
        <div class="dim small">The address commits to these exact settings: they can never be changed later.</div></div>
      <div class="grid2" style="margin-top:10px"><button class="btn" data-a="cr-edit">Edit</button><button class="btn primary" data-a="cr-save">Save &amp; fund</button></div>`;
  },
  () => {
    const v = cv();
    if (v.stage === "loading" && !v.err && !(v as unknown as { started?: boolean }).started) {
      (v as unknown as { started?: boolean }).started = true;
      void findNumber(v);
    }
  }
);

/** Updates the form from an input with data-bind (called by the global input listener). */
export function bindCreate(path: string, value: string) {
  const v = cv();
  if (path === "@label") return void (v.label = value);
  const f = v.form as unknown as Record<string, unknown>;
  const parts = path.split(".");
  if (parts.length === 1) f[parts[0]] = parts[0] === "threshold" ? Number(value) : value;
  else if (parts.length === 2) (f[parts[0]] as string[])[Number(parts[1])] = value;
  else ((f[parts[0]] as Record<string, string>[])[Number(parts[1])])[parts[2]] = value;
}

/** Live "error / address" without stealing focus: re-render only the button state. */
export function refreshCreateButton() {
  const v = cv();
  if (v.stage !== "settings") return;
  const built = buildConfig(v.signer ?? null, v.form, programFor("devnet").programId);
  const btn = document.querySelector<HTMLButtonElement>("[data-a='cr-review']");
  if (btn) btn.disabled = "error" in built || !!v.recWords || !!v.duressWords;
  const note = btn?.previousElementSibling;
  if (note && note.classList.contains("note")) note.textContent = "error" in built ? built.error : "";
  else if ("error" in built && btn) btn.insertAdjacentHTML("beforebegin", `<div class="note warn">${esc(built.error)}</div>`);
}

on({
  "cr-retry": () => {
    const v = cv();
    v.err = "";
    (v as unknown as { started?: boolean }).started = false;
    render();
  },
  "cr-preset": (el) => {
    const v = cv();
    v.form = applyPreset(v.form, el.dataset.arg as Preset);
    render();
  },
  "cr-rec": (el) => {
    const v = cv();
    v.form = { ...v.form, recMode: el.dataset.arg as CreateForm["recMode"] };
    render();
  },
  "cr-strict": () => {
    const v = cv();
    v.form = { ...v.form, strict: !v.form.strict };
    render();
  },
  "cr-wl-add": () => {
    const v = cv();
    v.form = { ...v.form, whitelist: [...v.form.whitelist, ""] };
    render();
  },
  "cr-heir-add": () => {
    const v = cv();
    v.form = { ...v.form, heirs: [...v.form.heirs, { addr: "", pct: v.form.heirs.length ? "" : "100" }] };
    render();
  },
  "cr-rec-gen": async () => {
    const v = cv();
    if (v.n == null) return;
    v.recBusy = true;
    render();
    const m = newMasterSecret();
    try {
      // SetupVault makeRecovery: a fresh phrase, its recovery tree for this vault number. Built without the cache.
      const s = await buildSignerUncached(m, v.n, RECOVERY_TREE);
      v.recWords = secretToWords(m);
      const q = new Set<number>();
      while (q.size < 2) q.add(crypto.getRandomValues(new Uint32Array(1))[0] % 24);
      v.recQuiz = [...q].sort((a, b) => a - b);
      v.form = { ...v.form, recRoot: s.pub.root, recHanded: false };
      s.seeds.skSeed.fill(0);
    } finally {
      m.fill(0);
      v.recBusy = false;
      render();
    }
  },
  "cr-rec-ok": () => {
    const v = cv();
    const list = (v.recWords ?? "").split(" ");
    const a = (document.getElementById("rq0") as HTMLInputElement | null)?.value.trim().toLowerCase();
    const b = (document.getElementById("rq1") as HTMLInputElement | null)?.value.trim().toLowerCase();
    if (a !== list[v.recQuiz![0]] || b !== list[v.recQuiz![1]]) return toast("Those words do not match. Check your copy.");
    v.recWords = null; // dropped: the extension never sees it again
    v.form = { ...v.form, recHanded: true };
    render();
  },
  "cr-duress-gen": async () => {
    const v = cv();
    v.duressBusy = true;
    render();
    const m = newMasterSecret();
    try {
      // SetupVault makeDuress: vault number 0 of a fresh phrase, in the duress seed range.
      const s = await buildSignerUncached(m, 0, DURESS_TREE);
      v.duressWords = secretToWords(m);
      v.form = { ...v.form, duressRoot: s.pub.root, duressHanded: false };
      s.seeds.skSeed.fill(0);
    } finally {
      m.fill(0);
      v.duressBusy = false;
      render();
    }
  },
  "cr-duress-ok": () => {
    const v = cv();
    v.duressWords = null;
    v.form = { ...v.form, duressHanded: true };
    render();
  },
  "cr-duress-drop": () => {
    const v = cv();
    v.duressWords = null;
    v.form = { ...v.form, duressRoot: null, duressHanded: false };
    render();
  },
  "cr-review": () => {
    cv().stage = "review";
    render();
  },
  "cr-edit": () => {
    cv().stage = "settings";
    render();
  },
  "cr-save": async () => {
    const v = cv();
    const built = buildConfig(v.signer ?? null, v.form, programFor("devnet").programId);
    if ("error" in built) return toast(built.error);
    const { watched } = await load("watched");
    if (watched.length >= MAX_WATCHED) return toast(`Up to ${MAX_WATCHED} vaults.`);
    const w: Watched = {
      address: built.vault.toBase58(),
      cluster: "devnet",
      label: v.label.trim().slice(0, 24) || `Vault ${v.n}`,
      addedAt: Math.floor(Date.now() / 1000),
      role: "owner",
      accountId: v.accountId,
      vaultNumber: v.n,
      slot: 0,
      config: configToJson(built.config),
      preset: v.form.preset,
    };
    const key = watchKey(w);
    const next = watched.filter((x) => watchKey(x) !== key);
    await save({ watched: [...next, w], settings: { ...app.data.settings, cluster: "devnet" } });
    app.data.watched = [...next, w];
    app.data.settings = { ...app.data.settings, cluster: "devnet" };
    void send({ type: "refresh", only: [key] });
    go({ name: "fund", key, fromWallet: v.fromWallet ?? null });
  },
});

// ---------- fund + initialize ----------

interface FundView {
  name: "fund";
  key: string;
  balance?: number | null;
  initialized?: boolean | null;
  tier?: { tier: number; tiersOn: boolean; held: bigint } | null;
  feeAddress?: string | null;
  feeBalance?: number | null;
  /** v0.3: name of the wallet account that pays */
  feeName?: string | null;
  fromWallet?: string | null;
  createFee?: bigint;
  busy?: string | null;
  msg?: { ok: boolean; text: string; sig?: string } | null;
  timer?: number;
}

const fv = () => app.view as unknown as FundView;

async function pollFund(v: FundView) {
  const w = findVault(v.key);
  if (!w || app.view !== (v as never)) return;
  const conn = connFor(w.cluster);
  const vault = new PublicKey(w.address);
  try {
    const [bal, st, tier] = await Promise.all([conn.getBalance(vault, "confirmed"), fetchState(programFor(w.cluster), vault), tierOf(w.cluster, vault)]);
    v.balance = bal;
    v.initialized = !!st;
    v.tier = tier;
    if (w.accountId && app.unlocked) {
      const p = await payerOf(w.accountId).catch(() => null);
      v.feeAddress = p?.kp.publicKey.toBase58() ?? null;
      v.feeName = p?.wallet.name ?? null;
      v.feeBalance = p ? await conn.getBalance(p.kp.publicKey, "confirmed").catch(() => null) : null;
    }
    const p =await fetchProtocol(programFor(w.cluster)).catch(() => null);
    v.createFee = p?.createFee ?? 0n;
  } catch {
    /* keep last values */
  }
  if (app.view === (v as never)) render();
}

defineView(
  "fund",
  () => {
    const v = fv();
    const w = findVault(v.key);
    if (!w || !w.config) return `${back("Vaults", "home")}<div class="panel">No saved config for this vault.</div>`;
    const config = configFromJson(w.config);
    const need = tierNeeded(config);
    const tierOk = !v.tier || !v.tier.tiersOn || v.tier.tier >= need;
    const freeFee = v.tier && v.tier.tiersOn && v.tier.tier === TIER_FREE ? v.createFee ?? 0n : 0n;
    const bal = v.balance ?? null;
    const relayOk = !v.initialized && tierOk && (bal ?? 0) >= RELAY_INIT_MIN && !(v.tier?.tiersOn && v.tier.tier < 1);
    const feeOk = !v.initialized && tierOk && (v.feeBalance ?? 0) > 8_000_000 + Number(freeFee);
    const wname = esc(v.feeName ?? "your wallet");
    return `${back(w.label, "detail", v.key)}<div class="h">Fund &amp; initialize <span class="grow"></span></div>
      <div class="qr small">${qrSvg(w.address)}</div>
      <div class="copybox"><code>${esc(w.address)}</code><button class="btn" data-a="copy" data-arg="${esc(w.address)}">Copy</button></div>
      <div class="panel" style="margin-top:8px"><dl class="kv">
        <dt>Status</dt><dd class="${v.initialized ? "ok" : "warn"}">${v.initialized == null ? "checking…" : v.initialized ? "initialized" : "not initialized"}</dd>
        <dt>Balance</dt><dd>${bal == null ? "…" : `${solNum(bal)} SOL`}</dd>
        <dt>$NOX tier</dt><dd>${v.tier ? (v.tier.tiersOn ? TIER_NAMES[v.tier.tier] : "tiers off") : "…"} · needs ${TIER_NAMES[need]}</dd>
      </dl></div>
      ${
        v.initialized
          ? `<div class="alert okc" style="margin-top:8px"><div class="t">✓ READY</div><p style="margin:4px 0 0">The vault is live. Deposits can come from any wallet or exchange.</p></div><button class="btn primary block" style="margin-top:8px" data-a="wmove-start" data-arg="${esc(v.key)}">Move funds in from my wallet</button><button class="btn block" style="margin-top:8px" data-a="detail" data-arg="${esc(v.key)}">Open vault</button>`
          : `<div class="stack" style="margin-top:8px">
        <div class="note">Your wallet signs and pays: one transaction initializes the vault${freeFee > 0n ? ` (Free tier: ${sol(freeFee)} SOL creation fee + rent ≈ 0.006 SOL)` : " (rent ≈ 0.006 SOL)"}, no relayer needed. Then you move funds in. Without wallet SOL: send ≥ 0.02 SOL to the vault from anywhere and let the relayer initialize it (Guardian tier).</div>
        <button class="btn ${feeOk ? "primary" : ""}" data-a="fund-fee" ${feeOk && !v.busy ? "" : "disabled"}>${v.busy === "fee" ? "Sending…" : `Create with ${wname} (pays fee + rent)`}</button>
        <div class="dim small">Payer ${v.feeAddress ? `${wname} <button class="link" data-a="copy" data-arg="${esc(v.feeAddress)}">${esc(short(v.feeAddress, 4))}</button> · ${solNum(v.feeBalance ?? 0)} devnet SOL` : "(unlock to see it)"}. It only pays network fees and rent; it gets no power over the vault.</div>
        <button class="btn ${feeOk ? "" : "primary"}" data-a="fund-relayer" ${relayOk && !v.busy ? "" : "disabled"}>${v.busy === "relayer" ? "Asking relayer…" : "Or: initialize via relayer (free)"}</button>
        ${app.data.settings.cluster === "devnet" || w.cluster === "devnet" ? `<button class="btn ghost" data-a="fund-faucet" ${v.busy ? "disabled" : ""}>${v.busy === "faucet" ? "Sending…" : "Get test $NOX (devnet, Sentinel tier)"}</button>` : ""}
        ${!tierOk ? `<div class="note warn">These settings need the ${TIER_NAMES[need]} tier: send $NOX to the vault first${need === TIER_SENTINEL ? " (multi-signer)" : " (testament)"}.</div>` : ""}
      </div>`
      }
      ${v.msg ? `<div class="${v.msg.ok ? "note ok-note" : "err"}" style="margin-top:8px">${esc(v.msg.text)}</div>` : ""}
      <div class="row" style="margin-top:10px"><button class="btn ghost small" data-a="export-config" data-arg="${esc(v.key)}">Export config backup</button></div>`;
  },
  () => {
    const v = fv();
    if (v.timer) return;
    void pollFund(v);
    v.timer = window.setInterval(() => (app.view === (v as never) ? void pollFund(v) : clearInterval(v.timer)), 6000);
  }
);

on({
  "fund-open": (el) => go({ name: "fund", key: el.dataset.arg }),
  "fund-faucet": async () => {
    const v = fv();
    const w = findVault(v.key)!;
    v.busy = "faucet";
    v.msg = null;
    render();
    try {
      const r = await faucet(w.address);
      v.msg = { ok: true, text: `Sent ${r.amount.toLocaleString("en-US")} test $NOX to the vault.`, sig: r.signature };
    } catch (e) {
      v.msg = { ok: false, text: errText(e) };
    }
    v.busy = null;
    await pollFund(v);
  },
  "fund-relayer": async () => {
    const v = fv();
    const w = findVault(v.key)!;
    v.busy = "relayer";
    v.msg = null;
    render();
    try {
      const r = await initViaRelayer(configFromJson(w.config!));
      v.msg = { ok: true, text: r.already ? "This vault was already initialized." : "The relayer initialized your vault.", sig: r.signature };
      void send({ type: "refresh", only: [v.key] });
    } catch (e) {
      v.msg = { ok: false, text: errText(e) };
    }
    v.busy = null;
    await pollFund(v);
  },
  "fund-fee": async () => {
    const v = fv();
    const w = findVault(v.key)!;
    v.busy = "fee";
    v.msg = null;
    render();
    try {
      if (!w.accountId) throw new Error("No account for this vault");
      const { kp, wallet } = await payerOf(w.accountId);
      const sig = await initWithFeeAccount(programFor(w.cluster), kp, configFromJson(w.config!));
      v.msg = { ok: true, text: `Vault initialized by ${wallet.name}. tx ${sig.slice(0, 12)}…`, sig };
      void send({ type: "refresh", only: [v.key] });
      if (v.fromWallet && app.view === (v as never)) {
        v.busy = null;
        return startMove(v.key, wallet.id, true, sig);
      }
    } catch (e) {
      v.msg = { ok: false, text: errText(e) };
    }
    v.busy = null;
    await pollFund(v);
  },
});

/** Inputs that need more than a plain field update (data-a-input). */
export function onCreateInput(name: string, value: string) {
  const v = cv();
  if (name === "cr-dao") v.form = changeDao(v.form, value);
}
