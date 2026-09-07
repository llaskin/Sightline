import { expect } from 'vitest';
import * as clientsRoute from '@/app/api/clients/route';
import * as complaintsRoute from '@/app/api/complaints/route';
import * as importsRoute from '@/app/api/imports/route';
import * as importRoute from '@/app/api/imports/[id]/route';
import * as validateRoute from '@/app/api/imports/[id]/validate/route';
import * as commitRoute from '@/app/api/imports/[id]/commit/route';
import { makeDemoReport } from '@/domain/fixtures/demo-report';
import { makeDemoComplaint } from '@/domain/fixtures/demo-complaint';
import type { TestUser } from './auth';
import { call } from './api';

/**
 * Builds a committed report and a saved complaint through the real API, so
 * downstream tests analyse genuinely persisted data rather than fixtures
 * inserted straight into the database.
 */

export type Scenario = { clientId: string; reportId: string; complaintId: string };

export async function seedReportAndComplaint(
  user: TestUser,
  options: { clientName?: string; tinyTraffic?: boolean } = {},
): Promise<Scenario> {
  const client = await call<{ id: string; revision: number }>(clientsRoute.POST, {
    method: 'POST',
    path: '/api/clients',
    user,
    body: {
      name: options.clientName ?? 'Northstar Services',
      domain: 'example.com',
      timeZone: 'America/New_York',
    },
  });
  expect(client.status).toBe(201);

  const report = makeDemoReport();
  if (options.tinyTraffic) {
    // Below the minimum-sessions floor, so the engine must report
    // insufficient evidence rather than guess a direction.
    report.datasets.organic[0].sessions = 40;
    report.datasets.organic[0].activeUsers = 30;
    report.datasets.organic[0].leadSessions = 2;
    report.datasets.organic[1].sessions = 50;
    report.datasets.organic[1].activeUsers = 40;
    report.datasets.organic[1].leadSessions = 1;
    // The trend buckets that coincide with the summary windows must agree.
    report.datasets.trafficTrend![4] = {
      ...report.datasets.trafficTrend![4],
      sessions: 40,
      activeUsers: 30,
    };
    report.datasets.trafficTrend![5] = {
      ...report.datasets.trafficTrend![5],
      sessions: 50,
      activeUsers: 40,
    };
  }

  const draft = await call<{ id: string; revision: number }>(importsRoute.POST, {
    method: 'POST',
    path: '/api/imports',
    user,
    body: { clientId: client.data.id },
  });
  expect(draft.status).toBe(201);

  const saved = await call<{ revision: number }>(importRoute.PATCH, {
    method: 'PATCH',
    path: `/api/imports/${draft.data.id}`,
    user,
    params: { id: draft.data.id },
    body: {
      expectedRevision: draft.data.revision,
      metadata: report.metadata,
      datasets: report.datasets,
      sources: report.sources,
      selectedForm: report.selectedForm,
      formDefinitionAcknowledged: report.formDefinitionAcknowledged,
      trendGranularity: report.trendGranularity,
    },
  });
  expect(saved.status).toBe(200);

  const validated = await call<{ revision: number; contentHash: string; ok: boolean; errors: unknown[] }>(
    validateRoute.POST,
    {
      method: 'POST',
      path: `/api/imports/${draft.data.id}/validate`,
      user,
      params: { id: draft.data.id },
      body: { expectedRevision: saved.data.revision },
    },
  );
  expect(validated.data.ok, JSON.stringify(validated.data.errors)).toBe(true);

  const committed = await call<{ id: string }>(commitRoute.POST, {
    method: 'POST',
    path: `/api/imports/${draft.data.id}/commit`,
    user,
    params: { id: draft.data.id },
    headers: { 'idempotency-key': `seed-${draft.data.id}` },
    body: { expectedRevision: validated.data.revision, contentHash: validated.data.contentHash },
  });
  expect(committed.status).toBe(201);

  const demoComplaint = makeDemoComplaint();
  const complaint = await call<{ id: string }>(complaintsRoute.POST, {
    method: 'POST',
    path: '/api/complaints',
    user,
    body: { clientId: client.data.id, ...demoComplaint },
  });
  expect(complaint.status).toBe(201);

  return {
    clientId: client.data.id,
    reportId: committed.data.id,
    complaintId: complaint.data.id,
  };
}
