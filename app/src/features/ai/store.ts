import { create } from 'zustand';
import type { AiAnswer, AiChatMessage } from '@/api';

/** One chat turn: the user's text, or an answer with its citations, usage and cost. */
export type ChatTurn = { role: 'user'; content: string } | { role: 'assistant'; answer: AiAnswer };

interface AiPanelState {
  open: boolean;
  turns: ChatTurn[];
  toggle: () => void;
  setOpen: (v: boolean) => void;
  push: (t: ChatTurn) => void;
  clear: () => void;
}

/** Chat panel state. The conversation lives in memory only (this session), never in prefs. */
export const useAiPanel = create<AiPanelState>((set) => ({
  open: false,
  turns: [],
  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
  push: (t) => set((s) => ({ turns: [...s.turns, t] })),
  clear: () => set({ turns: [] }),
}));

/** The history the engine needs (stateless /ai/chat), last 40 messages. */
export function toMessages(turns: ChatTurn[]): AiChatMessage[] {
  return turns
    .map((t) =>
      t.role === 'user'
        ? { role: 'user' as const, content: t.content }
        : { role: 'assistant' as const, content: t.answer.text },
    )
    .slice(-40);
}
