import { loadConfig } from "./config.js";
import { StateStore } from "./state.js";
import { Rpc } from "./rpc.js";
import { Poller } from "./poller.js";
import { createBot, makeNotifier } from "./bot.js";

async function main() {
  const cfg = loadConfig(true);
  const state = new StateStore(cfg.statePath, cfg.maxWatchesPerChat);
  await state.load();

  const bot = createBot(cfg, state);
  await bot.api.setMyCommands([
    { command: "watch", description: "Watch a vault address" },
    { command: "unwatch", description: "Stop watching an address" },
    { command: "list", description: "Show watched addresses" },
    { command: "help", description: "How it works + safety" },
  ]);

  const poller = new Poller(cfg, new Rpc(cfg.rpcUrl, cfg.rpcDelayMs), state, makeNotifier(bot, state));

  const shutdown = async () => {
    console.log("shutting down…");
    poller.stop();
    await bot.stop();
    await state.save();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  console.log(
    `noxvault-bot: network=${cfg.network} rpc=${cfg.rpcUrl} program=${cfg.programId} poll=${cfg.pollSeconds}s state=${cfg.statePath}`,
  );
  poller.start();
  await bot.start({ drop_pending_updates: false, onStart: (me) => console.log(`telegram: @${me.username} (long polling)`) });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
