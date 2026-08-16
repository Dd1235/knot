import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { VoiceProvider } from "@/lib/voice-context";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

/** The display face: the wordmark and headlines. A high-contrast serif beside
 * a geometric sans is what makes the brand read as drawn rather than typed.
 * Display sizes only (~28px up) — never body copy, and never a number: money
 * stays in the sans, tabular. Italic is loaded for accent words in headlines. */
const displaySerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Knot",
  description: "Money you can just talk about — a finance agent that remembers.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Knot" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0c0a08" },
    { media: "(prefers-color-scheme: light)", color: "#faf7f0" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${displaySerif.variable} h-full antialiased`}
    >
      <head>
        {/* Stamps the saved theme before first paint, so a user whose choice
            differs from their OS never sees a flash of the wrong one. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("knot:theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-surface-base text-ink-primary">
        {/* Above every page, because a page renders AppShell rather than
            living inside it — a provider mounted by AppShell would be below
            the component that needs to call useVoice(). */}
        <VoiceProvider>{children}</VoiceProvider>
      </body>
    </html>
  );
}
