import { ChatApp } from '@/components/ChatApp';
import { env, publicConfig } from '@/lib/config';
import { isTracingEnabled } from '@/lib/tracing';

// Rendered per request, never prerendered: the owner name, welcome copy and
// trusted-origin list come from the running deployment's environment, and a
// build-time snapshot would paint the wrong names before the client corrected them.
export const dynamic = 'force-dynamic';

/**
 * Server shell around the client app. Reads on the server what the browser
 * must know before first paint: the install's name and welcome copy, whether
 * questions are traced to Langfuse (a privacy disclosure that should not depend
 * on a client fetch), and which parent origins may post a question into the
 * iframe (handed down rather than made a NEXT_PUBLIC_ var).
 */
export default function Page() {
  let config;
  try {
    config = publicConfig();
  } catch {
    config = { provider: 'gemini' as const, assistantName: 'Assistant', ownerName: '', welcome: '', suggestions: [] };
  }
  return <ChatApp initialConfig={config} tracing={isTracingEnabled()} trustedOrigins={env.trustedOrigins} />;
}
