import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PlaceholderPage } from '@/components/PageHeader';

/**
 * Pipeline — placeholder. Built by WP4 (see docs/SCREENS.md S2 and app/README.md).
 * Routes: /pipeline (latest / new run) and /pipeline/:runId (a stored run, opened from "View flow").
 * Data: usePipelineRuns, usePipelineRun, useStartRun, useRunStep from '@/api'; live progress arrives via SSE
 * (useEngineEvents is already mounted by the shell and updates the run cache).
 */
export default function PipelinePage() {
  const { t } = useTranslation('pipeline');
  const { runId } = useParams();
  return (
    <PlaceholderPage
      title={t('title')}
      description={t('description')}
      note={runId ? t('placeholderRun', { runId }) : t('placeholder')}
    />
  );
}
