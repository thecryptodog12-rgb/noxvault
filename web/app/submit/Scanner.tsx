"use client";
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

// The browser's own QR decoder where it exists (Chrome/Android, Safari 17+ behind flags); jsQR
// everywhere else. Both run on this device only: frames never leave the page.
interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type DetectorCtor = { new (opts: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };

async function nativeDetector(): Promise<Detector | null> {
  const BD = (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (!BD) return null;
  try {
    const formats = (await BD.getSupportedFormats?.()) ?? ["qr_code"];
    if (!formats.includes("qr_code")) return null;
    return new BD({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

/** Camera QR scanner. Calls onCode for every decoded QR (deduping is up to the caller). */
export default function Scanner({ onCode, onClose }: { onCode: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [engine, setEngine] = useState<"native" | "jsqr" | null>(null);
  const cb = useRef(onCode);
  cb.current = onCode;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot use the camera here (needs https). Paste the text instead.");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        let native = await nativeDetector();
        setEngine(native ? "native" : "jsqr");
        const tick = async () => {
          if (stopped) return;
          const c = canvas.current;
          if (c && v.readyState >= 2 && v.videoWidth) {
            if (native) {
              try {
                for (const code of await native.detect(v)) if (code.rawValue) cb.current(code.rawValue);
              } catch {
                native = null; // fall back for the rest of this session
                setEngine("jsqr");
              }
            } else {
              const w = Math.min(v.videoWidth, 960);
              const h = Math.round((v.videoHeight * w) / v.videoWidth);
              c.width = w;
              c.height = h;
              const ctx = c.getContext("2d", { willReadFrequently: true })!;
              ctx.drawImage(v, 0, 0, w, h);
              const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
              if (code?.data) cb.current(code.data);
            }
          }
          if (!stopped) raf = requestAnimationFrame(() => void tick());
        };
        raf = requestAnimationFrame(() => void tick());
      } catch (e) {
        setErr((e as Error).message || "Camera unavailable");
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="flex flex-col gap-3">
      {err ? (
        <div className="text-[12px] text-bad">✕ {err}</div>
      ) : (
        <div className="relative overflow-hidden rounded border border-line-2 bg-ink">
          <video ref={video} className="block w-full" muted playsInline />
          <div className="pointer-events-none absolute inset-[12%] rounded border-2 border-teal/70" />
        </div>
      )}
      <canvas ref={canvas} className="hidden" />
      <div className="flex items-center justify-between gap-3">
        <button className="btn ghost sm" onClick={onClose}>
          stop camera
        </button>
        {engine && <span className="text-[10.5px] text-dim">decoder: {engine === "native" ? "built-in (BarcodeDetector)" : "jsQR"} · on this device only</span>}
      </div>
    </div>
  );
}
