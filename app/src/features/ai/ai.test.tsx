import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/api/mock';
import { renderApp, renderWithProviders, resetAppState } from '@/test/render';
import { setupMockServer } from '@/test/server';
import { AiText } from './AiAnswerView';
import { useAiPanel } from './store';

setupMockServer();

beforeEach(async () => {
  await resetAppState();
  useAiPanel.setState({ open: false, turns: [] });
});

const enable = () => {
  db.ai.settings.enabled = true;
};

describe('AI assistant', () => {
  it('is off by default: no toggle, no explain buttons', async () => {
    renderApp('/');
    expect(await screen.findByTestId('ny-clock')).toBeInTheDocument();
    await screen.findAllByText(/TSLA/);
    expect(screen.queryByTestId('ai-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-explain-news_summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-panel')).not.toBeInTheDocument();
  });

  it('chat panel answers with citations, cost and the disclaimer', async () => {
    enable();
    const user = userEvent.setup();
    renderApp('/');
    await user.click(await screen.findByTestId('ai-toggle'));
    const panel = await screen.findByTestId('ai-panel');
    await user.type(within(panel).getByLabelText('Message'), 'How much does my TSLA ticket risk?');
    await user.click(within(panel).getByRole('button', { name: 'Send' }));
    const answer = await within(panel).findByTestId('ai-answer');
    expect(answer).toHaveTextContent('46.88');
    expect(within(answer).getByTestId('ai-citations')).toHaveTextContent('Ticket tkt_20261019_1015_tsla');
    expect(within(answer).getByTestId('ai-usage')).toHaveTextContent(/tokens · \$0\.\d{4}/);
    expect(within(answer).getByTestId('ai-disclaimer')).toHaveTextContent('not financial advice');
    expect(db.ai.spentUsd).toBeGreaterThan(0);
  });

  it('a trade-call question gets the refusal and coaching reframe', async () => {
    enable();
    const user = userEvent.setup();
    renderApp('/');
    await user.click(await screen.findByTestId('ai-toggle'));
    const panel = await screen.findByTestId('ai-panel');
    await user.type(within(panel).getByLabelText('Message'), 'Should I buy TSLA now?{Enter}');
    expect(await within(panel).findByTestId('ai-answer')).toHaveTextContent(
      "I can't make trade calls or price predictions",
    );
  });

  it('explains today\'s headlines from the dashboard', async () => {
    enable();
    const user = userEvent.setup();
    renderApp('/');
    const box = await screen.findByTestId('ai-explain-news_summary');
    await user.click(within(box).getByRole('button', { name: "Summarize today's headlines" }));
    expect(await within(box).findByTestId('ai-answer')).toHaveTextContent('headlines for');
  });

  it('explain is disabled with the reason when the cap is reached', async () => {
    enable();
    db.ai.spentUsd = 10;
    renderApp('/');
    const box = await screen.findByTestId('ai-explain-news_summary');
    expect(within(box).getByRole('button', { name: "Summarize today's headlines" })).toBeDisabled();
    expect(box).toHaveTextContent("This month's AI spending cap is reached");
  });

  it('coach card on the Paper account page', async () => {
    enable();
    const user = userEvent.setup();
    renderApp('/paper');
    const card = await screen.findByTestId('ai-coach', {}, { timeout: 3000 });
    const run = within(card).getByRole('button', { name: 'Review my results' });
    await waitFor(() => expect(run).toBeEnabled());
    await user.click(run);
    expect(await within(card).findByTestId('ai-answer')).toHaveTextContent('Experiments to try on paper');
  });

  it('Settings > AI switches it on, picks the model and validates the cap', async () => {
    const user = userEvent.setup();
    renderApp('/settings/ai');
    const sw = await screen.findByRole('switch', { name: 'Use the AI assistant' });
    await waitFor(() => expect(sw).toBeEnabled());
    await user.click(sw);
    await waitFor(() => expect(db.ai.settings.enabled).toBe(true));
    await user.selectOptions(screen.getByLabelText('Model'), 'opus');
    await waitFor(() => expect(db.ai.settings.model).toBe('opus'));
    const cap = screen.getByLabelText('Monthly spending cap (USD)');
    await user.clear(cap);
    await user.type(cap, '5000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter an amount from 0 to 1000')).toBeInTheDocument();
    await user.clear(cap);
    await user.type(cap, '12.5');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(db.ai.settings.monthlyCapUsd).toBe(12.5));
    expect(await screen.findByTestId('ai-spend')).toHaveTextContent('$12.50');
  });

  it('renders light Markdown without HTML injection', () => {
    renderWithProviders(<AiText text={'**Bold** start\n\n- one\n- <b>two</b>'} />);
    expect(screen.getByText('Bold').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('<b>two</b>')).toBeInTheDocument();
  });
});
