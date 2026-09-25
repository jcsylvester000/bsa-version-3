import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BSA — Business Site Analysis',
  description: 'Grid Property Ventures · Business Site Analysis. Development-ready prototype.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Theme: dark by default. The light tokens exist in globals.css ([data-theme='light']); a Settings
    // toggle (cookie → this attribute, rendered server-side) is deferred — see docs/DESIGN_V2_CHECKLIST.md.
    <html lang="en" data-theme="dark">
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
