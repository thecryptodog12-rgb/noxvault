// Vault presets offered in Create (app/create/SetupVault.tsx applies them) and explained on
// /for-projects. Keep the settings lines in step with applyPreset in SetupVault.
export type Preset = "personal" | "team" | "slow" | "vesting" | "dao";

/** [preset, name, one-line summary] in the order Create shows them. */
export const PRESETS: readonly (readonly [Preset, string, string])[] = [
  ["personal", "Personal", "just you; add what you like below"],
  ["team", "Team multisig", "2 of 3 signers approve every action"],
  ["slow", "Slow treasury", "every payout waits 72 h, cancellable"],
  ["vesting", "Vesting treasury", "2 of 3 + 72 h wait; add schedules after"],
  ["dao", "DAO treasury", "pays out only to a Squads or Realms address"],
];

/** What each project preset sets, in plain words (from applyPreset). */
export const PRESET_SETTINGS: Partial<Record<Preset, { forWho: string; settings: string[] }>> = {
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
