import type { FastifyInstance } from 'fastify';

import type { ListCanonicalOrdersFilters } from '../modules/shopify/order-sync.repository.js';
import type { ShopifyOrderNode } from '../modules/shopify/order-sync.mapper.js';
import type { SyncOrdersSnapshotInput, SyncOrdersSnapshotResult } from '../modules/shopify/order-sync.service.js';

export type AdminOrdersDependencies = {
  orderSyncService: {
    listCanonicalOrders(input: {
      filters?: ListCanonicalOrdersFilters;
      shopDomain: string;
    }): Promise<SyncOrdersSnapshotResult['orders']>;
    syncOrdersSnapshot(input: SyncOrdersSnapshotInput): Promise<SyncOrdersSnapshotResult>;
  };
  sessionTokenVerifier: {
    verify(sessionToken: string, options?: object): { shopDomain: string; subject: string };
  };
};

export function registerAdminOrdersRoutes(
  app: FastifyInstance,
  dependencies: AdminOrdersDependencies
): void {
  app.patch<{ Body: unknown }>('/admin/orders/sync', async (request, reply) => {
    const authenticated = authenticate(request.headers.authorization, dependencies);
    if (authenticated.status === 'unauthorized') {
      return reply.code(401).send(errorResponse('UNAUTHORIZED', authenticated.message));
    }

    let payload: ReturnType<typeof readSyncPayload>;
    try {
      payload = readSyncPayload(request.body);
    } catch {
      return reply.code(400).send(errorResponse('BAD_REQUEST', 'Invalid order sync payload'));
    }

    const result = await dependencies.orderSyncService.syncOrdersSnapshot({
      ...payload,
      shopDomain: authenticated.shopDomain,
      subject: authenticated.subject
    });

    return reply.code(200).send({ data: result, error: null });
  });

  app.get<{ Querystring: Record<string, string | string[] | undefined> }>(
    '/admin/orders',
    async (request, reply) => {
      const authenticated = authenticate(request.headers.authorization, dependencies);
      if (authenticated.status === 'unauthorized') {
        return reply.code(401).send(errorResponse('UNAUTHORIZED', authenticated.message));
      }

      let filters: ListCanonicalOrdersFilters;
      try {
        filters = readFilters(request.query);
      } catch {
        return reply.code(400).send(errorResponse('BAD_REQUEST', 'Invalid order filters'));
      }

      const orders = await dependencies.orderSyncService.listCanonicalOrders({
        filters,
        shopDomain: authenticated.shopDomain
      });

      return reply.code(200).send({ data: { orders }, error: null });
    }
  );
}

function authenticate(
  authorization: string | undefined,
  dependencies: AdminOrdersDependencies
):
  | { shopDomain: string; status: 'authenticated'; subject: string }
  | { message: string; status: 'unauthorized' } {
  const sessionToken = extractBearerToken(authorization);
  if (sessionToken === null) {
    return { message: 'Missing bearer session token', status: 'unauthorized' };
  }

  try {
    const verified = dependencies.sessionTokenVerifier.verify(sessionToken);
    return { shopDomain: verified.shopDomain, status: 'authenticated', subject: verified.subject };
  } catch {
    return { message: 'Invalid Shopify session token', status: 'unauthorized' };
  }
}

function readSyncPayload(value: unknown): {
  orders: ShopifyOrderNode[];
  reason: SyncOrdersSnapshotInput['reason'];
  source: 'clever-app-orders';
} {
  const object = requireObject(value);
  const source = requireString(object.source);
  if (source !== 'clever-app-orders') {
    throw new Error('invalid source');
  }
  const reason = requireString(object.reason);
  if (
    reason !== 'orders_page_open' &&
    reason !== 'manual_refresh' &&
    reason !== 'route_create_preflight'
  ) {
    throw new Error('invalid reason');
  }
  if (!Array.isArray(object.orders)) {
    throw new Error('orders must be an array');
  }

  return {
    orders: object.orders.map((order) => readShopifyOrderSnapshot(order)),
    reason,
    source
  };
}

function readShopifyOrderSnapshot(value: unknown): ShopifyOrderNode {
  const object = requireObject(value);
  return {
    cancelledAt: readNullableIsoDateString(object.cancelledAt),
    currentTotalPriceSet: readMoneySet(object.currentTotalPriceSet),
    customAttributes: readAttributes(object.customAttributes),
    displayFinancialStatus: readNullableString(object.displayFinancialStatus),
    displayFulfillmentStatus: readNullableString(object.displayFulfillmentStatus),
    email: readNullableString(object.email),
    id: requireString(object.id),
    legacyResourceId: requireString(object.legacyResourceId),
    name: requireString(object.name),
    note: readNullableString(object.note),
    phone: readNullableString(object.phone),
    processedAt: readNullableIsoDateString(object.processedAt),
    shippingAddress: readShippingAddress(object.shippingAddress),
    updatedAt: requireIsoDateString(object.updatedAt)
  };
}

function readMoneySet(value: unknown): ShopifyOrderNode['currentTotalPriceSet'] {
  if (value === null || value === undefined) {
    return null;
  }
  const object = requireObject(value);
  const shopMoney = requireObject(object.shopMoney);
  return {
    shopMoney: {
      amount: requireString(shopMoney.amount),
      currencyCode: requireString(shopMoney.currencyCode)
    }
  };
}

function readAttributes(value: unknown): NonNullable<ShopifyOrderNode['customAttributes']> {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('customAttributes must be an array');
  }
  return value.map((item) => {
    const object = requireObject(item);
    return { key: requireString(object.key), value: requireString(object.value) };
  });
}

function readShippingAddress(value: unknown): ShopifyOrderNode['shippingAddress'] {
  if (value === null || value === undefined) {
    return null;
  }
  const object = requireObject(value);
  return {
    address1: readNullableString(object.address1),
    address2: readNullableString(object.address2),
    city: readNullableString(object.city),
    countryCodeV2: readNullableString(object.countryCodeV2),
    latitude: readNullableNumber(object.latitude),
    longitude: readNullableNumber(object.longitude),
    name: readNullableString(object.name),
    phone: readNullableString(object.phone),
    province: readNullableString(object.province),
    provinceCode: readNullableString(object.provinceCode),
    zip: readNullableString(object.zip)
  };
}

function readFilters(query: Record<string, string | string[] | undefined>): ListCanonicalOrdersFilters {
  const filters: ListCanonicalOrdersFilters = {};
  const readiness = readSingleQuery(query.readiness);
  if (readiness !== null) {
    if (readiness !== 'READY_TO_PLAN' && readiness !== 'NEEDS_REVIEW' && readiness !== 'SKIPPED') {
      throw new Error('invalid readiness');
    }
    filters.readiness = readiness;
  }
  const planned = readSingleQuery(query.planned);
  if (planned !== null) {
    if (planned !== 'true' && planned !== 'false') throw new Error('invalid planned');
    filters.planned = planned === 'true';
  }
  const deliveryWeekday = readSingleQuery(query.deliveryWeekday);
  if (deliveryWeekday !== null) {
    if (deliveryWeekday !== 'THURSDAY' && deliveryWeekday !== 'FRIDAY' && deliveryWeekday !== 'SATURDAY') {
      throw new Error('invalid deliveryWeekday');
    }
    filters.deliveryWeekday = deliveryWeekday;
  }
  const serviceType = readSingleQuery(query.serviceType);
  if (serviceType !== null) {
    if (serviceType !== 'DELIVERY' && serviceType !== 'EVENING_DELIVERY' && serviceType !== 'PICKUP') {
      throw new Error('invalid serviceType');
    }
    filters.serviceType = serviceType;
  }
  const geocodeStatus = readSingleQuery(query.geocodeStatus);
  if (geocodeStatus !== null) {
    if (
      geocodeStatus !== 'PENDING' &&
      geocodeStatus !== 'RESOLVED' &&
      geocodeStatus !== 'FAILED' &&
      geocodeStatus !== 'NOT_REQUIRED'
    ) {
      throw new Error('invalid geocodeStatus');
    }
    filters.geocodeStatus = geocodeStatus;
  }
  const search = readSingleQuery(query.search);
  if (search !== null) filters.search = search;
  return filters;
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

function requireObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('object required');
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('string required');
  }
  return value.trim();
}

function readNullableString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return requireString(value);
}

function requireIsoDateString(value: unknown): string {
  const text = requireString(value);
  if (Number.isNaN(new Date(text).getTime())) {
    throw new Error('date string required');
  }
  return text;
}

function readNullableIsoDateString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return requireIsoDateString(value);
}

function readNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('number required');
  }
  return value;
}

function readSingleQuery(value: string | string[] | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    throw new Error('single query value expected');
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function errorResponse(code: string, message: string): { data: null; error: { code: string; message: string } } {
  return { data: null, error: { code, message } };
}
