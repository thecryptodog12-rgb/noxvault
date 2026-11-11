// Vault presets offered in Create (app/create/SetupVault.tsx applies them) and explained on
// /for-projects. Keep the settings lines in step with applyPreset in SetupVault.
export type Preset = "personal" | "antitheft" | "team" | "slow" | "vesting" | "dao";

/** [preset, name, one-line summary] in the order Create shows them. */
export const PRESETS: readonly (readonly [Preset, string, string])[] = [
  ["personal", "Personal", "just you; add what you like below"],
  ["antitheft", "Anti-theft", "stolen phrase? 72 h to cancel"],
  ["team", "Team multisig", "2 of 3 signers approve every action"],
  ["slow", "Slow treasury", "every payout waits 72 h, cancellable"],
  ["vesting", "Vesting treasury", "2 of 3 + 72 h wait; add schedules after"],
  ["dao", "DAO treasury", "pays out only to a Squads or Realms address"],
];

/** Daily amount the anti-theft preset lets go out at once (SOL); above it, payouts wait. */
export const ANTITHEFT_INSTANT_SOL = "0.05";

/**
 * What each preset sets, in plain words (from applyPreset). `personal` presets are for one
 * owner and are left out of /for-projects.
 */
export const PRESET_SETTINGS: Partial<Record<Preset, { forWho: string; settings: string[]; personal?: true }>> = {
  antitheft: {
    forWho: "Your own savings, in case someone gets hold of your phrase.",
    settings: [
      `Up to ${ANTITHEFT_INSTANT_SOL} SOL a day goes out at once; anything more, and every token payout, waits 72 h`,
      "A recovery phrase can cancel a pending payout at any time, and freeze the vault for 14 days (1 to 90) so a thief with your main phrase cannot simply queue the next one",
      "During a freeze the main phrase alone moves nothing and its Pings do not count as activity; your main phrase and recovery phrase together can still escape to a new vault at once",
      "Recovery takes over after 90 days of inactivity",
      "Store the recovery phrase apart from your main phrase, or it protects nothing",
      "Optional: whitelist a wallet of your own with other keys, as an instant escape route",
      "Turn on alerts on your phone so you notice in time",
    ],
    personal: true,
  },
  team: {
    forWho: "Core teams that want no single person able to move funds.",
    settings: ["2 of 3 signers approve every action", "Recovery key, takes over after 30 days of inactivity", "Each co-signer keeps their own phrase"],
  },
  vesting: {
    forWho: "Team and investor allocations that must unlock on a schedule.",
    settings: ["2 of 3 signers", "Payouts above 0.01 SOL a day wait 72 h in public", "Recovery key can cancel; 30-day inactivity takeover", "Add a schedule per member after creation"],
  },
  dao: {
    forWho: "DAOs that govern spending in Squads or Realms.",
    settings: ["Only destination: your Squads vault or Realms treasury", "Every other address is refused on-chain", "Recovery key, takes over after 90 days of inactivity"],
  },
  slow: {
    forWho: "Marketing, ops and LP wallets that need a public warning before money moves.",
    settings: ["Payouts above 0.01 SOL a day wait 72 h in public", "Recovery key can cancel a pending payout", "Recovery takes over after 30 days of inactivity"],
  },
};
