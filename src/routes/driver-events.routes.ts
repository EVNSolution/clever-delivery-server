import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MultipartFile, MultipartValue } from '@fastify/multipart';

import { signDriverToken, verifyDriverToken } from '../modules/driver/driver-token-verifier.js';
import type { DriverAssignedRouteServiceContract } from '../modules/driver/driver-assigned-route.types.js';
import type {
  DriverConsentRecordInput,
  DriverConsentServiceContract,
  RecordDriverConsentsInput
} from '../modules/driver/driver-consent.types.js';
import type {
  DriverRouteAccessInvitedRoute,
  DriverRouteAccessLookupInput,
  DriverRouteAccessLookupResult,
  DriverRouteAccessServiceContract
} from '../modules/driver/driver-route-access.types.js';
import {
  DriverProofMediaAccessUnavailableError,
  DriverProofMediaScanRejectedError,
  DriverProofMediaScopeError
} from '../modules/driver/driver-proof-media.types.js';
import type {
  DriverProofMediaServiceContract,
  DriverProofMediaSource,
  StoreDriverProofMediaInput
} from '../modules/driver/driver-proof-media.types.js';

export type DriverApiDependencies = {
  driverAssignedRouteService?: DriverAssignedRouteServiceContract;
  driverConsentService?: DriverConsentServiceContract;
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
  proofMediaService?: DriverProofMediaServiceContract;
  now?: () => Date;
  routeAccessService?: DriverRouteAccessServiceContract;
};

type DriverRouteAccessRequestBody = {
  phoneE164?: unknown;
  routeContext?: unknown;
};

type DriverAssignedRouteQuery = {
  routeContext?: unknown;
};

type DriverConsentRequestBody = {
  appContext?: unknown;
  consents?: unknown;
  deviceContext?: unknown;
  recordedAt?: unknown;
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

type DriverProofMediaAccessParams = {
  mediaId?: unknown;
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

const REQUIRED_DRIVER_CONSENT_TYPES = [
  'LOCATION_INFORMATION',
  'PERSONAL_INFORMATION'
] as const;
const REQUIRED_DRIVER_CONSENT_TYPE_SET = new Set<string>(REQUIRED_DRIVER_CONSENT_TYPES);
const DRIVER_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

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
          data: buildDriverRouteAccessResponse(result, dependencies),
          error: null
        });
      }
    );
  }

  const driverAssignedRouteService = dependencies.driverAssignedRouteService;
  if (driverAssignedRouteService !== undefined) {
    app.get<{ Querystring: DriverAssignedRouteQuery }>('/driver/assigned-route', async (request, reply) => {
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

      let routeContext: string | null;
      try {
        routeContext = readOptionalString(request.query.routeContext);
      } catch {
        return reply.code(400).send(errorResponse('BAD_REQUEST', 'Invalid driver assigned route query'));
      }

      const result = await driverAssignedRouteService.getAssignedRoute({
        driverId: driverContext.driverId,
        routeContext,
        shopDomain: driverContext.shopDomain
      });

      return reply.code(200).send({
        data: result,
        error: null
      });
    });
  }

  const driverConsentService = dependencies.driverConsentService;
  if (driverConsentService !== undefined) {
    app.post<{ Body: DriverConsentRequestBody }>('/driver/consents', async (request, reply) => {
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

      let consentInput: Omit<RecordDriverConsentsInput, 'driverId' | 'shopDomain'>;
      try {
        consentInput = readDriverConsentBody(request.body, dependencies.now?.() ?? new Date());
      } catch {
        return reply.code(400).send(errorResponse('BAD_REQUEST', 'Invalid driver consent payload'));
      }

      const result = await driverConsentService.recordDriverConsents({
        ...consentInput,
        driverId: driverContext.driverId,
        shopDomain: driverContext.shopDomain
      });

      return reply.code(201).send({
        data: result,
        error: null
      });
    });
  }


  const proofMediaService = dependencies.proofMediaService;
  if (proofMediaService !== undefined) {
    app.get<{ Params: DriverProofMediaAccessParams }>('/driver/proof-media/:mediaId/access', async (request, reply) => {
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

      let mediaId: string;
      try {
        mediaId = readRequiredString(request.params.mediaId);
      } catch {
        return reply.code(400).send(errorResponse('BAD_REQUEST', 'Invalid proof media access request'));
      }

      try {
        const result = await proofMediaService.createProofMediaReadAccess({
          driverId: driverContext.driverId,
          mediaId,
          shopDomain: driverContext.shopDomain
        });

        return reply.code(200).send({
          data: result,
          error: null
        });
      } catch (error) {
        if (isProofMediaScopeError(error)) {
          return reply.code(403).send(errorResponse('FORBIDDEN', 'Proof media route scope rejected'));
        }
        if (isProofMediaAccessUnavailableError(error)) {
          return reply
            .code(503)
            .send(errorResponse('PROOF_MEDIA_ACCESS_UNAVAILABLE', 'Proof media access is not configured'));
        }

        throw error;
      }
    });

    app.post('/driver/proof-media', async (request, reply) => {
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

      let uploadInput: Omit<StoreDriverProofMediaInput, 'driverId' | 'shopDomain'>;
      try {
        uploadInput = await readDriverProofMediaUpload(request);
      } catch {
        return reply.code(400).send(errorResponse('BAD_REQUEST', 'Invalid proof media upload payload'));
      }

      try {
        const result = await proofMediaService.storeProofMedia({
          ...uploadInput,
          driverId: driverContext.driverId,
          shopDomain: driverContext.shopDomain
        });

        return reply.code(201).send({
          data: result,
          error: null
        });
      } catch (error) {
        if (isProofMediaScopeError(error)) {
          return reply.code(403).send(errorResponse('FORBIDDEN', 'Proof media route scope rejected'));
        }
        if (isProofMediaScanRejectedError(error)) {
          return reply
            .code(422)
            .send(errorResponse('PROOF_MEDIA_REJECTED', 'Proof media rejected by safety scan'));
        }

        throw error;
      }
    });
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


function buildDriverRouteAccessResponse(
  result: DriverRouteAccessLookupResult,
  dependencies: DriverApiDependencies
): unknown {
  if (result.status === 'ROUTES_FOUND') {
    return {
      status: 'ROUTES_FOUND',
      routes: result.routes.map((route) => buildInvitedDriverRouteAccessResponse(route, dependencies))
    };
  }

  if (result.status !== 'INVITED') {
    return result;
  }

  return buildInvitedDriverRouteAccessResponse(result, dependencies);
}

function buildInvitedDriverRouteAccessResponse(
  result: DriverRouteAccessInvitedRoute,
  dependencies: DriverApiDependencies
): unknown {
  const now = dependencies.now?.();
  const token = signDriverToken(
    {
      driverId: result.driverContext.driverId,
      expiresInSeconds: DRIVER_ACCESS_TOKEN_TTL_SECONDS,
      shopDomain: result.driverContext.shopDomain,
      subject: `driver:${result.driverContext.driverId}`
    },
    now === undefined ? { secret: dependencies.jwtSecret } : { now, secret: dependencies.jwtSecret }
  );

  return {
    companyGuidance: result.companyGuidance,
    driverAccess: {
      accessToken: token.token,
      expiresAt: token.expiresAt,
      tokenType: token.tokenType,
      ttlSeconds: DRIVER_ACCESS_TOKEN_TTL_SECONDS,
      use: 'consent_and_assigned_route'
    },
    routeAccess: result.routeAccess,
    status: result.status
  };
}

function readDriverRouteAccessBody(body: DriverRouteAccessRequestBody): DriverRouteAccessLookupInput {
  const routeContext = readOptionalString(body.routeContext);
  const phoneE164 = readRequiredString(body.phoneE164);

  if (!/^\+[1-9]\d{7,14}$/u.test(phoneE164)) {
    throw new Error('Invalid E.164 phone');
  }

  return { phoneE164, routeContext };
}

function readDriverConsentBody(
  body: DriverConsentRequestBody,
  fallbackRecordedAt: Date
): Omit<RecordDriverConsentsInput, 'driverId' | 'shopDomain'> {
  if (!Array.isArray(body.consents)) {
    throw new Error('Consents are required');
  }

  const consents = body.consents.map(readDriverConsentItem);
  const consentTypes = new Set(consents.map((consent) => consent.type));
  if (consents.length !== REQUIRED_DRIVER_CONSENT_TYPES.length) {
    throw new Error('Required driver consent set mismatch');
  }

  for (const consentType of REQUIRED_DRIVER_CONSENT_TYPES) {
    if (!consentTypes.has(consentType)) {
      throw new Error('Required driver consent missing');
    }
  }

  return {
    appContext: readOptionalObject(body.appContext),
    consents,
    deviceContext: readOptionalObject(body.deviceContext),
    recordedAt: readOptionalDate(body.recordedAt) ?? fallbackRecordedAt,
    routeContext: readOptionalString(body.routeContext)
  };
}

function readDriverConsentItem(value: unknown): DriverConsentRecordInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid driver consent item');
  }

  const record = value as Record<string, unknown>;
  const type = readRequiredString(record.type);
  if (!isDriverConsentType(type)) {
    throw new Error('Invalid driver consent type');
  }

  if (record.accepted !== true) {
    throw new Error('Required driver consent must be accepted');
  }

  return {
    accepted: true,
    type,
    version: readRequiredString(record.version)
  };
}

function isDriverConsentType(value: string): value is DriverConsentRecordInput['type'] {
  return REQUIRED_DRIVER_CONSENT_TYPE_SET.has(value);
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


async function readDriverProofMediaUpload(
  request: FastifyRequest
): Promise<Omit<StoreDriverProofMediaInput, 'driverId' | 'shopDomain'>> {
  if (!request.isMultipart()) {
    throw new Error('Proof media upload must be multipart');
  }

  const file = await request.file({
    limits: {
      fields: 3,
      fileSize: 10 * 1024 * 1024,
      files: 1,
      parts: 4
    }
  });

  if (file === undefined || file.fieldname !== 'file') {
    throw new Error('Proof media file is required');
  }

  const deliveryStopId = readMultipartField(file, 'deliveryStopId');
  const routePlanId = readMultipartField(file, 'routePlanId');
  const source = readProofMediaSource(readMultipartField(file, 'source'));
  const fileBytes = await file.toBuffer();
  if (fileBytes.byteLength === 0) {
    throw new Error('Proof media file is empty');
  }

  const contentType = readProofMediaContentType(file.mimetype);

  return {
    contentType,
    deliveryStopId,
    fileBytes,
    filename: readRequiredString(file.filename),
    routePlanId,
    source
  };
}

function readMultipartField(file: MultipartFile, fieldName: string): string {
  const field = file.fields[fieldName];
  const value = Array.isArray(field) ? field[0] : field;
  if (value === undefined || value.type !== 'field') {
    throw new Error(`Multipart field missing: ${fieldName}`);
  }

  return readMultipartFieldValue(value);
}

function readMultipartFieldValue(field: MultipartValue): string {
  if (typeof field.value !== 'string') {
    throw new Error('Multipart field value must be a string');
  }

  return readRequiredString(field.value);
}


function readProofMediaContentType(value: unknown): string {
  const contentType = readRequiredString(value).toLowerCase();
  if (!contentType.startsWith('image/')) {
    throw new Error('Proof media file must be an image');
  }

  return contentType;
}

function readProofMediaSource(value: string): DriverProofMediaSource {
  if (value === 'camera' || value === 'library') {
    return value;
  }

  throw new Error('Invalid proof media source');
}


function isProofMediaScopeError(error: unknown): boolean {
  return error instanceof DriverProofMediaScopeError;
}

function isProofMediaScanRejectedError(error: unknown): boolean {
  return error instanceof DriverProofMediaScanRejectedError;
}

function isProofMediaAccessUnavailableError(error: unknown): boolean {
  return error instanceof DriverProofMediaAccessUnavailableError;
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

function readOptionalObject(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid object');
  }

  return value as Record<string, unknown>;
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

function readOptionalDate(value: unknown): Date | null {
  if (value === undefined || value === null) {
    return null;
  }

  return readRequiredDate(value);
}

function errorResponse(code: string, message: string): { data: null; error: { code: string; message: string } } {
  return {
    data: null,
    error: { code, message }
  };
}
