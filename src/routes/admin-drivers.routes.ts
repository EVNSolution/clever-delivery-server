import type { FastifyInstance } from 'fastify';

import type { AdminDriverServiceContract, CreatePendingDriverInput } from '../modules/driver/admin-driver.types.js';

export type AdminDriversDependencies = {
  adminDriverService: AdminDriverServiceContract;
  sessionTokenVerifier: {
    verify(sessionToken: string, options?: object): { shopDomain: string; subject: string };
  };
};

type ErrorResponse = {
  data: null;
  error: { code: string; message: string };
};

export function registerAdminDriversRoutes(app: FastifyInstance, dependencies: AdminDriversDependencies): void {
  app.post<{ Body: unknown }>('/admin/drivers', async (request, reply) => {
    const authenticated = authenticate(request.headers.authorization, dependencies);
    if (authenticated.status === 'unauthorized') {
      return reply.code(401).send(errorResponse('UNAUTHORIZED', authenticated.message));
    }

    let payload: DriverInvitePayload;
    try {
      payload = readDriverInvitePayload(request.body);
    } catch {
      return reply.code(400).send(errorResponse('BAD_REQUEST', 'Invalid driver payload'));
    }

    const driver = await dependencies.adminDriverService.createPendingDriver({
      createdBy: authenticated.subject,
      displayName: payload.displayName,
      inviteLink: payload.inviteLink,
      phone: payload.phone,
      shopDomain: authenticated.shopDomain,
      source: payload.source
    });

    return reply.code(201).send({ data: { driver }, error: null });
  });

  app.get('/admin/drivers', async (request, reply) => {
    const authenticated = authenticate(request.headers.authorization, dependencies);
    if (authenticated.status === 'unauthorized') {
      return reply.code(401).send(errorResponse('UNAUTHORIZED', authenticated.message));
    }

    const drivers = await dependencies.adminDriverService.listDrivers({
      shopDomain: authenticated.shopDomain
    });

    return reply.code(200).send({ data: { drivers }, error: null });
  });
}

type DriverInvitePayload = Pick<CreatePendingDriverInput, 'displayName' | 'inviteLink' | 'phone' | 'source'>;

function readDriverInvitePayload(value: unknown): DriverInvitePayload {
  const object = requireObject(value);
  const source = requireNonEmptyString(object.source);
  if (source !== 'clever-app-driver-invite') {
    throw new Error('invalid source');
  }

  return {
    displayName: readNullableString(object.displayName),
    inviteLink: readNullableUrl(object.inviteLink),
    phone: readPhone(object.phone),
    source
  };
}

function authenticate(
  authorization: string | undefined,
  dependencies: AdminDriversDependencies
):
  | { shopDomain: string; status: 'authenticated'; subject: string }
  | { message: string; status: 'unauthorized' } {
  const sessionToken = extractBearerToken(authorization);
  if (sessionToken === null) {
    return { message: 'Missing bearer session token', status: 'unauthorized' };
  }

  try {
    const verified = dependencies.sessionTokenVerifier.verify(sessionToken);
    return {
      shopDomain: verified.shopDomain,
      status: 'authenticated',
      subject: verified.subject
    };
  } catch {
    return { message: 'Invalid Shopify session token', status: 'unauthorized' };
  }
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

function errorResponse(code: string, message: string): ErrorResponse {
  return { data: null, error: { code, message } };
}

function requireObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('object required');
  }

  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('non-empty string required');
  }

  return value.trim();
}

function readNullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = requireNonEmptyString(value);
  return text;
}

function readNullableUrl(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = requireNonEmptyString(value);
  try {
    return new URL(text).toString();
  } catch {
    throw new Error('invalid inviteLink');
  }
}

function readPhone(value: unknown): string {
  const phone = requireNonEmptyString(value);
  if (!/^\+[1-9]\d{6,14}$/u.test(phone)) {
    throw new Error('phone must be E.164');
  }
  return phone;
}
