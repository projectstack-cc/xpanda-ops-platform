import "./globals.css";
import { ThemeProvider } from "@/components/theme";
import { LangProvider } from "@/components/lang";
import { headers } from "next/headers";
import SimulationBanner from "@/components/SimulationBanner";

export const metadata = {
  title: "xPanda Cutting — v2",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const simRaw = headers().get("X-User-Simulating-Role");
  let simRole: string | null = null;
  if (simRaw) { try { simRole = decodeURIComponent(simRaw); } catch { simRole = simRaw; } }
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('xpanda-theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark');}catch(e){}})();`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var l=localStorage.getItem('xpanda_lang');if(l==='es'||l==='ht'||l==='en'){document.documentElement.lang=l;}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="bg-bg text-text font-sans antialiased">
        <LangProvider>
          <ThemeProvider>
            {simRole && <SimulationBanner roleName={simRole} />}
            {children}
          </ThemeProvider>
        </LangProvider>
      </body>
    </html>
  );
}
