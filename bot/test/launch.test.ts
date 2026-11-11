import { describe, expect, it } from "vitest";
import { buyText, caText, launchClock, linksText, timeLeft } from "../src/launch.js";

const AT = "2026-10-13T20:00:00+02:00";
const MINT = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";

describe("launch commands", () => {
  it("launchClock shows UTC", () => {
    expect(launchClock(AT)).toBe("18:00 UTC");
  });
  it("timeLeft", () => {
    const t = Date.parse(AT);
    expect(timeLeft(AT, t - (2 * 3600 + 14 * 60) * 1000)).toBe("2h 14m");
    expect(timeLeft(AT, t - 45_000)).toBe("45s");
    expect(timeLeft(AT, t)).toBeNull();
  });
  it("/ca before launch: countdown, no address", () => {
    const s = caText({ token: "", launchAt: AT }, Date.parse(AT) - 3600_000);
    expect(s).toContain("18:00 UTC");
    expect(s).toContain("in 1h 0m");
    expect(s).not.toContain("pump.fun/coin");
  });
  it("/ca after launch without token", () => {
    expect(caText({ token: "", launchAt: AT }, Date.parse(AT) + 1000)).toContain("any moment now");
  });
  it("/ca with token", () => {
    const s = caText({ token: MINT, launchAt: AT });
    expect(s).toContain(`<code>${MINT}</code>`);
    expect(s).toContain(`https://pump.fun/coin/${MINT}`);
  });
  it("/buy and /links", () => {
    expect(buyText({ token: "", launchAt: AT })).toContain("https://www.nox-vault.com/buy");
    expect(buyText({ token: MINT, launchAt: AT })).toContain(`https://pump.fun/coin/${MINT}`);
    expect(linksText()).toContain("https://www.nox-vault.com/whitepaper");
  });
});
