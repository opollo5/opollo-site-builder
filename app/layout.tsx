import type { Metadata } from "next";
import { Fredoka, Manrope } from "next/font/google";
import { cn } from "@/lib/utils";
import { getDesignSystemCssOverride } from "@/lib/design-system/get-override";
import "@/styles/tokens.css";
import "./globals.css";

const fredoka = Fredoka({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Opollo Site Builder",
  description: "Claude-powered WordPress page generation for Opollo sites.",
  icons: {
    icon: [
      {
        url: "https://opollo.com/wp-content/uploads/2025/04/cropped-Icon-black_inverse-rounded-corners-150x150.gif",
        sizes: "32x32",
        type: "image/gif",
      },
      {
        url: "https://opollo.com/wp-content/uploads/2025/04/cropped-Icon-black_inverse-rounded-corners-300x300.gif",
        sizes: "192x192",
        type: "image/gif",
      },
    ],
    apple: {
      url: "https://opollo.com/wp-content/uploads/2025/04/cropped-Icon-black_inverse-rounded-corners-300x300.gif",
      sizes: "180x180",
      type: "image/gif",
    },
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cssOverride = await getDesignSystemCssOverride();

  return (
    <html
      lang="en"
      className={cn(fredoka.variable, manrope.variable, "dark")}
      suppressHydrationWarning
    >
      {cssOverride && (
        <head>
          {/* eslint-disable-next-line react/no-danger */}
          <style dangerouslySetInnerHTML={{ __html: cssOverride }} />
        </head>
      )}
      <body className="font-body antialiased">{children}</body>
    </html>
  );
}
