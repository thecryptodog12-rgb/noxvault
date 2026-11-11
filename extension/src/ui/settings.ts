// Settings: network + RPC, auto-lock, alerts; accounts (rename, reveal phrase behind the password,
// fee account, find vaults, remove, add); lock now; export config backups; reset.
import { PublicKey } from "@solana/web3.js";
import { WrongPasswordError } from "../core/keyring";
import { removeAccount, renameAccount, resetWallet, revealPhrase } from "../core/wallet";
import { CLUSTER_LABEL, rpcOriginPattern, shortAddr } from "../lib/net";
import { qrSvg } from "../lib/qr";
import { save } from "../lib/store";
import { AUTOLOCK_CHOICES, type ClusterId, type Settings } from "../lib/types";
import { app, back, connFor, defineView, errText, esc, go, on, reload, render, send, solNum, toast } from "./core";
import { rescan, wordGrid } from "./onboard";
import { downloadJson } from "./vaults";

async function setSettings(patch: Partial<Settings>) {
  app.data.settings = { ...app.data.settings, ...patch };
  await save({ settings: app.data.settings });
  await send({ type: "settings" });
  render();
}

defineView(
  "settings",
  () => {
    const v = app.view;
    const s = app.data.settings;
    const segs = (["devnet", "mainnet-beta", "custom"] as ClusterId[])
      .map((c) => `<button type="button" class="${s.cluster === c ? "on" : ""}" data-a="set-cluster" data-arg="${c}">${esc(c === "mainnet-beta" ? "mainnet" : CLUSTER_LABEL[c])}</button>`)
      .join("");
    const ints = [1, 2, 5].map((m) => `<button type="button" class="${s.intervalMin === m ? "on" : ""}" data-a="set-interval" data-arg="${m}">${m} min</button>`).join("");
    const locks = AUTOLOCK_CHOICES.map((m) => `<button type="button" class="${s.autoLockMin === m ? "on" : ""}" data-a="set-autolock" data-arg="${m}">${m} min</button>`).join("");
    const accounts = app.data.accounts
      .map(
        (a) => `<div class="acct-row"><div><div class="name">${esc(a.name)} ${a.id === app.data.activeAccount ? '<span class="role">ACTIVE</span>' : ""}</div><div class="dim small">fingerprint ${esc(a.fingerprint)} · ${app.data.wallets.filter((x) => x.phraseId === a.id).length} wallet account(s)</div></div><button class="btn" data-a="acct-open" data-arg="${esc(a.id)}">Manage</button></div>`
      )
      .join("");
    const wsegs = (["mainnet-beta", "devnet"] as const)
      .map((c) => `<button type="button" class="${s.walletCluster === c ? "on" : ""}" data-a="set-wcluster" data-arg="${c}">${c === "mainnet-beta" ? "mainnet" : "devnet"}</button>`)
      .join("");
    return `${back("Home", "home")}
    <div class="h">Wallet <span class="grow"></span></div>
    <div class="panel stack">
      <div><div class="dim small" style="margin-bottom:4px">WALLET NETWORK (HOLDINGS, SEND)</div><div class="seg">${wsegs}</div></div>
      <form class="stack" data-a="mrpc-form"><label class="field"><span>Own mainnet RPC (optional, https)</span><input type="url" name="rpc" value="${esc(s.mainnetRpc)}" placeholder="${esc("https://api.mainnet-beta.solana.com")}" spellcheck="false" /></label>
        ${v.mErr ? `<div class="err">${esc(v.mErr)}</div>` : ""}<button class="btn block" type="submit">Save mainnet RPC</button></form>
      <button class="btn block" data-a="wallets">Wallet accounts (${app.data.wallets.length})</button>
      <div class="dim small">Wallet accounts are ordinary Solana keys and work on mainnet. They are <b>not quantum-safe</b>; vaults are (devnet only for now). Prices come from Jupiter (mainnet only): the mints you hold are sent to lite-api.jup.ag.</div>
    </div>
    <div class="h">Connected sites <span class="grow"></span></div>
    <div class="panel stack"><div class="muted small">No sites can connect yet. A dApp connection (window.solana / Wallet Standard) comes in a later version; until then no website can see your addresses or ask this wallet to sign.</div></div>
    <div class="h">Vault network <span class="grow"></span></div>
    <div class="panel stack">
      <div class="seg">${segs}</div>
      ${s.cluster === "mainnet-beta" ? `<div class="note warn"><b>Not live yet.</b> The Noxvault program runs on devnet only. On mainnet every address shows as "not a vault" and signing is off.</div>` : ""}
      ${
        s.cluster === "custom"
          ? `<form class="stack" data-a="rpc-form"><label class="field"><span>Custom RPC URL (https, devnet)</span><input type="url" name="rpc" value="${esc(s.customRpc)}" placeholder="https://devnet.helius-rpc.com/?api-key=…" spellcheck="false" /></label>
             ${v.err ? `<div class="err">${esc(v.err)}</div>` : ""}<button class="btn block" type="submit">Save &amp; allow this RPC</button>
             <div class="dim small">Chrome asks for access to that one host. Use a devnet RPC: the relayer and the program are on devnet.</div></form>`
          : ""
      }
    </div>
    ${
      app.data.keyring
        ? `<div class="h">Security <span class="grow"></span></div>
    <div class="panel stack">
      <div><div class="dim small" style="margin-bottom:4px">AUTO-LOCK AFTER IDLE</div><div class="seg">${locks}</div></div>
      <div class="dim small">Also locks when the browser closes. Locked: alerts keep running; signing needs the password.</div>
      ${app.unlocked ? `<button class="btn block" data-a="lock-now">Lock now</button>` : `<button class="btn block" data-a="go-lock">Unlock</button>`}
    </div>
    <div class="h">Phrases (vault keys) <span class="grow"></span></div>
    <div class="panel stack">${accounts}
      <div class="grid2"><button class="btn" data-a="acct-add-new" ${app.unlocked ? "" : "disabled"}>+ New phrase</button><button class="btn" data-a="acct-add-import" ${app.unlocked ? "" : "disabled"}>+ Import phrase</button></div>
    </div>`
        : `<div class="h">Wallet <span class="grow"></span></div><div class="panel stack"><div class="muted">No wallet set up: this extension only watches.</div><button class="btn primary block" data-a="ob-welcome">Set up a wallet</button></div>`
    }
    <div class="h">Alerts <span class="grow"></span></div>
    <div class="panel stack">
      <label class="switch"><span>Desktop notifications</span><input type="checkbox" data-a="set-notify" ${s.notify ? "checked" : ""} /></label>
      <div><div class="dim small" style="margin-bottom:4px">CHECK EVERY</div><div class="seg">${ints}</div></div>
      <div class="note">One notification per event: a new pending withdrawal or migration, a lockdown, an inactivity clock under 14, 3 or 1 days, a sealed letter opening within a week.</div>
    </div>
    <div class="h">Backups <span class="grow"></span></div>
    <div class="panel stack">
      <button class="btn block" data-a="export-all">Export all vault configs (JSON)</button>
      <div class="dim small">Public data: the rules of each vault, enough to initialize one later. Your phrase is backed up only by writing it down.</div>
    </div>
    <div class="h">About <span class="grow"></span></div>
    <div class="panel stack muted small">
      <div>Stored on this device: vault addresses, labels, settings, public vault data, and your phrases <b>encrypted</b> with your password. Recovery and duress phrases are never stored. No accounts, no analytics, no servers of ours; the relayer on nox-vault.com only sees finished signatures.</div>
      <div class="dim">Noxvault · devnet · unaudited · v${esc(chrome.runtime.getManifest().version)}</div>
      ${app.data.keyring ? `<button class="btn danger block" data-a="reset-ask">${v.confirmReset ? "Click again: delete phrases from this browser" : "Reset wallet"}</button>` : ""}
    </div>`;
  }
);

on({
  settings: () => go({ name: "settings" }),
  "set-cluster": (el) => void setSettings({ cluster: el.dataset.arg as ClusterId }),
  "set-wcluster": (el) => void setSettings({ walletCluster: el.dataset.arg as Settings["walletCluster"] }),
  "mrpc-form": (form) => {
    const url = String(new FormData(form as HTMLFormElement).get("rpc") ?? "").trim();
    if (!url) {
      app.view.mErr = "";
      return void setSettings({ mainnetRpc: "" });
    }
    const pattern = rpcOriginPattern(url);
    if (!pattern) {
      app.view.mErr = "Use an https:// RPC URL.";
      return render();
    }
    chrome.permissions
      .request({ origins: [pattern] })
      .then(async (ok) => {
        app.view.mErr = ok ? "" : "Chrome did not grant access to that host.";
        if (ok) {
          await setSettings({ mainnetRpc: url });
          toast("Mainnet RPC saved");
        } else render();
      })
      .catch((err) => ((app.view.mErr = String(err?.message ?? err)), render()));
  },
  "set-interval": (el) => void setSettings({ intervalMin: Number(el.dataset.arg) }),
  "set-autolock": (el) => void setSettings({ autoLockMin: Number(el.dataset.arg) }),
  "set-notify": (el) => void setSettings({ notify: (el as HTMLInputElement).checked }),
  "lock-now": async () => {
    await send({ type: "lock" });
    await reload();
    toast("Locked");
    go({ name: "home" });
  },
  "acct-add-new": () => go({ name: "welcome-add", adding: true }),
  "acct-add-import": () => go({ name: "ob-import", adding: true }),
  "acct-open": (el) => go({ name: "account", id: el.dataset.arg }),
  "export-all": () => {
    const list = app.data.watched.filter((w) => w.config);
    if (!list.length) return toast("No saved configs (vaults created in this extension have one)");
    downloadJson(`noxvault-configs-${new Date().toISOString().slice(0, 10)}.json`, {
      app: "noxvault",
      kind: "vault-configs",
      v: 1,
      note: "Public data only: each vault's rules. No phrase or key.",
      vaults: list.map((w) => ({ vault: w.address, cluster: w.cluster, label: w.label, vaultNumber: w.vaultNumber ?? null, preset: w.preset ?? null, config: w.config })),
      exportedAt: new Date().toISOString(),
    });
  },
  "reset-ask": async () => {
    if (!app.view.confirmReset) {
      app.view.confirmReset = true;
      return render();
    }
    await resetWallet();
    await reload();
    go({ name: "welcome" });
  },
  "rpc-form": (form) => {
    const url = String(new FormData(form as HTMLFormElement).get("rpc") ?? "").trim();
    const pattern = rpcOriginPattern(url);
    if (!pattern) {
      app.view.err = "Use an https:// RPC URL.";
      return render();
    }
    app.data.settings = { ...app.data.settings, customRpc: url };
    void save({ settings: app.data.settings });
    chrome.permissions
      .request({ origins: [pattern] })
      .then(async (ok) => {
        app.view.err = ok ? "" : "Chrome did not grant access to that host.";
        await send({ type: "settings" });
        if (ok) toast("RPC saved");
        render();
      })
      .catch((err) => ((app.view.err = String(err?.message ?? err)), render()));
  },
});

// "New phrase" while adding an account reuses the onboarding screens with adding = true.
defineView("welcome-add", () => `${back("Settings", "settings")}<div class="panel stack"><p class="muted" style="margin:0">A new account is a new 24-word phrase with its own vaults. It is encrypted with your current password.</p><button class="btn primary block" data-a="ob-new">Generate a new phrase</button></div>`);

// ---------- one account ----------

defineView("account", () => {
  const v = app.view;
  const a = app.data.accounts.find((x) => x.id === v.id);
  if (!a) return back("Settings", "settings");
  if (v.words)
    return `${back("Settings", "settings")}<div class="h">${esc(a.name)} · phrase <span class="grow"></span></div>
      <div class="note warn">Anyone who sees these words controls every vault of this account. Make sure nobody is watching your screen.</div>
      ${wordGrid(v.words)}<button class="btn primary block" style="margin-top:10px" data-a="acct-hide">Hide</button>`;
  return `${back("Settings", "settings")}<div class="h">${esc(a.name)} <span class="grow"></span></div>
    <div class="panel stack">
      <form class="row" data-a="acct-rename" autocomplete="off"><input type="text" name="name" maxlength="24" value="${esc(a.name)}"/><button class="btn" type="submit">Rename</button></form>
      <button class="btn block" data-a="acct-use" data-arg="${esc(a.id)}">Show this account's vaults</button>
      <button class="btn block" data-a="acct-scan" data-arg="${esc(a.id)}" ${app.unlocked ? "" : "disabled"}>Find my vaults on chain</button>
    </div>
    <div class="h">Wallet accounts of this phrase <span class="grow"></span></div>
    <div class="panel stack">
      ${app.data.wallets
        .filter((x) => x.phraseId === a.id)
        .map((x) => `<div class="row between"><span>${esc(x.name)} <span class="role">${x.kind === "legacy-fee" ? "FEE · V0.2" : `#${(x.index ?? 0) + 1}`}</span></span><span class="dim small">${esc(shortAddr(x.address))}</span></div>`)
        .join("")}
      <div class="dim small">Standard Solana accounts (m/44'/501'/i'/0'): the same 24 words show these addresses in Phantom or Solflare. The selected wallet pays network fees and rent for vault actions; it has no power over your vaults.${
        app.data.wallets.some((x) => x.phraseId === a.id && x.kind === "legacy-fee") ? " The v0.2 fee account is kept as a wallet so its SOL stays reachable." : ""
      }</div>
      <button class="btn block" data-a="wallets">Manage wallet accounts</button>
    </div>
    <div class="h">Secret phrase <span class="grow"></span></div>
    <form class="panel stack" data-a="acct-reveal" autocomplete="off">
      <input type="password" name="pw" placeholder="Password"/>
      ${v.err ? `<div class="err">${esc(v.err)}</div>` : ""}
      <div class="grid2"><button class="btn" type="submit" name="what" value="reveal">Reveal phrase</button><button class="btn danger" type="submit" name="what" value="remove">${v.confirmRemove ? "Confirm remove" : "Remove account"}</button></div>
      <div class="dim small">Removing deletes this phrase from the extension. Write it down first.</div>
    </form>`;
});

on({
  "acct-hide": () => {
    app.view.words = null;
    render();
  },
  "acct-use": async (el) => {
    await save({ activeAccount: el.dataset.arg! });
    app.data.activeAccount = el.dataset.arg!;
    go({ name: "home" });
  },
  "acct-scan": async (el) => {
    try {
      await rescan(el.dataset.arg!);
    } catch (e) {
      toast(errText(e));
    }
  },
  "acct-rename": async (form) => {
    await renameAccount(app.view.id, String(new FormData(form as HTMLFormElement).get("name") ?? ""));
    await reload();
    toast("Renamed");
    render();
  },
  "acct-reveal": async (form, ev) => {
    const v = app.view;
    const f = form as HTMLFormElement;
    const what = ((ev as SubmitEvent).submitter as HTMLButtonElement | null)?.value ?? "reveal";
    const pwEl = f.elements.namedItem("pw") as HTMLInputElement;
    const pw = pwEl.value;
    v.err = "";
    try {
      if (what === "remove") {
        if (!v.confirmRemove) {
          v.confirmRemove = true;
          return render();
        }
        pwEl.value = "";
        await removeAccount(pw, v.id);
        await reload();
        toast("Account removed");
        return go({ name: "settings" });
      }
      pwEl.value = "";
      v.words = await revealPhrase(pw, v.id);
    } catch (e) {
      v.err = e instanceof WrongPasswordError ? "Wrong password." : errText(e);
    }
    render();
  },
});
