import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { StateStore } from "../src/state.js";

const A = "4VmyMBXEB9pXwVTssUEjJgy8EqfaooNurAEVybWtwkSV";
const B = "8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4";

function tmpFile() {
  const dir = mkdtempSync(path.join(tmpdir(), "noxbot-"));
  return { dir, file: path.join(dir, "nested", "state.json") };
}

describe("StateStore", () => {
  it("watch / list / limit / unwatch and persistence", async () => {
    const { dir, file } = tmpFile();
    const s = new StateStore(file, 2);
    await s.load(); // missing file is fine
    expect(await s.watch(1, A)).toBe("added");
    expect(await s.watch(1, A)).toBe("exists");
    expect(await s.watch(1, B)).toBe("added");
    expect(await s.watch(1, "11111111111111111111111111111111")).toBe("limit");
    expect(await s.watch(2, A)).toBe("added");
    expect(s.addresses().sort()).toEqual([A, B].sort());
    expect(s.chatsFor(A).sort()).toEqual(["1", "2"]);

    expect(s.isInitialised(A)).toBe(false);
    await s.setCursor(A, "sigA");
    await s.setCursor(B, null);
    expect(s.isInitialised(B)).toBe(true);
    expect(s.cursor(B)).toBeNull();

    // reload from disk
    const s2 = new StateStore(file, 2);
    await s2.load();
    expect(s2.list(1)).toEqual([A, B]);
    expect(s2.cursor(A)).toBe("sigA");
    expect(s2.isInitialised(B)).toBe(true);

    // unwatch: cursor survives while another chat still watches A
    expect(await s2.unwatch(1, A)).toBe(true);
    expect(s2.cursor(A)).toBe("sigA");
    expect(await s2.unwatch(2, A)).toBe(true);
    expect(s2.isInitialised(A)).toBe(false);
    expect(await s2.unwatch(2, A)).toBe(false);

    await s2.removeChat(1);
    expect(s2.addresses()).toEqual([]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1, chats: {}, cursors: {} });
    // no temp files left behind
    expect(readdirSync(path.dirname(file))).toEqual(["state.json"]);
    void dir;
  });

  it("setCursor ignores addresses nobody watches", async () => {
    const { file } = tmpFile();
    const s = new StateStore(file);
    await s.setCursor(A, "x");
    expect(s.isInitialised(A)).toBe(false);
  });

  it("concurrent saves end with the latest state", async () => {
    const { file } = tmpFile();
    const s = new StateStore(file);
    await Promise.all([s.watch(1, A), s.watch(1, B), s.watch(2, A)]);
    const disk = JSON.parse(readFileSync(file, "utf8"));
    expect(disk.chats).toEqual({ "1": [A, B], "2": [A] });
  });
});
