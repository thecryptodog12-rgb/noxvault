// Moves the Noxvault program's upgrade authority to a Squads v4 multisig vault (docs/audit/UPGRADE.md §2).
//
// Dry run by default: checks the target, shows the current authority and prints the exact
// `solana program set-upgrade-authority` command. Only `--execute` runs it.
//
// Usage:
//   pnpm exec tsx scripts/transfer-upgrade-authority.ts <SQUADS_VAULT> [options]
//   pnpm exec tsx scripts/transfer-upgrade-authority.ts --multisig <SQUADS_MULTISIG> [options]
// Options:
//   --multisig <addr>     derive the vault (index --vault-index, default 0) from the multisig account
//   --vault-index <n>     Squads vault index (default 0)
//   --cluster <c>         devnet (default) | mainnet-beta | localnet | an RPC URL
//   --keypair <path>      current upgrade authority (default ~/.config/solana/id.json)
//   --no-rpc              print only; skip every on-chain check (offline)
//   --execute             actually transfer (irreversible without the multisig)
import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import { homedir } from "os";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4");
const SQUADS_V4 = new PublicKey("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");
const UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const CLUSTERS: Record<string, string> = {
  devnet: "https://api.devnet.solana.com",
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  localnet: "http://127.0.0.1:8899",
};

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const opts = { vault: "", multisig: "", vaultIndex: 0, cluster: "devnet", keypair: `${homedir()}/.config/solana/id.json`, rpc: true, execute: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i] ?? fail(`${a} needs a value`);
    if (a === "--multisig") opts.multisig = val();
    else if (a === "--vault-index") opts.vaultIndex = Number(val());
    else if (a === "--cluster") opts.cluster = val();
    else if (a === "--keypair") opts.keypair = val().replace(/^~(?=\/)/, homedir());
    else if (a === "--no-rpc") opts.rpc = false;
    else if (a === "--execute") opts.execute = true;
    else if (a === "-h" || a === "--help") {
      console.log(readFileSync(__filename, "utf8").split("\nimport ")[0]);
      process.exit(0);
    } else if (a.startsWith("--")) fail(`unknown option ${a}`);
    else if (!opts.vault) opts.vault = a;
    else fail(`unexpected argument ${a}`);
  }
  if (!Number.isInteger(opts.vaultIndex) || opts.vaultIndex < 0 || opts.vaultIndex > 255) fail("--vault-index must be 0..255");
  if (opts.execute && !opts.rpc) fail("--execute needs the on-chain checks; drop --no-rpc");
  return opts;
}

function key(s: string, what: string): PublicKey {
  try {
    return new PublicKey(s);
  } catch {
    return fail(`${what} is not a valid address: ${s}`);
  }
}

/** Squads v4 vault PDA: ["multisig", multisig, "vault", u8(index)]. */
function squadsVault(multisig: PublicKey, index: number): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("multisig"), multisig.toBuffer(), Buffer.from("vault"), Buffer.from([index])], SQUADS_V4)[0];
}

/** Current upgrade authority from the ProgramData account (null = immutable). */
async function upgradeAuthority(conn: Connection): Promise<{ programData: PublicKey; authority: PublicKey | null }> {
  const prog = await conn.getAccountInfo(PROGRAM_ID, "confirmed");
  if (!prog) fail(`program ${PROGRAM_ID.toBase58()} not found on this cluster`);
  if (!prog.owner.equals(UPGRADEABLE_LOADER)) fail("program is not owned by the upgradeable loader");
  const programData = new PublicKey(prog.data.subarray(4, 36));
  const pd = await conn.getAccountInfo(programData, "confirmed");
  if (!pd) fail("ProgramData account not found");
  // UpgradeableLoaderState::ProgramData { slot: u64, upgrade_authority_address: Option<Pubkey> }
  const tag = pd.data.readUInt32LE(0);
  if (tag !== 3) fail(`unexpected ProgramData tag ${tag}`);
  const hasAuthority = pd.data[12] === 1;
  return { programData, authority: hasAuthority ? new PublicKey(pd.data.subarray(13, 45)) : null };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const url = CLUSTERS[o.cluster] ?? o.cluster;
  const urlFlag = CLUSTERS[o.cluster] ? o.cluster : url;

  let vault = o.vault ? key(o.vault, "SQUADS_VAULT") : null;
  const multisig = o.multisig ? key(o.multisig, "--multisig") : null;
  if (multisig) {
    const derived = squadsVault(multisig, o.vaultIndex);
    if (vault && !vault.equals(derived)) fail(`vault ${vault.toBase58()} is not vault #${o.vaultIndex} of multisig ${multisig.toBase58()} (that is ${derived.toBase58()})`);
    vault = derived;
  }
  if (!vault) fail("give the Squads vault address, or --multisig <address>");
  // A Squads vault is a PDA. An on-curve address is a normal wallet: refuse, there is no signer
  // check on the new authority (--skip-new-upgrade-authority-signer-check).
  if (PublicKey.isOnCurve(vault.toBytes())) fail(`${vault.toBase58()} is an ordinary (on-curve) key, not a Squads vault PDA`);
  if (vault.equals(PROGRAM_ID) || vault.equals(PublicKey.default)) fail("refusing a nonsense target");

  console.log("Noxvault upgrade-authority transfer");
  console.log(`  cluster       ${url}`);
  console.log(`  program       ${PROGRAM_ID.toBase58()}`);
  if (multisig) console.log(`  multisig      ${multisig.toBase58()} (vault index ${o.vaultIndex})`);
  console.log(`  new authority ${vault.toBase58()} (Squads v4 vault)`);

  if (o.rpc) {
    const conn = new Connection(url, "confirmed");
    const target = await conn.getAccountInfo(vault, "confirmed");
    if (target?.owner.equals(SQUADS_V4)) fail(`${vault.toBase58()} is a Squads program account (the multisig itself?). Pass its vault, or use --multisig.`);
    if (target && !target.owner.equals(new PublicKey("11111111111111111111111111111111"))) fail(`${vault.toBase58()} is owned by ${target.owner.toBase58()}, not a system-owned vault`);
    if (multisig) {
      const ms = await conn.getAccountInfo(multisig, "confirmed");
      if (!ms || !ms.owner.equals(SQUADS_V4)) fail(`${multisig.toBase58()} is not a Squads v4 multisig account on this cluster`);
    }
    const { programData, authority } = await upgradeAuthority(conn);
    console.log(`  program data  ${programData.toBase58()}`);
    console.log(`  current auth  ${authority ? authority.toBase58() : "none (immutable)"}`);
    if (!authority) fail("the program is immutable; nothing to transfer");
    if (authority.equals(vault)) {
      console.log("\n✓ The multisig vault already holds the upgrade authority. Nothing to do.\n");
      return;
    }
    if (o.execute) {
      const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(o.keypair, "utf8"))));
      if (!kp.publicKey.equals(authority)) fail(`--keypair ${o.keypair} is ${kp.publicKey.toBase58()}, not the current authority`);
    }
  }

  const args = [
    "program",
    "set-upgrade-authority",
    PROGRAM_ID.toBase58(),
    "--new-upgrade-authority",
    vault.toBase58(),
    "--skip-new-upgrade-authority-signer-check",
    "--keypair",
    o.keypair,
    "--url",
    urlFlag,
  ];
  const shown = [`solana ${args.slice(0, 3).join(" ")}`, `${args[3]} ${args[4]}`, args[5], `${args[6]} ${args[7]}`, `${args[8]} ${args[9]}`];
  console.log(`\nCommand:\n  ${shown.join(" \\\n    ")}\n`);

  if (!o.execute) {
    console.log("Dry run: nothing was sent. Re-run with --execute to transfer (see docs/audit/UPGRADE.md first).\n");
    return;
  }

  console.log("Executing…");
  const r = spawnSync("solana", args, { stdio: "inherit" });
  if (r.status !== 0) fail(`solana exited with ${r.status ?? r.signal}`);
  const after = await upgradeAuthority(new Connection(url, "confirmed"));
  if (!after.authority?.equals(vault)) fail(`authority is now ${after.authority?.toBase58() ?? "none"}, expected ${vault.toBase58()}`);
  console.log(`\n✓ Upgrade authority is now the Squads vault ${vault.toBase58()}.\n`);
}

main().catch((e) => fail(String(e?.stack ?? e)));
