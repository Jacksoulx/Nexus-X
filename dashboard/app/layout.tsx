import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nexus-X Performance Dashboard",
  description: "Intent batching performance dashboard for the Nexus-X execution network demo."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
