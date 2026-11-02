import type { Metadata, Viewport } from 'next';
import { BotIdClient } from 'botid/client';
import { ThemeProvider, themeBootstrapScript } from '@/context/ThemeContext';
import './globals.css';

const assistantName = process.env.ASSISTANT_NAME?.trim() || 'Assistant';
const ownerName = process.env.OWNER_NAME?.trim();

export const metadata: Metadata = {
  title: ownerName ? `${assistantName} — ask about ${ownerName}` : `${assistantName} — ask your documents`,
  description:
    'An agentic retrieval assistant: a tool-calling model decides when to search, retrieves from pgvector, and cites the exact passage behind every claim.',
  robots: { index: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0b0e14' },
    { media: '(prefers-color-scheme: light)', color: '#f8fafd' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Reads ?theme= before paint so the iframe never flashes light inside a dark page. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        {/* Attaches the browser challenge to the two routes that can spend the owner's key. */}
        <BotIdClient
          protect={[
            { path: '/api/chat', method: 'POST' },
            { path: '/api/ingest', method: 'POST' },
          ]}
        />
      </head>
      <body className="h-full antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
