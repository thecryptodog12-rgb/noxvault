"use client";
import { useEffect, useState } from "react";
import { Copy } from "@/components/ui";

/** Share link, a post to X, and a ready-to-paste citation for journalists. */
export default function ShareBar({ tweet, citation }: { tweet: string; citation: string }) {
  const [url, setUrl] = useState("https://www.nox-vault.com/report");
  useEffect(() => setUrl(`${window.location.origin}/report`), []);
  const intent = `https://x.com/intent/tweet?text=${encodeURIComponent(tweet)}&url=${encodeURIComponent(url)}`;
  return (
    <div className="grid gap-px bg-line md:grid-cols-2 [&>*]:min-w-0">
      <div className="flex flex-col gap-2 bg-ink-2 p-4 sm:p-5">
        <div className="label">share this report (with a preview card)</div>
        <div className="flex items-center gap-3">
          <span className="truncate text-[12px] text-mute">{url}</span>
          <Copy value={url} />
        </div>
        <div className="mt-1 flex flex-wrap gap-2">
          <a href={intent} target="_blank" rel="noreferrer" className="btn">
            post on X
          </a>
          <a href="/api/report" target="_blank" rel="noreferrer" className="btn ghost">
            raw JSON
          </a>
        </div>
      </div>
      <div className="flex flex-col gap-2 bg-ink-2 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="label">cite</div>
          <Copy value={citation} />
        </div>
        <p className="text-[12px] leading-6 text-mute">{citation}</p>
      </div>
    </div>
  );
}
