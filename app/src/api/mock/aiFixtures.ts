import type { AiSettings } from '../types';

/** Mock AI state (aiMock.ts). The browser demo holds no key; the mock pretends one is present. */
export interface AiMockState {
  settings: AiSettings;
  keyPresent: boolean;
  spentUsd: number;
}

export function freshAi(): AiMockState {
  return {
    settings: { enabled: false, model: 'sonnet', monthlyCapUsd: 5 },
    keyPresent: true,
    spentUsd: 0,
  };
}
