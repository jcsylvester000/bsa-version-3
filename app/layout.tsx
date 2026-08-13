import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BSA — Business Site Analysis',
  description: 'Grid Property Ventures · Business Site Analysis. Development-ready prototype.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
