import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'vitest';

import { verifyDriverToken } from '../src/modules/driver/driver-token-verifier.js';

const secret = 'driver-secret';
const now = new Date('2026-05-07T06:10:00Z');

describe('verifyDriverToken', () => {
  test('accepts a server-issued driver JWT and returns driver context', () => {
    const token = signDriverToken({
      aud: 'clever-delivery-driver',
      driverId: 'driver-id',
      exp: Math.floor(now.getTime() / 1000) + 60,
      iat: Math.floor(now.getTime() / 1000),
      shopDomain: 'example.myshopify.com',
      sub: 'driver-auth-subject'
    });

    expect(verifyDriverToken(token, { now, secret })).toEqual({
      driverId: 'driver-id',
      shopDomain: 'example.myshopify.com',
      subject: 'driver-auth-subject'
    });
  });

  test('rejects tokens with invalid signatures', () => {
    const token = `${signDriverToken({
      aud: 'clever-delivery-driver',
      driverId: 'driver-id',
      exp: Math.floor(now.getTime() / 1000) + 60,
      shopDomain: 'example.myshopify.com',
      sub: 'driver-auth-subject'
    }).slice(0, -1)}x`;

    expect(() => verifyDriverToken(token, { now, secret })).toThrow('Invalid driver token signature');
  });
});

function signDriverToken(payload: Record<string, unknown>): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header), 'utf8').toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret).update(signingInput).digest('base64url');

  return `${signingInput}.${signature}`;
}
