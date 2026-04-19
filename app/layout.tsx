import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Opollo Site Builder",
  description: "Claude-powered WordPress page generation for Opollo sites.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
