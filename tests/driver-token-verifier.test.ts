import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'vitest';

import { signDriverToken, verifyDriverToken } from '../src/modules/driver/driver-token-verifier.js';

const secret = 'driver-secret';
const now = new Date('2026-05-07T06:10:00Z');

describe('verifyDriverToken', () => {
  test('signs a short-lived driver JWT that the verifier accepts', () => {
    const result = signDriverToken(
      {
        driverId: 'driver-id',
        expiresInSeconds: 900,
        shopDomain: 'Example.myshopify.com',
        subject: 'driver:driver-id'
      },
      { now, secret }
    );

    expect(result.expiresAt).toBe('2026-05-07T06:25:00.000Z');
    expect(verifyDriverToken(result.token, { now, secret })).toEqual({
      driverId: 'driver-id',
      shopDomain: 'example.myshopify.com',
      subject: 'driver:driver-id'
    });
  });

  test('accepts a server-issued driver JWT and returns driver context', () => {
    const token = legacySignDriverToken({
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
    const token = `${legacySignDriverToken({
      aud: 'clever-delivery-driver',
      driverId: 'driver-id',
      exp: Math.floor(now.getTime() / 1000) + 60,
      shopDomain: 'example.myshopify.com',
      sub: 'driver-auth-subject'
    }).slice(0, -1)}x`;

    expect(() => verifyDriverToken(token, { now, secret })).toThrow('Invalid driver token signature');
  });
});

function legacySignDriverToken(payload: Record<string, unknown>): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header), 'utf8').toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret).update(signingInput).digest('base64url');

  return `${signingInput}.${signature}`;
}
