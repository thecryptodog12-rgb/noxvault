"use client";
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

/** Camera QR scanner. Calls onCode for every decoded QR (deduping is up to the caller). */
export default function Scanner({ onCode, onClose }: { onCode: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState<string | null>(null);
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
        const tick = () => {
          if (stopped) return;
          const c = canvas.current;
          if (c && v.readyState >= 2 && v.videoWidth) {
            const w = Math.min(v.videoWidth, 960);
            const h = Math.round((v.videoHeight * w) / v.videoWidth);
            c.width = w;
            c.height = h;
            const ctx = c.getContext("2d", { willReadFrequently: true })!;
            ctx.drawImage(v, 0, 0, w, h);
            const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
            if (code?.data) cb.current(code.data);
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
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
      <button className="btn ghost sm self-start" onClick={onClose}>
        stop camera
      </button>
    </div>
  );
}
