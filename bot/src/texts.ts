export const SAFETY =
  "🔒 <b>Safety</b>\n" +
  "This bot only reads public Solana chain data. It never holds keys and will never ask for anything secret.\n" +
  "Nobody from Noxvault will <b>ever</b> ask for your 24 words — not in DMs, not in groups, not on a website. " +
  "If anyone asks for them, it's a scam.";

export const HELP =
  "<b>Noxvault notifications</b>\n" +
  "Get a message whenever a watched vault address sees a transaction: SOL in/out, token balance changes, " +
  "and whether it was a Noxvault action (succeeded or failed).\n\n" +
  "<b>Commands</b>\n" +
  "/watch &lt;vault address&gt; — start watching (max 10 per chat)\n" +
  "/unwatch &lt;vault address&gt; — stop watching\n" +
  "/list — show what this chat watches\n" +
  "/ca — the $NOX contract address\n" +
  "/buy — how to buy $NOX\n" +
  "/links — site, X, buy guide, whitepaper\n" +
  "/help — this message\n\n" +
  SAFETY;

export const SEED_WARNING =
  "⚠️ That looks like it could be a recovery phrase. <b>Delete that message now.</b>\n" +
  "This bot never needs your words, and nobody from Noxvault will ever ask for them. " +
  "If you think someone has seen them, move your funds to a new vault.";
