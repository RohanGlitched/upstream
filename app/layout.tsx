import type { Metadata, Viewport } from "next";
import { Archivo, Courier_Prime, IM_Fell_English, Public_Sans, Source_Serif_4 } from "next/font/google";
import { Masthead } from "@/components/chrome/Masthead";
import { Colophon } from "@/components/chrome/Colophon";
import { ToTop } from "@/components/chrome/ToTop";
import { InkDefs } from "@/components/record/bits";
import { THEME_SCRIPT } from "@/components/lib/theme";
import "./record-tokens.css";
import "./globals.css";

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  axes: ["opsz"],
  style: ["normal", "italic"],
  display: "swap",
});

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  display: "swap",
});

const courierPrime = Courier_Prime({
  variable: "--font-courier-prime",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

const imFell = IM_Fell_English({
  variable: "--font-im-fell",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Upstream: why a drug is short, from our shelf to the factory",
    template: "%s | Upstream",
  },
  description:
    "Upstream traces a hospital drug shortage from our stock to the plant on the FDA label, lays FDA's inspections, warning letters and import alerts out to scale against the day the shortage was posted, and ranks what to do.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e9eeea" },
    { media: "(prefers-color-scheme: dark)", color: "#141917" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const fonts = [sourceSerif, publicSans, courierPrime, archivo, imFell].map((f) => f.variable).join(" ");
  return (
    <html lang="en" className={fonts} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <InkDefs />
        <Masthead />
        <main id="main">{children}</main>
        <Colophon />
        <ToTop />
      </body>
    </html>
  );
}
