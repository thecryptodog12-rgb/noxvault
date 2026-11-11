// Onboarding (like MetaMask): create a phrase (show → confirm 3 words) or import one, set a
// password, find the phrase's existing vaults. Also the lock screen and "add account".
// The words live only in this view's state until the keyring is encrypted, then are dropped.
import { DURESS_TREE, newMasterSecret, secretToWords } from "../../../sdk/client";
import { cleanPhrase, addAccount, createWallet, failDelaySecs, resetWallet, unlockWallet } from "../core/wallet";
import { MIN_PASSWORD, WrongPasswordError, passwordProblem } from "../core/keyring";
import { getSigner } from "../core/trees";
import { discoverVaults } from "../core/vaults";
import { load, save, MAX_WATCHED } from "../lib/store";
import { watchKey, type Watched } from "../lib/types";
import { app, defineView, errText, esc, go, needMaster, on, programFor, reload, render, toast } from "./core";

const hexSvg = `<svg class="hex" viewBox="0 0 32 32" fill="none"><path d="M16 2.5 27.7 9.25v13.5L16 29.5 4.3 22.75V9.25L16 2.5Z" stroke="#2ee6d6" stroke-width="1.4" stroke-linejoin="round"/><path d="M16 8.5 22.5 16 16 23.5 9.5 16 16 8.5Z" stroke="#2ee6d6" stroke-width="1.1" stroke-linejoin="round"/></svg>`;

function pick3(): number[] {
  const s = new Set<number>();
  const r = new Uint32Array(8);
  while (s.size < 3) {
    crypto.getRandomValues(r);
    for (const x of r) if (s.size < 3) s.add(x % 24);
  }
  return [...s].sort((a, b) => a - b);
}

export const wordGrid = (words: string, blur = false) =>
  `<ol class="words ${blur ? "blur" : ""}">${words
    .split(" ")
    .map((w, i) => `<li><span class="n">${i + 1}</span><span>${esc(w)}</span></li>`)
    .join("")}</ol>`;

// ---------- welcome ----------

defineView("welcome", () => {
  const watching = app.data.watched.length;
  return `<div class="empty">${hexSvg}<h2>Noxvault wallet</h2>
    <p>Quantum-safe vaults on Solana. Every action is signed with a one-time key from your 24-word phrase.</p>
    <div class="stack">
      <button class="btn primary block" data-a="ob-new">Create a new phrase</button>
      <button class="btn block" data-a="ob-import">I already have a phrase</button>
      ${watching ? `<button class="btn ghost block" data-a="ob-watch">Continue watch-only (${watching} vault${watching > 1 ? "s" : ""})</button>` : ""}
    </div>
    <div class="note warn" style="margin-top:14px;text-align:left">Devnet only, unaudited software. Use test SOL. Your phrase is stored encrypted on this device and never leaves it.</div></div>`;
});

on({
  "ob-new": () => {
    const master = newMasterSecret();
    go({ name: "ob-show", master, words: secretToWords(master), revealed: false, wrote: false, adding: !!app.view.adding });
  },
  "ob-import": () => go({ name: "ob-import", adding: !!app.view.adding }),
  "ob-watch": () => go({ name: "home" }),
});

// ---------- show new words ----------

defineView("ob-show", () => {
  const v = app.view;
  return `<button class="btn ghost back" data-a="${v.adding ? "settings" : "ob-welcome"}">← Back</button>
    <div class="h">Your new phrase <span class="grow"></span></div>
    <div class="note warn">Write these 24 words on paper, in order. They are the only way back into your vaults. Do not screenshot them or paste them anywhere.</div>
    <div class="reveal-wrap">${wordGrid(v.words, !v.revealed)}${v.revealed ? "" : `<button class="btn primary reveal" data-a="ob-reveal">Reveal words</button>`}</div>
    <label class="check"><input type="checkbox" data-a="ob-wrote" ${v.wrote ? "checked" : ""} ${v.revealed ? "" : "disabled"}/> <span>I wrote these 24 words down, in order, offline.</span></label>
    <div class="grid2"><button class="btn ghost" data-a="ob-new">New words</button><button class="btn primary" data-a="ob-to-quiz" ${v.wrote ? "" : "disabled"}>Continue</button></div>`;
});

on({
  "ob-welcome": () => go({ name: "welcome" }),
  "ob-reveal": () => {
    app.view.revealed = true;
    render();
  },
  "ob-wrote": (el) => {
    app.view.wrote = (el as HTMLInputElement).checked;
    render();
  },
  "ob-to-quiz": () => {
    const v = app.view;
    go({ name: "ob-quiz", master: v.master, words: v.words, idx: pick3(), err: false, adding: v.adding });
  },
});

// ---------- confirm 3 words ----------

defineView("ob-quiz", () => {
  const v = app.view;
  return `<button class="btn ghost back" data-a="ob-back-show">← Back to words</button>
    <div class="h">Check your copy <span class="grow"></span></div>
    <form class="panel stack" data-a="ob-quiz" autocomplete="off">
      <p class="muted" style="margin:0">From your paper copy, type these three words.</p>
      ${(v.idx as number[])
        .map((ix, k) => `<label class="field"><span>Word #${ix + 1}</span><input type="text" name="w${k}" autocapitalize="off" spellcheck="false" ${k === 0 ? "autofocus" : ""}/></label>`)
        .join("")}
      ${v.err ? `<div class="err">That does not match. Check your copy.</div>` : ""}
      <button class="btn primary block" type="submit">Confirm</button>
    </form>`;
});

on({
  "ob-back-show": () => {
    const v = app.view;
    go({ name: "ob-show", master: v.master, words: v.words, revealed: true, wrote: true, adding: v.adding });
  },
  "ob-quiz": (form) => {
    const v = app.view;
    const list = (v.words as string).split(" ");
    const fd = new FormData(form as HTMLFormElement);
    const ok = (v.idx as number[]).every((ix, k) => String(fd.get(`w${k}`) ?? "").trim().toLowerCase() === list[ix]);
    if (!ok) {
      v.err = true;
      return render();
    }
    go({ name: "ob-password", words: v.words, master: v.master, imported: false, adding: v.adding });
  },
});

// ---------- import ----------

defineView("ob-import", () => {
  const v = app.view;
  return `<button class="btn ghost back" data-a="${v.adding ? "settings" : "ob-welcome"}">← Back</button>
    <div class="h">Import a phrase <span class="grow"></span></div>
    <form class="panel stack" data-a="ob-import-submit" autocomplete="off">
      <label class="field"><span>Your 24-word Noxvault phrase</span><textarea name="words" rows="4" class="secret" autocapitalize="off" spellcheck="false" autofocus></textarea></label>
      ${v.err ? `<div class="err">${esc(v.err)}</div>` : ""}
      <button class="btn primary block" type="submit">Continue</button>
      <div class="dim small">Numbered lists, commas and line breaks are fine. Checked on this device; nothing is sent.</div>
    </form>`;
});

on({
  "ob-import-submit": (form) => {
    const ta = (form as HTMLFormElement).elements.namedItem("words") as HTMLTextAreaElement;
    try {
      const { words, master } = cleanPhrase(ta.value);
      ta.value = "";
      go({ name: "ob-password", words, master, imported: true, adding: app.view.adding });
    } catch (e) {
      ta.value = "";
      app.view.err = errText(e);
      render();
    }
  },
});

// ---------- password ----------

defineView("ob-password", () => {
  const v = app.view;
  if (v.adding)
    return `<div class="h">Add account <span class="grow"></span></div>
      <form class="panel stack" data-a="ob-add-submit" autocomplete="off">
        <label class="field"><span>Account name</span><input type="text" name="name" maxlength="24" value="Account ${app.data.accounts.length + 1}"/></label>
        <label class="field"><span>Your wallet password</span><input type="password" name="pw" autofocus/></label>
        ${v.err ? `<div class="err">${esc(v.err)}</div>` : ""}
        <button class="btn primary block" type="submit" ${v.busy ? "disabled" : ""}>${v.busy ? "Encrypting…" : "Add account"}</button>
      </form>`;
  return `<div class="h">Set a password <span class="grow"></span></div>
    <form class="panel stack" data-a="ob-pw-submit" autocomplete="off">
      <p class="muted" style="margin:0">It unlocks this extension on this device. It encrypts your phrase; it is not your phrase. If you forget it, you can reset and import the phrase again.</p>
      <label class="field"><span>Password (${MIN_PASSWORD}+ characters)</span><input type="password" name="pw" autofocus/></label>
      <label class="field"><span>Repeat password</span><input type="password" name="pw2"/></label>
      ${v.err ? `<div class="err">${esc(v.err)}</div>` : ""}
      <button class="btn primary block" type="submit" ${v.busy ? "disabled" : ""}>${v.busy ? "Encrypting…" : "Create wallet"}</button>
    </form>
    <div class="note" style="margin-top:10px">Stored: your phrase, encrypted (AES-256-GCM, key from PBKDF2-SHA256 with 600 000 iterations). It locks after ${app.data.settings.autoLockMin} minutes idle and when the browser closes.</div>`;
});

async function afterKeys(imported: boolean, master: Uint8Array) {
  await reload();
  if (imported) return go({ name: "ob-scan", master: new Uint8Array(master), accountId: app.data.activeAccount, found: null, n: 0 });
  go({ name: "home" });
}

on({
  "ob-pw-submit": async (form) => {
    const v = app.view;
    const fd = new FormData(form as HTMLFormElement);
    const pw = String(fd.get("pw") ?? "");
    const problem = passwordProblem(pw, String(fd.get("pw2") ?? ""));
    if (problem) {
      v.err = problem;
      return render();
    }
    v.busy = true;
    v.err = "";
    render();
    try {
      await createWallet(v.words, pw);
      toast("Wallet created and unlocked");
      await afterKeys(v.imported, v.master);
    } catch (e) {
      v.busy = false;
      v.err = errText(e);
      render();
    }
  },
  "ob-add-submit": async (form) => {
    const v = app.view;
    const fd = new FormData(form as HTMLFormElement);
    v.busy = true;
    v.err = "";
    render();
    try {
      await addAccount(v.words, String(fd.get("pw") ?? ""), String(fd.get("name") ?? ""));
      toast("Account added");
      await afterKeys(v.imported, v.master);
    } catch (e) {
      v.busy = false;
      v.err = e instanceof WrongPasswordError ? "Wrong password." : errText(e);
      render();
    }
  },
});

// ---------- find existing vaults of an imported phrase ----------

defineView(
  "ob-scan",
  () => {
    const v = app.view;
    if (v.err)
      return `<div class="h">Finding your vaults <span class="grow"></span></div><div class="panel stack"><div class="err">${esc(v.err)}</div>
        <div class="grid2"><button class="btn" data-a="ob-scan-retry">Retry</button><button class="btn ghost" data-a="home">Skip</button></div></div>`;
    if (!v.found)
      return `<div class="h">Finding your vaults <span class="grow"></span></div><div class="panel stack">
        <div>Building the key tree of vault number ${esc(v.n)} and asking the chain which vaults use it…</div>
        <div class="bar"><i style="width:${Math.round((v.done ?? 0) * 100 / (v.total || 1))}%"></i></div>
        <div class="dim small">A few seconds per vault number the first time; only public data is cached.</div></div>`;
    const list = v.found as { address: string; role: string; n: number }[];
    return `<div class="h">Your vaults <span class="grow"></span></div><div class="panel stack">
      ${list.length ? list.map((f) => `<div class="row between"><span>${esc(f.address.slice(0, 4))}…${esc(f.address.slice(-4))}</span><span class="dim">${esc(f.role)} · #${f.n}</span></div>`).join("") : "<div>No vault uses this phrase yet. Create one from the home screen.</div>"}
      <button class="btn primary block" data-a="home">Done</button></div>`;
  },
  () => {
    const v = app.view;
    if (!v.found && !v.err && !v.running) void scan();
  }
);

async function scan() {
  const v = app.view;
  v.running = true;
  const master: Uint8Array = v.master;
  const accountId: string = v.accountId;
  const cluster = "devnet" as const;
  try {
    const found = await discoverVaults(
      programFor(cluster),
      (n, slot) =>
        getSigner(master, n, slot === DURESS_TREE ? DURESS_TREE : 0, (done, total) => {
          if (app.view !== v) return;
          v.done = done;
          v.total = total;
          v.n = n;
          render();
        }),
      (n) => ((v.n = n), app.view === v && render())
    );
    const { watched } = await load("watched");
    const have = new Set(watched.map(watchKey));
    const add: Watched[] = [];
    for (const f of found) {
      const slot = f.signer.tree;
      const w: Watched = {
        address: f.state.vault.toBase58(),
        cluster,
        label: slot === DURESS_TREE ? `Duress ${f.n}` : slot === 0 ? `Vault ${f.n}` : `Co-signed ${f.n}`,
        addedAt: Math.floor(Date.now() / 1000),
        role: slot === DURESS_TREE ? "duress" : slot === 0 ? "owner" : "cosigner",
        accountId,
        vaultNumber: f.n,
        slot,
      };
      if (!have.has(watchKey(w))) add.push(w);
      else {
        // An address watched in v0.1 becomes an owned vault.
        const i = watched.findIndex((x) => watchKey(x) === watchKey(w));
        watched[i] = { ...watched[i], role: w.role, accountId, vaultNumber: f.n, slot };
      }
    }
    await save({ watched: [...watched, ...add].slice(0, MAX_WATCHED) });
    await reload();
    if (app.view === v) {
      v.found = found.map((f) => ({ address: f.state.vault.toBase58(), role: f.signer.tree === 0 ? "owner" : f.signer.tree === DURESS_TREE ? "duress" : "co-signer", n: f.n }));
      void chrome.runtime.sendMessage({ type: "refresh" }).catch(() => {});
      render();
    }
  } catch (e) {
    if (app.view === v) {
      v.err = `Could not search the chain (${errText(e)}). Searching needs an RPC that allows getProgramAccounts.`;
      render();
    }
  } finally {
    v.running = false;
  }
}

on({
  "ob-scan-retry": () => {
    const v = app.view;
    v.err = "";
    render();
  },
});

/** Re-scan from settings for the active account. */
export async function rescan(accountId: string) {
  const m = await needMaster(accountId);
  go({ name: "ob-scan", master: m, accountId, found: null, n: 0 });
}

// ---------- lock screen ----------

defineView("lock", () => {
  const v = app.view;
  if (v.reset)
    return `<div class="empty">${hexSvg}<h2>Reset this extension?</h2>
      <p>This deletes the encrypted phrases and the vaults they own from this browser. Your vaults stay on chain: import your phrase again to get them back. Without your phrase, the funds are gone.</p>
      <div class="stack"><button class="btn danger block" data-a="lock-reset-yes">Delete and start over</button><button class="btn ghost block" data-a="lock-reset-no">Cancel</button></div></div>`;
  return `<div class="empty">${hexSvg}<h2>Unlock</h2><p>Enter your password to sign. Watching and alerts keep running while locked.</p>
    <form class="stack" data-a="lock-submit" autocomplete="off" style="text-align:left">
      <input type="password" name="pw" placeholder="Password" autofocus/>
      ${v.err ? `<div class="err">${esc(v.err)}</div>` : ""}
      <button class="btn primary block" type="submit" ${v.busy ? "disabled" : ""}>${v.busy ? "Unlocking…" : "Unlock"}</button>
    </form>
    <div class="stack" style="margin-top:12px"><button class="btn ghost block" data-a="home-locked">View vaults (read-only)</button><button class="btn ghost block small" data-a="lock-reset">Forgot password?</button></div></div>`;
});

on({
  "lock-submit": async (form) => {
    const v = app.view;
    const input = (form as HTMLFormElement).elements.namedItem("pw") as HTMLInputElement;
    const pw = input.value;
    input.value = "";
    v.busy = true;
    v.err = "";
    render();
    try {
      await unlockWallet(pw);
      await reload();
      const next = v.next ?? { name: "home" };
      go(next);
    } catch (e) {
      const { unlockFails } = await load("unlockFails");
      v.busy = false;
      v.err = e instanceof WrongPasswordError ? `Wrong password.${failDelaySecs(unlockFails.count) ? ` Wait ${failDelaySecs(unlockFails.count)} s before the next try.` : ""}` : errText(e);
      render();
    }
  },
  "home-locked": () => go({ name: "home" }),
  "lock-reset": () => {
    app.view.reset = true;
    render();
  },
  "lock-reset-no": () => {
    app.view.reset = false;
    render();
  },
  "lock-reset-yes": async () => {
    await resetWallet();
    await reload();
    go({ name: "welcome" });
  },
});
