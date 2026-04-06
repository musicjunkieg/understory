import type { Metadata } from "next";
import { Newsreader } from "next/font/google";
import { Work_Sans } from "next/font/google";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  display: "swap",
});

const workSans = Work_Sans({
  variable: "--font-work-sans",
  subsets: ["latin"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Understory — What your timeline missed",
  description:
    "A social anti-algorithm for ATmosphereConf VODs. Understory finds the talks your network didn't.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${workSans.variable} ${spaceGrotesk.variable}`}
    >
      <body className="min-h-screen bg-understory antialiased">{children}</body>
    </html>
  );
}
