import type { Metadata } from "next";
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
