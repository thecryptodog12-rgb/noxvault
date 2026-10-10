import { loadConfig } from "./config.js";
import { Rpc } from "./rpc.js";
import { parseAddress } from "./bot.js";
import { formatMessage, stripHtml, summarize, toTxView } from "./summarize.js";

/** Usage: pnpm dry-run <address> [count] — prints the messages the bot would send. No Telegram needed. */
async function main() {
  const address = parseAddress(process.argv[2] ?? "");
  if (!address) {
    console.error("usage: pnpm dry-run <address> [count]");
    process.exit(1);
  }
  const count = Number(process.argv[3] ?? 5);
  const cfg = loadConfig(false);
  const rpc = new Rpc(cfg.rpcUrl, cfg.rpcDelayMs);

  console.log(`dry-run: ${address} on ${cfg.network} (${cfg.rpcUrl}), program ${cfg.programId}\n`);
  const sigs = await rpc.signatures(address, { limit: count });
  if (!sigs.length) console.log("(no transactions)");
  for (const info of [...sigs].reverse()) {
    const tx = await rpc.transaction(info.signature);
    if (!tx) {
      console.log(`-- ${info.signature}: not available\n`);
      continue;
    }
    const msg = formatMessage(summarize(toTxView(info.signature, tx), address, cfg.programId), cfg.network);
    console.log(`----- ${new Date((info.blockTime ?? 0) * 1000).toISOString()}`);
    console.log(stripHtml(msg) + "\n");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
