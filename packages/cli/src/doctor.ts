import { CliError, bold, dim, flagString, green, log, normaliseUrl, red, yellow, type ParsedArgs } from './util.js';

interface Status {
  version?: string;
  configured?: boolean;
  provider?: string;
  models?: string[];
  missing?: string[];
  tracing?: boolean;
  telemetry?: boolean;
  commit?: string;
  config?: { assistantName?: string; ownerName?: string };
  optional?: Record<string, boolean>;
  access?: string;
  botCheck?: string;
  onVercel?: boolean;
  selfTrusted?: boolean;
}

export async function doctor(args: ParsedArgs): Promise<void> {
  const url = normaliseUrl(flagString(args.flags, 'url'));

  let status: Status;
  try {
    const response = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new CliError(`${url}/api/status responded ${response.status}. Is the app deployed?`);
    status = (await response.json()) as Status;
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`Could not reach ${url}/api/status. Check the URL and that the deployment is live.`);
  }

  const yes = green('yes');
  const no = red('no');
  const off = dim('off');
  const rows: [string, string][] = [
    ['App', url],
    ['Version', status.version ?? '?'],
    ['Build', status.commit ?? '?'],
    ['Configured', status.configured ? yes : no],
    ['Provider', status.provider ?? '?'],
    ['Models', status.models?.length ? status.models.join(', ') : dim('none')],
    ['Missing env', status.missing?.length ? red(status.missing.join(', ')) : dim('none')],
    ['Assistant', status.config?.assistantName ?? '?'],
    ['Owner', status.config?.ownerName || dim('(unset)')],
    ['Trusted origins', status.optional?.TRUSTED_ORIGINS ? yes : yellow('not set — every visitor gets restricted mode')],
    ['Seed token', status.optional?.SEED_TOKEN ? yes : yellow('not set — seeding disabled')],
    ['Public URL', status.access ?? dim('byok')],
    [
      'Browser check',
      status.botCheck === 'off'
        ? yellow('off — counters are the only line')
        : status.botCheck === 'unavailable'
          ? red('unavailable — visitor requests on your key are being refused. On Vercel enable OIDC federation and redeploy; elsewhere set BOT_CHECK=off')
          : green('on'),
    ],
    ...(status.selfTrusted ? [['Trusted origins', red('include this deployment\'s own host — every public visitor counts as trusted. Remove it')] as [string, string]] : []),
    ['Tracing', status.tracing ? green('on') : off],
    ['Telemetry', status.telemetry ? green('on') : off],
  ];

  const width = Math.max(...rows.map(([key]) => key.length));
  log(bold('Ragfolio doctor'));
  log();
  for (const [key, value] of rows) log(`  ${key.padEnd(width)}  ${value}`);
  log();

  if (!status.configured) {
    throw new CliError('Not configured. Add the missing environment variables and redeploy.');
  }
  log(green('Looks healthy.'));
}
