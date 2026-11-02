import { provider, type Provider } from '../config';
import { gemini } from './gemini';
import { openai } from './openai';
import type { ProviderAdapter } from './types';

export * from './types';
export { ProviderTimeoutError } from './sse';

const ADAPTERS: Record<Provider, ProviderAdapter> = { gemini, openai };

/** The adapter for this deployment's configured provider. */
export function adapter(): ProviderAdapter {
  return ADAPTERS[provider()];
}

export function adapterFor(id: Provider): ProviderAdapter {
  return ADAPTERS[id];
}
