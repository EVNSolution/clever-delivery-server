import type { FastifyInstance } from 'fastify';

import { verifyDriverToken } from '../modules/driver/driver-token-verifier.js';
import type {
  DriverRouteAccessLookupInput,
  DriverRouteAccessServiceContract
} from '../modules/driver/driver-route-access.types.js';

export type DriverApiDependencies = {
  driverEventService: {
    recordDriverEvent(input: {
      clientEventId: string | null;
      deliveryStopId: string | null;
      driverId: string;
      eventType: string;
      latitude: string | null;
      longitude: string | null;
      occurredAt: Date;
      payload: unknown;
      routePlanId: string | null;
      shopDomain: string;
    }): Promise<{ duplicate: boolean; eventId: string }>;
  };
  jwtSecret: string;
  now?: () => Date;
  routeAccessService?: DriverRouteAccessServiceContract;
};

type DriverRouteAccessRequestBody = {
  phoneE164?: unknown;
  routeContext?: unknown;
};

type DriverEventRequestBody = {
  clientEventId?: unknown;
  deliveryStopId?: unknown;
  eventType?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  occurredAt?: unknown;
  routePlanId?: unknown;
};

const DRIVER_EVENT_TYPES = new Set([
  'ROUTE_STARTED',
  'ROUTE_PAUSED',
  'ROUTE_COMPLETED',
  'STOP_ARRIVED',
  'STOP_DELIVERED',
  'STOP_FAILED',
  'LOCATION_UPDATED',
  'NOTE_ADDED'
]);

export function registerDriverEventRoutes(
  app: FastifyInstance,
  dependencies: DriverApiDependencies
): void {
  const routeAccessService = dependencies.routeAccessService;
  if (routeAccessService !== undefined) {
    app.post<{ Body: DriverRouteAccessRequestBody }>(
      '/driver/route-access/lookup',
      async (request, reply) => {
        let lookupInput: DriverRouteAccessLookupInput;
        try {
          lookupInput = readDriverRouteAccessBody(request.body);
        } catch {
          return reply.code(400).send(errorResponse('BAD_REQUEST', 'Invalid route access lookup payload'));
        }

        const result = await routeAccessService.lookupRouteAccess(lookupInput);
        return reply.code(200).send({
          data: result,
          error: null
        });
      }
    );
  }

  app.post<{ Body: DriverEventRequestBody }>('/driver/events', async (request, reply) => {
    const token = extractBearerToken(request.headers.authorization);
    if (token === null) {
      return reply.code(401).send(errorResponse('UNAUTHORIZED', 'Missing driver bearer token'));
    }

    let driverContext: { driverId: string; shopDomain: string };
    try {
      const now = dependencies.now?.();
      driverContext = verifyDriverToken(
        token,
        now === undefined ? { secret: dependencies.jwtSecret } : { now, secret: dependencies.jwtSecret }
      );
    } catch {
      return reply.code(401).send(errorResponse('UNAUTHORIZED', 'Invalid driver bearer token'));
    }

    let eventInput: ReturnType<typeof readDriverEventBody>;
    try {
      eventInput = readDriverEventBody(request.body);
    } catch {
      return reply.code(400).send(errorResponse('BAD_REQUEST', 'Invalid driver event payload'));
    }

    const result = await dependencies.driverEventService.recordDriverEvent({
      ...eventInput,
      driverId: driverContext.driverId,
      payload: request.body,
      shopDomain: driverContext.shopDomain
    });

    return reply.code(result.duplicate ? 200 : 202).send({
      data: {
        duplicate: result.duplicate,
        eventId: result.eventId
      },
      error: null
    });
  });
}


function readDriverRouteAccessBody(body: DriverRouteAccessRequestBody): DriverRouteAccessLookupInput {
  const routeContext = readRequiredString(body.routeContext);
  const phoneE164 = readRequiredString(body.phoneE164);

  if (!/^\+[1-9]\d{7,14}$/u.test(phoneE164)) {
    throw new Error('Invalid E.164 phone');
  }

  return { phoneE164, routeContext };
}

function readDriverEventBody(body: DriverEventRequestBody): {
  clientEventId: string | null;
  deliveryStopId: string | null;
  eventType: string;
  latitude: string | null;
  longitude: string | null;
  occurredAt: Date;
  routePlanId: string | null;
} {
  const eventType = readRequiredString(body.eventType);
  if (!DRIVER_EVENT_TYPES.has(eventType)) {
    throw new Error('Invalid driver event type');
  }

  return {
    clientEventId: readOptionalString(body.clientEventId),
    deliveryStopId: readOptionalString(body.deliveryStopId),
    eventType,
    latitude: readOptionalCoordinate(body.latitude),
    longitude: readOptionalCoordinate(body.longitude),
    occurredAt: readRequiredDate(body.occurredAt),
    routePlanId: readOptionalString(body.routePlanId)
  };
}

function extractBearerToken(authorization: string | undefined): string | null {
  if (authorization === undefined) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/iu.exec(authorization.trim());
  if (match?.[1] === undefined || match[1].trim() === '') {
    return null;
  }

  return match[1].trim();
}

function readRequiredString(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('Required string missing');
  }

  return value.trim();
}

function readOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return readRequiredString(value);
}

function readOptionalCoordinate(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Invalid coordinate');
  }

  return String(value);
}

function readRequiredDate(value: unknown): Date {
  const raw = readRequiredString(value);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date');
  }

  return date;
}

function errorResponse(code: string, message: string): { data: null; error: { code: string; message: string } } {
  return {
    data: null,
    error: { code, message }
  };
}
