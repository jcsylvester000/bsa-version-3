import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import { THEME_COOKIE, parseTheme } from '@/lib/ui/theme';

export const metadata: Metadata = {
  title: 'BSA — Business Site Analysis',
  description: 'Grid Property Ventures · Business Site Analysis. Development-ready prototype.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Theme from the `bsa-theme` cookie (Settings → Appearance), validated; dark by default. Rendered
  // server-side so there is no flash and no inline script is needed (CSP).
  const theme = parseTheme(cookies().get(THEME_COOKIE)?.value);
  return (
    <html lang="en" data-theme={theme} suppressHydrationWarning>
      <head>
        {/* GRID brand type: Cantata One (headings), Poppins (body), Judson (serif accent). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cantata+One&family=Judson:ital,wght@0,400;0,700;1,400&family=Poppins:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
