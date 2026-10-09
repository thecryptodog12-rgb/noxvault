import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Silkscreen } from "next/font/google";
import Providers from "@/components/Providers";
import Shell from "@/components/Shell";
import Boot from "@/components/Boot";
import "./globals.css";

const display = Silkscreen({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-silkscreen" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: "Noxvault — quantum-proof vaults for Solana",
  description:
    "Lock SOL and SPL tokens behind a WOTS+ hash-based one-time signature. Keys that survive the night.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#08080a", width: "device-width", initialScale: 1 };

const bootScript = `try{if(sessionStorage.getItem("nox.booted")==="1")document.documentElement.dataset.booted="1"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
      </head>
      <body>
        <Providers>
          <Boot />
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
