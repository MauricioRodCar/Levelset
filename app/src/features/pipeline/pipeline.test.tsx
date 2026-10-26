import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtures } from '@/api/mock';
import { NVDA_WAIT_RUN_ID } from '@/api/mock/pipelineScenarios';
import { renderApp, resetAppState } from '@/test/render';
import { setupMockServer } from '@/test/server';

// jsdom has no canvas: the chart is replaced by a stub that records its props.
vi.mock('./PriceChart', () => ({
  default: (p: { ariaLabel: string; lines?: { title: string }[] }) => (
    <div
      role="img"
      aria-label={p.ariaLabel}
      data-lines={(p.lines ?? []).map((l) => l.title).join(',')}
    />
  ),
}));

setupMockServer();

beforeEach(async () => {
  await resetAppState();
});

const card = (key: string) =>
  document.querySelector(`button[data-step="${key}"]`) as HTMLButtonElement | null;

async function waitForGrid() {
  await waitFor(() => expect(document.querySelectorAll('button[data-step]')).toHaveLength(8));
}

describe('pipeline view', () => {
  it('renders the 8 steps of the latest run with their statuses', async () => {
    renderApp('/pipeline');
    await waitForGrid();
    const statuses = [...document.querySelectorAll('button[data-step]')].map((b) => [
      b.getAttribute('data-step'),
      b.getAttribute('data-status'),
    ]);
    expect(statuses).toEqual([
      ['scanner', 'done'],
      ['news', 'check'],
      ['entry', 'done'],
      ['exit', 'done'],
      ['timemachine', 'check'],
      ['budget', 'done'],
      ['risk', 'done'],
      ['ticket', 'done'],
    ]);
    // ticket "done" reads Ready; check reasons are translated
    expect(within(card('ticket')!).getByText('Ready')).toBeInTheDocument();
    expect(within(card('news')!).getByText('Earnings this week')).toBeInTheDocument();
    expect(
      within(card('exit')!).getByText(/Stop 358\.32 · target 370\.04 \(1R\)/),
    ).toBeInTheDocument();
    expect(screen.getByText('TSLA')).toBeInTheDocument();
  });

  it('selecting a step shows its detail panel (budget: which limit decided)', async () => {
    const user = userEvent.setup();
    renderApp('/pipeline');
    await waitForGrid();
    await user.click(card('budget')!);
    const detail = await screen.findByTestId('step-detail');
    expect(within(detail).getByText('6. Budget')).toBeInTheDocument();
    expect(
      within(detail).getByText('The max loss per trade limit decided the size: 8 shares.'),
    ).toBeInTheDocument();
    expect(card('budget')).toHaveAttribute('aria-pressed', 'true');
    // raw JSON toggle
    await user.click(within(detail).getByRole('button', { name: 'Raw JSON' }));
    expect(within(detail).getByTestId('raw-json').textContent).toContain('"bound_by": "max loss"');
  });

  it('shows the time machine numbers 29.4 / 25.5 / 45.1 and the history', async () => {
    renderApp('/pipeline?step=timemachine');
    const detail = await screen.findByTestId('step-detail');
    const verdict = await within(detail).findByTestId('tm-verdict');
    expect(verdict.textContent).toMatch(/coin flip/);
    for (const v of ['29.4%', '25.5%', '45.1%']) expect(verdict.textContent).toContain(v);
    expect(within(detail).getByText('Fired')).toBeInTheDocument();
    const row = within(detail).getByText('33').closest('tr')!;
    expect(row.textContent).toBe('3313155');
    expect(within(detail).getByText('Odds are a coin flip')).toBeInTheDocument();
  });

  it('entry and exit draw charts with the levels (labels neutral, from i18n)', async () => {
    renderApp('/pipeline?step=exit');
    const chart = await screen.findByRole('img', { name: /TSLA 5-minute chart with entry/ });
    expect(chart).toHaveAttribute('data-lines', 'Entry,Stop loss,Take profit');
  });

  it('wizard: step-by-step run, 409 when a previous step is missing, then run in order', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/pipeline');
    await waitForGrid();
    await user.click(screen.getByRole('button', { name: 'New run' }));
    const panel = await screen.findByTestId('start-panel');
    await user.type(within(panel).getByRole('textbox'), 'TSLA');
    await user.click(within(panel).getByRole('button', { name: 'Step by step' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/pipeline\/run_demo_/));
    const wizard = await screen.findByTestId('wizard');
    expect(within(wizard).getByText('Step 1 of 8')).toBeInTheDocument();
    expect(within(wizard).getByTestId('explain').textContent).toMatch(/scanner looks at US stocks/);

    // jump ahead: the engine answers 409 previous_step_not_done
    await user.click(card('entry')!);
    await user.click(await screen.findByRole('button', { name: 'Run this step' }));
    expect(await screen.findByText("Run Scanner first (it's Pending).")).toBeInTheDocument();

    await user.click(card('scanner')!);
    await user.click(screen.getByRole('button', { name: 'Run this step' }));
    await waitFor(() => expect(card('scanner')).toHaveAttribute('data-status', 'done'));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(router.state.location.search).toContain('step=news');
    await user.click(screen.getByRole('button', { name: 'Run this step' }));
    await waitFor(() => expect(card('news')).toHaveAttribute('data-status', 'check'));

    // re-running the scanner resets the steps after it
    await user.click(card('scanner')!);
    expect(
      screen.getByText('Running this step again resets the steps after it.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run again' }));
    await waitFor(() => expect(card('news')).toHaveAttribute('data-status', 'pending'));
  });

  it('early stop: a run-all that waits at Entry explains why and offers Check again', async () => {
    const user = userEvent.setup();
    renderApp('/pipeline');
    await waitForGrid();
    await user.click(screen.getByRole('button', { name: 'New run' }));
    const panel = await screen.findByTestId('start-panel');
    await user.type(within(panel).getByRole('textbox'), 'NVDA');
    await user.click(within(panel).getByRole('button', { name: 'Run all' }));
    const banner = await screen.findByTestId('early-stop', {}, { timeout: 4000 });
    expect(within(banner).getByText('Stopped at Entry')).toBeInTheDocument();
    expect(banner.textContent).toMatch(/NVDA hasn't closed above the trigger 186\.90 yet/);
    expect(banner.textContent).toMatch(/5 steps are waiting/);
    expect(card('exit')).toHaveAttribute('data-status', 'pending');

    await user.click(within(banner).getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(screen.getByTestId('early-stop').textContent).toMatch(/0\.18%/));
    await user.click(
      within(screen.getByTestId('early-stop')).getByRole('button', { name: 'Check again' }),
    );
    // triggered: the banner goes away and the run continues step by step
    await waitFor(() => expect(card('entry')).toHaveAttribute('data-status', 'done'));
    expect(screen.queryByTestId('early-stop')).not.toBeInTheDocument();
    expect(await screen.findByTestId('wizard')).toBeInTheDocument();
  });

  it('a past run opens read-only with a banner and no run controls', async () => {
    const user = userEvent.setup();
    const { router } = renderApp(`/pipeline/${NVDA_WAIT_RUN_ID}`);
    const banner = await screen.findByTestId('readonly-banner');
    expect(banner.textContent).toMatch(/past run .* read-only/);
    // the early stop is explained but can't be re-run from history
    expect(screen.getByTestId('early-stop')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('wizard')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Step by step' })).not.toBeInTheDocument();

    // history lists every run; opening one navigates there
    await user.click(screen.getByRole('button', { name: /History/ }));
    const list = await screen.findByRole('dialog', { name: 'Past runs' });
    await waitFor(() =>
      expect(within(list).getAllByRole('button').length).toBeGreaterThanOrEqual(5),
    );
    await user.click(within(list).getByRole('button', { name: /AMD/ }));
    expect(router.state.location.pathname).toBe(`/pipeline/${fixtures.AMD_RUN_ID}`);
    await waitFor(() => expect(card('risk')).toHaveAttribute('data-status', 'blocked'));
    expect(within(card('risk')!).getAllByText(/daily loss limit/).length).toBeGreaterThan(0);

    await user.click(within(screen.getByTestId('readonly-banner')).getByRole('button'));
    expect(router.state.location.pathname).toBe('/pipeline');
    await waitFor(() => expect(screen.queryByTestId('readonly-banner')).not.toBeInTheDocument());
  });

  it('renders in Spanish', async () => {
    await resetAppState({ lang: 'es' });
    renderApp('/pipeline?step=timemachine');
    await waitForGrid();
    expect(within(card('timemachine')!).getByText('Máquina del tiempo')).toBeInTheDocument();
    expect(within(card('ticket')!).getByText('Preparado')).toBeInTheDocument();
    expect(await screen.findByText(/Casi cara o cruz/)).toBeInTheDocument();
  });
});
