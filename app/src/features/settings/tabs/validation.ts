/** Small validators for the Settings tabs (kept out of component files for fast refresh). */

export type SecUserAgentError = 'email' | 'tooLong';

/** SEC asks for "Name email@example.com". Empty is allowed (SEC features then stay off). */
export function validateSecUserAgent(v: string): SecUserAgentError | null {
  const s = v.trim();
  if (!s) return null;
  if (s.length > 200) return 'tooLong';
  if (!/\S+@\S+\.\S+/.test(s)) return 'email';
  return null;
}

export type ApiKeyError = 'required' | 'format';

/** Claude API keys look like "sk-ant-..." with no spaces. */
export function validateApiKey(v: string): ApiKeyError | null {
  const s = v.trim();
  if (!s) return 'required';
  if (!/^sk-ant-[A-Za-z0-9_-]{16,}$/.test(s)) return 'format';
  return null;
}
