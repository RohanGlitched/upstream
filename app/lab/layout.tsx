// Lab: Builder B's components in isolation. Loads the Record fonts itself until app/layout.tsx does.
import { Archivo, Courier_Prime, IM_Fell_English, Public_Sans, Source_Serif_4 } from "next/font/google";
import "../record-tokens.css";
import "./lab.css";

const serif = Source_Serif_4({ subsets: ["latin"], axes: ["opsz"], variable: "--font-source-serif", display: "swap" });
const sans = Public_Sans({ subsets: ["latin"], variable: "--font-public-sans", display: "swap" });
const type = Courier_Prime({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-courier-prime", display: "swap" });
const figure = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });
const chart = IM_Fell_English({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-im-fell", display: "swap" });

export const metadata = { title: "Lab", robots: { index: false } };

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`lab ${serif.variable} ${sans.variable} ${type.variable} ${figure.variable} ${chart.variable}`}>{children}</div>
  );
}
