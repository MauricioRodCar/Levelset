/**
 * AI assistant (v1.1, docs/V1.1-PRD.md §4): explains and coaches with the user's own data,
 * never buy/sell calls or price predictions. Off by default; every component renders nothing
 * while AI is off.
 */
export { AiExplainButton, type AiExplainButtonProps } from './AiExplainButton';
export { useAiLang } from './lang';
export { AiChatPanel, AiPanelToggle } from './AiChatPanel';
export { AiCoachCard } from './AiCoachCard';
export { AiAnswerView, AiText } from './AiAnswerView';
export { useAiPanel } from './store';
