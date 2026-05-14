import Anthropic from '@anthropic-ai/sdk';
import { env } from '@platform/config';

export function createClient(): Anthropic {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}
