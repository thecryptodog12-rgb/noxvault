// Where the 24 words may live in this browser. Default: nowhere (memory only).
export type Remember = "off" | "session" | "local";

const KEY = "nox.secret.words";

export function loadWords(): { words: string; where: Remember } | null {
  try {
    const s = sessionStorage.getItem(KEY);
    if (s) return { words: s, where: "session" };
    const l = localStorage.getItem(KEY);
    if (l) return { words: l, where: "local" };
  } catch {}
  return null;
}

export function saveWords(words: string, where: Remember) {
  forgetWords();
  try {
    if (where === "session") sessionStorage.setItem(KEY, words);
    if (where === "local") localStorage.setItem(KEY, words);
  } catch {}
}

export function forgetWords() {
  try {
    sessionStorage.removeItem(KEY);
    localStorage.removeItem(KEY);
  } catch {}
}
