import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import Providers from "@/components/Providers";
import Shell from "@/components/Shell";
import "./globals.css";

const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "700", "800"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: "Noxvault — hash-based vaults for Solana",
  description: "Lock SOL and SPL tokens behind a WOTS+ hash-based one-time signature, generated in your browser.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#03070a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={mono.variable}>
      <body>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
