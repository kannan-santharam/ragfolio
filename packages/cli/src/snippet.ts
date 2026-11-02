import { flagBool, flagString, log, normaliseUrl, type ParsedArgs, bold, dim } from './util.js';

export function buildSnippet(options: { url: string; theme?: string; label?: string; inline?: boolean }): string {
  const attrs = [`src="${options.url}/embed.js"`, 'defer'];
  if (options.theme) attrs.push(`data-theme="${options.theme}"`);
  if (options.label) attrs.push(`data-label="${options.label.replace(/"/g, '&quot;')}"`);
  if (options.inline) attrs.push('data-mode="inline"', 'data-target="#ragfolio"');
  const tag = `<script ${attrs.join(' ')}></script>`;
  return options.inline ? `<div id="ragfolio" style="min-height:560px"></div>\n${tag}` : tag;
}

export async function snippet(args: ParsedArgs): Promise<void> {
  const url = normaliseUrl(flagString(args.flags, 'url'));
  const theme = flagString(args.flags, 'theme');
  if (theme && theme !== 'dark' && theme !== 'light') {
    throw new Error('--theme must be "dark" or "light".');
  }
  const label = flagString(args.flags, 'label');
  const inline = flagBool(args.flags, 'inline');

  log(bold('Paste this into your site, just before </body>:'));
  log();
  log(buildSnippet({ url, theme, label, inline }));
  log();
  log(dim('Optional JS API: window.ragfolio.open() / close() / toggle(), and'));
  log(dim("window.ragfolio.ask('What has she shipped?') to open and submit a question."));
}
