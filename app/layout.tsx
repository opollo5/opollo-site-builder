import type { Metadata } from "next";
import { getDesignSystemCssOverride } from "@/lib/design-system/get-override";
import "@/styles/tokens.css";
import "./globals.css";

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700;800&family=Inter:ital,opsz,wght@0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;1,14..32,400&family=JetBrains+Mono:wght@400;500&display=swap"
        />
        {/* eslint-disable-next-line @next/next/no-css-tags */}
        <link rel="stylesheet" href="/styles/ds.css" />
        {/* Linearicons icon font — served as a static asset; CSS class API is `icon-{name}`. */}
        <link
          rel="preload"
          as="font"
          href="/fonts/linearicons/icomoon.woff?585at6"
          type="font/woff"
          crossOrigin=""
        />
        {/* eslint-disable-next-line @next/next/no-css-tags */}
        <link rel="stylesheet" href="/fonts/linearicons/linearicons.css" />
        {cssOverride && (
          // Inject per-instance design token overrides from design_system_settings.
          // eslint-disable-next-line react/no-danger
          <style
            id="opollo-design-system-overrides"
            dangerouslySetInnerHTML={{ __html: cssOverride }}
          />
        )}
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
