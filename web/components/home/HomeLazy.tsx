"use client";
// Client-only, lazily loaded homepage pieces. page.tsx stays a server component.
import dynamic from "next/dynamic";
import LazyOnView from "./LazyOnView";

const DemoFallback = () => (
  <div className="flex min-h-[560px] items-center justify-center bg-ink-2 text-[12px] text-dim lg:min-h-[430px]">preparing a demo key…</div>
);

const SignDemoInner = dynamic(() => import("./SignDemo"), { ssr: false, loading: DemoFallback });

export function SignDemo() {
  return (
    <LazyOnView fallback={<DemoFallback />} className="min-h-[560px] lg:min-h-[430px]">
      <SignDemoInner />
    </LazyOnView>
  );
}
