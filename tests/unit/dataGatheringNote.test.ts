/** The run's "gathering place data" note: honest wording per state, nothing shown when not involved. */
import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('@/components/AutoRefresh', () => ({ AutoRefresh: () => null }));
// The test runner compiles JSX with the classic runtime (React.createElement) — provide React globally.
(globalThis as unknown as { React: typeof React }).React = React;
const { DataGatheringNote, dataStateOf, isGathering } = await import('@/components/DataGatheringNote');

const html = (state: string | null, refreshed: Date | null = null) =>
  renderToStaticMarkup(createElement(DataGatheringNote, { data: dataStateOf({ dataRefreshState: state, dataPendingAt: new Date('2026-10-09T01:00:00Z'), dataRefreshedAt: refreshed }) }));

describe('DataGatheringNote', () => {
  it('says the data is on its way while a back-fill is open', () => {
    for (const s of ['waiting', 'due']) expect(html(s)).toContain('Gathering place data for this area');
    expect(html('running')).toContain('Updating this analysis');
    expect(html('waiting')).toContain('Nothing is estimated');
    expect(isGathering(dataStateOf({ dataRefreshState: 'waiting' }))).toBe(true);
  });
  it('says "updated" only after a recompute with new data', () => {
    expect(html('done', new Date('2026-10-09T03:00:00Z'))).toContain('Updated with new place data');
    expect(html('done', null)).toBe('');
  });
  it('is candid when nothing could be collected', () => {
    expect(html('unavailable')).toContain('still limited');
    expect(html('unavailable')).not.toContain('Updated');
  });
  it('renders nothing for normal runs', () => {
    expect(html(null)).toBe('');
  });
});
