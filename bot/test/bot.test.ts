import { describe, expect, it } from "vitest";
import { looksLikeSeed, parseAddress } from "../src/bot.js";

describe("input checks", () => {
  it("parseAddress", () => {
    expect(parseAddress(" 4VmyMBXEB9pXwVTssUEjJgy8EqfaooNurAEVybWtwkSV ")).toBe("4VmyMBXEB9pXwVTssUEjJgy8EqfaooNurAEVybWtwkSV");
    expect(parseAddress("0xabc")).toBeNull();
    expect(parseAddress("4VmyMBXEB9pXwVTssUEjJgy8EqfaooNurAEVybWtwkSVV")).toBeNull();
    expect(parseAddress("")).toBeNull();
  });
  it("looksLikeSeed", () => {
    expect(looksLikeSeed("abandon ".repeat(23) + "art")).toBe(true);
    expect(looksLikeSeed("hey can you tell me how the watch command works")).toBe(false);
  });
});
