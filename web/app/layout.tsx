import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import Providers from "@/components/Providers";
import PwaRegister from "@/components/PwaRegister";
import Shell from "@/components/Shell";
import "./globals.css";

const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "700", "800"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: "Noxvault — the safer, quantum-proof wallet for Solana",
  description: "A safer wallet for SOL and tokens: quantum-proof keys, recovery, privacy, inheritance and spending limits, enforced on-chain.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#03070a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={mono.variable}>
      <body>
        <PwaRegister />
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
