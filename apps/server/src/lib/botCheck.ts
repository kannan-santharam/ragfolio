import { checkBotId } from 'botid/server';
import { env } from './config';

/**
 * Is there a browser on the other end?
 *
 * Owner-key spend is only ever meant for people using the widget. Vercel's
 * BotID attaches a challenge response to requests made by the page's own
 * JavaScript and verifies it here; a request assembled elsewhere fails it.
 * Basic mode is free on every plan and needs nothing beyond the package.
 *
 * Verdicts: `human` and `bot` are what BotID said. `unknown` means the check
 * could not run (typically: not deployed on Vercel). `skipped` is the adopter
 * opting out with BOT_CHECK=off on another host, where the daily counters are
 * the only line.
 */
export type BrowserVerdict = 'human' | 'bot' | 'unknown' | 'skipped';

export async function verifyBrowser(): Promise<BrowserVerdict> {
  if (env.botCheck === 'off') return 'skipped';
  try {
    const result = await checkBotId();
    return result.isBot ? 'bot' : 'human';
  } catch (error) {
    console.error('bot-check:unavailable', error instanceof Error ? error.message : error);
    return 'unknown';
  }
}

/**
 * Whether a verdict lets a request spend the owner's key. The operator asked
 * for a browser check (BOT_CHECK=on); if it cannot run, the answer is no, for
 * every tier, rather than quietly yes. The fix is a setting, not a bypass:
 * enable OIDC on the Vercel project, or BOT_CHECK=off on another host.
 */
export function browserAllowed(verdict: BrowserVerdict): boolean {
  return verdict === 'human' || verdict === 'skipped';
}

/**
 * For /api/status and `doctor`: not what the setting says but whether the
 * check can actually run here. A probe outside a protected request has no
 * challenge to verify, so its verdict is meaningless; only whether it throws
 * is read.
 */
export async function botCheckState(): Promise<'on' | 'off' | 'unavailable'> {
  if (env.botCheck === 'off') return 'off';
  if (process.env.NODE_ENV === 'development') return 'on';
  try {
    await checkBotId();
    return 'on';
  } catch {
    return 'unavailable';
  }
}
