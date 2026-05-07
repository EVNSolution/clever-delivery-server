import { createHmac, timingSafeEqual } from 'node:crypto';

const DRIVER_AUDIENCE = 'clever-delivery-driver';

export type VerifiedDriverToken = {
  driverId: string;
  shopDomain: string;
  subject: string;
};

export type VerifyDriverTokenOptions = {
  now?: Date;
  secret: string;
};

type DriverTokenHeader = {
  alg?: unknown;
  typ?: unknown;
};

type DriverTokenClaims = {
  aud?: unknown;
  driverId?: unknown;
  exp?: unknown;
  nbf?: unknown;
  shopDomain?: unknown;
  sub?: unknown;
};

export function verifyDriverToken(
  token: string,
  options: VerifyDriverTokenOptions
): VerifiedDriverToken {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Driver token must be a JWT');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (
    encodedHeader === undefined ||
    encodedPayload === undefined ||
    encodedSignature === undefined
  ) {
    throw new Error('Driver token must be a JWT');
  }

  verifyHeader(encodedHeader);
  verifySignature(`${encodedHeader}.${encodedPayload}`, encodedSignature, options.secret);

  const claims = parseClaims(encodedPayload);
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const audience = requireStringClaim(claims.aud, 'aud');
  const driverId = requireStringClaim(claims.driverId, 'driverId');
  const expiresAt = requireNumberClaim(claims.exp, 'exp');
  const shopDomain = normalizeShopDomain(requireStringClaim(claims.shopDomain, 'shopDomain'));
  const subject = requireStringClaim(claims.sub, 'sub');

  if (audience !== DRIVER_AUDIENCE) {
    throw new Error('Driver token audience mismatch');
  }

  if (expiresAt <= nowSeconds) {
    throw new Error('Driver token has expired');
  }

  if (claims.nbf !== undefined && requireNumberClaim(claims.nbf, 'nbf') > nowSeconds) {
    throw new Error('Driver token is not active yet');
  }

  return { driverId, shopDomain, subject };
}

function verifyHeader(encodedHeader: string): void {
  const header = parseHeader(encodedHeader);
  const algorithm = requireStringClaim(header.alg, 'header alg');
  const tokenType = requireStringClaim(header.typ, 'header typ');

  if (algorithm !== 'HS256' || tokenType !== 'JWT') {
    throw new Error('Driver token algorithm mismatch');
  }
}

function verifySignature(signingInput: string, signature: string, secret: string): void {
  const expected = createHmac('sha256', secret).update(signingInput).digest('base64url');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(signature, 'utf8');

  if (
    expectedBuffer.byteLength !== actualBuffer.byteLength ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw new Error('Invalid driver token signature');
  }
}

function parseHeader(encodedHeader: string): DriverTokenHeader {
  try {
    return JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as DriverTokenHeader;
  } catch (error) {
    throw new Error('Invalid driver token header', { cause: error });
  }
}

function parseClaims(encodedPayload: string): DriverTokenClaims {
  try {
    return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as DriverTokenClaims;
  } catch (error) {
    throw new Error('Invalid driver token payload', { cause: error });
  }
}

function requireStringClaim(value: unknown, claimName: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Driver token ${claimName} claim is required`);
  }

  return value;
}

function requireNumberClaim(value: unknown, claimName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Driver token ${claimName} claim is required`);
  }

  return value;
}

function normalizeShopDomain(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const withoutProtocol = trimmed.replace(/^https?:\/\//u, '').replace(/\/$/u, '');

  if (!withoutProtocol.endsWith('.myshopify.com')) {
    throw new Error('Shop domain must end with .myshopify.com');
  }

  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/u.test(withoutProtocol)) {
    throw new Error('Shop domain is not a valid myshopify.com domain');
  }

  return withoutProtocol;
}
