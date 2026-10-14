import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "VaultMind — Privacy-First AI Memory Vault on Monad",
  description: "Encrypt personal memory documents with Mera passkeys and grant time-limited, revocable AI access backed by Monad smart contracts.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
