import { describe, expect, test, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import type { DriverApiDependencies } from '../src/routes/driver-events.routes.js';

type LookupRouteAccess = NonNullable<DriverApiDependencies['routeAccessService']>['lookupRouteAccess'];
type RecordDriverEvent = DriverApiDependencies['driverEventService']['recordDriverEvent'];

const invitedLookup = {
  status: 'INVITED' as const,
  routeAccess: {
    nextState: 'consent_required' as const,
    routeContext: 'route-plan-id',
    routePlanId: 'route-plan-id'
  },
  companyGuidance: {
    companyDisplayName: 'Tomatono Toronto',
    deliveryDate: '2026-05-12',
    driverInstructions: ['Bring insulated bag'],
    operatorSupportContact: '+14165550000',
    pickupGuidance: 'Meet at dispatch desk by 9:00 AM',
    routeName: 'Tuesday AM Route',
    shopDomain: 'tomatono.myshopify.com',
    timezone: 'America/Toronto'
  }
};

describe('Driver route access lookup route', () => {
  test('rejects phone-only access before repository lookup', async () => {
    const { app, lookupRouteAccess } = await createAppHarness();

    try {
      const response = await app.inject({
        method: 'POST',
        payload: { phoneE164: '+14165550123', routeContext: '' },
        url: '/driver/route-access/lookup'
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        data: null,
        error: { code: 'BAD_REQUEST', message: 'Invalid route access lookup payload' }
      });
      expect(lookupRouteAccess).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test('rejects non-E.164 phone numbers before repository lookup', async () => {
    const { app, lookupRouteAccess } = await createAppHarness();

    try {
      const response = await app.inject({
        method: 'POST',
        payload: { phoneE164: '010-1234-5678', routeContext: 'route-plan-id' },
        url: '/driver/route-access/lookup'
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        data: null,
        error: { code: 'BAD_REQUEST', message: 'Invalid route access lookup payload' }
      });
      expect(lookupRouteAccess).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test('returns company guidance for a matched active driver without stop data', async () => {
    const { app, lookupRouteAccess } = await createAppHarness();

    try {
      const response = await app.inject({
        method: 'POST',
        payload: { phoneE164: '+14165550123', routeContext: ' route-plan-id ' },
        url: '/driver/route-access/lookup'
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        data: invitedLookup,
        error: null
      });
      expect(lookupRouteAccess).toHaveBeenCalledWith({
        phoneE164: '+14165550123',
        routeContext: 'route-plan-id'
      });
      expect(JSON.stringify(response.json())).not.toContain('deliveryStop');
      expect(JSON.stringify(response.json())).not.toContain('address1');
    } finally {
      await app.close();
    }
  });

  test('returns a safe not-found status for route or phone mismatch', async () => {
    const { app, lookupRouteAccess } = await createAppHarness({ status: 'NOT_FOUND' });

    try {
      const response = await app.inject({
        method: 'POST',
        payload: { phoneE164: '+14165550123', routeContext: 'missing-route' },
        url: '/driver/route-access/lookup'
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ data: { status: 'NOT_FOUND' }, error: null });
      expect(lookupRouteAccess).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  test('distinguishes inactive and suspended driver states without guidance', async () => {
    const inactive = await createAppHarness({ status: 'DISABLED' });
    const blocked = await createAppHarness({ status: 'BLOCKED' });

    try {
      const inactiveResponse = await inactive.app.inject({
        method: 'POST',
        payload: { phoneE164: '+14165550123', routeContext: 'route-plan-id' },
        url: '/driver/route-access/lookup'
      });
      const blockedResponse = await blocked.app.inject({
        method: 'POST',
        payload: { phoneE164: '+14165550123', routeContext: 'route-plan-id' },
        url: '/driver/route-access/lookup'
      });

      expect(inactiveResponse.statusCode).toBe(200);
      expect(inactiveResponse.json()).toEqual({ data: { status: 'DISABLED' }, error: null });
      expect(blockedResponse.statusCode).toBe(200);
      expect(blockedResponse.json()).toEqual({ data: { status: 'BLOCKED' }, error: null });
    } finally {
      await inactive.app.close();
      await blocked.app.close();
    }
  });
});

async function createAppHarness(
  override: { status?: 'BLOCKED' | 'DISABLED' | 'NOT_FOUND' } = {}
): Promise<{
  app: Awaited<ReturnType<typeof buildApp>>;
  lookupRouteAccess: ReturnType<typeof vi.fn<LookupRouteAccess>>;
}> {
  const lookupRouteAccess = vi.fn<LookupRouteAccess>(() =>
    Promise.resolve(override.status === undefined ? invitedLookup : { status: override.status })
  );
  const recordDriverEvent = vi.fn<RecordDriverEvent>(() =>
    Promise.resolve({ duplicate: false, eventId: 'unused-driver-event-id' })
  );
  const app = await buildApp({
    driverApi: {
      driverEventService: {
        recordDriverEvent
      },
      jwtSecret: 'driver-secret',
      routeAccessService: {
        lookupRouteAccess
      }
    }
  });

  return { app, lookupRouteAccess };
}
