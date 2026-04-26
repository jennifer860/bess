import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const siteUrl =
  typeof process.env.VERCEL_URL === "string" && process.env.VERCEL_URL.length > 0
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "BESS - Blockchain Explorer Simple Statement",
  description: "Build simple account statements from blockchain explorer data. Preview and export PDFs.",
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/favicon.png",
  },
  openGraph: {
    title: "BESS - Blockchain Explorer Simple Statement",
    description: "Build simple account statements from blockchain explorer data. Preview and export PDFs.",
    siteName: "BESS",
    images: [{ url: "/favicon.png" }],
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "BESS - Blockchain Explorer Simple Statement",
    description: "Build simple account statements from blockchain explorer data. Preview and export PDFs.",
    images: ["/favicon.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${dmSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
