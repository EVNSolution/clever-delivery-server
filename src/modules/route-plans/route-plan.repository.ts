import type { Prisma, PrismaClient } from '@prisma/client';

import type {
  RoutePlanDepotInput,
  RoutePlanDetail,
  RoutePlanDetailStop,
  RoutePlanOrderAttributeInput,
  RoutePlanOrderInput,
  RoutePlanShippingAddressInput,
  RoutePlanRouteScopeInput,
  RoutePlanSummary
} from './route-plan.types.js';
import type { RoutePlanRepository } from './route-plan.service.js';

const DEFAULT_API_VERSION = '2026-04';
const OPTIMIZER_VERSION = 'manual-sequence-mvp';

type RoutePlanPrismaClient = Pick<
  PrismaClient,
  '$transaction' | 'deliveryStop' | 'order' | 'routePlan' | 'routePlanStop' | 'shop'
>;

type RoutePlanRecord = {
  createdAt: Date;
  depotLatitude: unknown;
  depotLongitude: unknown;
  id: string;
  metrics: unknown;
  name: string;
  planDate: Date;
  routeStops?: RoutePlanStopRecord[];
  status: string;
  updatedAt: Date;
};

type RoutePlanStopRecord = {
  deliveryStop: DeliveryStopRecord;
  deliveryStopId: string;
  sequence: number;
};

type DeliveryStopRecord = {
  address1: string | null;
  address2: string | null;
  city: string | null;
  countryCode: string | null;
  id: string;
  latitude: unknown;
  longitude: unknown;
  order: OrderRecord;
  orderId: string;
  phone: string | null;
  postalCode: string | null;
  province: string | null;
  recipientName: string | null;
  status: string;
};

type OrderRecord = {
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  id: string;
  name: string;
  rawPayload: unknown;
  shippingAddress: unknown;
  shopifyOrderGid: string;
};

export class PrismaRoutePlanRepository implements RoutePlanRepository {
  constructor(private readonly prisma: RoutePlanPrismaClient) {}

  async createRoutePlanDraft(input: {
    createdBy: string;
    depot: RoutePlanDepotInput;
    name: string;
    orders: RoutePlanOrderInput[];
    planDate: string;
    routeScope?: RoutePlanRouteScopeInput;
    shopDomain: string;
  }): Promise<RoutePlanSummary> {
    const shopDomain = normalizeShopDomain(input.shopDomain);
    const planDate = parsePlanDate(input.planDate);
    const metrics = createMetrics(input.orders);
    const constraints = createConstraints(input.depot, input.routeScope);

    return this.prisma.$transaction(async (tx) => {
      const shop = await tx.shop.upsert({
        create: {
          apiVersion: DEFAULT_API_VERSION,
          shopDomain
        },
        update: {},
        where: { shopDomain }
      });
      const deliveryStopIds: string[] = [];

      for (const orderInput of input.orders) {
        const order = await tx.order.upsert({
          create: {
            ...toOrderWrite(orderInput),
            shopId: shop.id
          },
          update: toOrderWrite(orderInput),
          where: {
            shopId_shopifyOrderGid: {
              shopId: shop.id,
              shopifyOrderGid: orderInput.shopifyOrderGid
            }
          }
        });
        const deliveryStop = await tx.deliveryStop.upsert({
          create: {
            ...toDeliveryStopWrite(orderInput, planDate, input.routeScope),
            orderId: order.id,
            shopId: shop.id
          },
          update: toDeliveryStopWrite(orderInput, planDate, input.routeScope),
          where: {
            shopId_orderId: {
              orderId: order.id,
              shopId: shop.id
            }
          }
        });

        deliveryStopIds.push(deliveryStop.id);
      }

      const routePlan = await tx.routePlan.create({
        data: {
          constraints,
          createdBy: input.createdBy,
          depotLatitude: decimalString(input.depot.latitude),
          depotLongitude: decimalString(input.depot.longitude),
          metrics,
          name: input.name,
          optimizerVersion: OPTIMIZER_VERSION,
          planDate,
          shopId: shop.id,
          status: 'DRAFT'
        }
      });

      await tx.routePlanStop.createMany({
        data: deliveryStopIds.map((deliveryStopId, index) => ({
          deliveryStopId,
          routePlanId: routePlan.id,
          sequence: index + 1
        }))
      });

      return toRoutePlanSummary(routePlan, input.orders);
    });
  }

  async listRoutePlans(input: { shopDomain: string }): Promise<RoutePlanSummary[]> {
    const shop = await this.findShop(input.shopDomain);
    if (shop === null) {
      return [];
    }

    const routePlans = await this.prisma.routePlan.findMany({
      include: routePlanInclude(),
      orderBy: { createdAt: 'desc' },
      where: { shopId: shop.id }
    });

    return (routePlans as RoutePlanRecord[]).map((routePlan) => toRoutePlanSummary(routePlan));
  }

  async findRoutePlanDetail(input: {
    routePlanId: string;
    shopDomain: string;
  }): Promise<RoutePlanDetail | null> {
    const shop = await this.findShop(input.shopDomain);
    if (shop === null) {
      return null;
    }

    const routePlan = await this.prisma.routePlan.findFirst({
      include: routePlanInclude(),
      where: {
        id: input.routePlanId,
        shopId: shop.id
      }
    });

    if (routePlan === null) {
      return null;
    }

    const record = routePlan as RoutePlanRecord;
    return {
      routePlan: toRoutePlanSummary(record),
      stops: [...(record.routeStops ?? [])]
        .sort((left, right) => left.sequence - right.sequence)
        .map((routeStop) => toRoutePlanDetailStop(routeStop))
    };
  }

  private async findShop(shopDomain: string): Promise<{ id: string } | null> {
    return this.prisma.shop.findUnique({
      select: { id: true },
      where: { shopDomain: normalizeShopDomain(shopDomain) }
    });
  }
}

function routePlanInclude(): {
  routeStops: {
    include: {
      deliveryStop: {
        include: {
          order: true;
        };
      };
    };
    orderBy: {
      sequence: 'asc';
    };
  };
} {
  return {
    routeStops: {
      include: {
        deliveryStop: {
          include: {
            order: true
          }
        }
      },
      orderBy: {
        sequence: 'asc'
      }
    }
  };
}

function toOrderWrite(input: RoutePlanOrderInput): {
  currencyCode: string | null;
  email: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  name: string;
  phone: string | null;
  processedAt: Date | null;
  rawPayload: Prisma.InputJsonValue;
  shippingAddress: Prisma.InputJsonValue;
  shopifyOrderGid: string;
  shopifyOrderLegacyId: bigint | null;
  totalPriceAmount: string | null;
  updatedAtShopify: Date | null;
} {
  return {
    currencyCode: input.currencyCode,
    email: input.email,
    financialStatus: input.financialStatus,
    fulfillmentStatus: input.fulfillmentStatus,
    name: input.name,
    phone: input.phone,
    processedAt: input.processedAt,
    rawPayload: toJson({
      ...objectOrEmpty(input.rawPayload),
      attributes: input.attributes,
      deliveryArea: input.deliveryArea,
      deliveryDate: input.deliveryDate ?? null,
      deliveryDay: input.deliveryDay,
      deliverySession: input.deliverySession ?? null,
      planningGroupKey: input.planningGroupKey ?? null,
      recipientName: input.recipientName,
      routeScopeKey: input.routeScopeKey ?? null,
      serviceType: input.serviceType ?? null,
      timeWindowEnd: input.timeWindowEnd ?? null,
      timeWindowStart: input.timeWindowStart ?? null
    }),
    shippingAddress: toJson(input.shippingAddress),
    shopifyOrderGid: input.shopifyOrderGid,
    shopifyOrderLegacyId: parseShopifyOrderLegacyId(input.shopifyOrderGid),
    totalPriceAmount: input.totalPriceAmount,
    updatedAtShopify: input.processedAt
  };
}

function toDeliveryStopWrite(
  input: RoutePlanOrderInput,
  planDate: Date,
  routeScope: RoutePlanRouteScopeInput | undefined
): {
  address1: string | null;
  address2: string | null;
  city: string | null;
  countryCode: string | null;
  deliveryDate: Date;
  geocodeStatus: 'PENDING' | 'RESOLVED';
  latitude: string | null;
  longitude: string | null;
  phone: string | null;
  postalCode: string | null;
  province: string | null;
  recipientName: string | null;
  timeWindowEnd: Date | null;
  timeWindowStart: Date | null;
} {
  return {
    address1: input.shippingAddress.address1,
    address2: input.shippingAddress.address2,
    city: input.shippingAddress.city,
    countryCode: input.shippingAddress.countryCode,
    deliveryDate: planDate,
    geocodeStatus: input.latitude === null || input.longitude === null ? 'PENDING' : 'RESOLVED',
    latitude: decimalString(input.latitude),
    longitude: decimalString(input.longitude),
    phone: input.phone,
    postalCode: input.shippingAddress.postalCode,
    province: input.shippingAddress.province,
    recipientName: input.recipientName,
    timeWindowEnd: parseTorontoTimeWindow(routeScope?.deliveryDate ?? null, routeScope?.timeWindowEnd ?? null),
    timeWindowStart: parseTorontoTimeWindow(routeScope?.deliveryDate ?? null, routeScope?.timeWindowStart ?? null)
  };
}

function toRoutePlanSummary(routePlan: RoutePlanRecord, inputOrders?: RoutePlanOrderInput[]): RoutePlanSummary {
  const metrics = readMetrics(routePlan.metrics, inputOrders, routePlan.routeStops ?? []);
  return {
    createdAt: routePlan.createdAt.toISOString(),
    deliveryAreas: metrics.deliveryAreas,
    deliveryDays: metrics.deliveryDays,
    depot: {
      latitude: decimalNumber(routePlan.depotLatitude),
      longitude: decimalNumber(routePlan.depotLongitude)
    },
    id: routePlan.id,
    missingCoordinates: metrics.missingCoordinates,
    name: routePlan.name,
    planDate: formatDateOnly(routePlan.planDate),
    status: routePlan.status,
    stopsCount: metrics.stopsCount,
    updatedAt: routePlan.updatedAt.toISOString()
  };
}

function toRoutePlanDetailStop(routeStop: RoutePlanStopRecord): RoutePlanDetailStop {
  const deliveryStop = routeStop.deliveryStop;
  const order = deliveryStop.order;
  const rawPayload = objectOrNull(order.rawPayload);
  const shippingAddress = readShippingAddress(order.shippingAddress, deliveryStop);
  const attributes = readAttributes(rawPayload);

  return {
    address: shippingAddress,
    attributes,
    coordinates: {
      latitude: decimalNumber(deliveryStop.latitude),
      longitude: decimalNumber(deliveryStop.longitude)
    },
    deliveryArea: readString(rawPayload?.deliveryArea) ?? readAttribute(attributes, 'Delivery Area'),
    deliveryDay: readString(rawPayload?.deliveryDay) ?? readAttribute(attributes, 'Delivery Day'),
    deliveryStopId: deliveryStop.id,
    financialStatus: order.financialStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    orderId: order.id,
    orderName: order.name,
    paymentStatus: order.financialStatus,
    recipientName: deliveryStop.recipientName ?? readString(rawPayload?.recipientName),
    sequence: routeStop.sequence,
    shopifyOrderGid: order.shopifyOrderGid,
    status: deliveryStop.status
  };
}

function createMetrics(orders: RoutePlanOrderInput[]): Prisma.InputJsonObject {
  return {
    deliveryAreas: uniqueStrings(orders.map((order) => order.deliveryArea)),
    deliveryDays: uniqueStrings(orders.map((order) => order.deliveryDay)),
    missingCoordinates: orders.filter((order) => order.latitude === null || order.longitude === null).length,
    stopsCount: orders.length
  };
}

function createConstraints(
  depot: RoutePlanDepotInput,
  routeScope: RoutePlanRouteScopeInput | undefined
): Prisma.InputJsonObject {
  return {
    depot: {
      address: depot.address,
      latitude: depot.latitude,
      longitude: depot.longitude
    },
    optimizer: OPTIMIZER_VERSION,
    routeScope: routeScope ?? null,
    sequenceSource: 'request-order'
  };
}

function readMetrics(
  value: unknown,
  inputOrders: RoutePlanOrderInput[] | undefined,
  routeStops: RoutePlanStopRecord[]
): {
  deliveryAreas: string[];
  deliveryDays: string[];
  missingCoordinates: number;
  stopsCount: number;
} {
  const object = objectOrNull(value);
  const fallbackOrders = inputOrders ?? [];
  return {
    deliveryAreas: readStringArray(object?.deliveryAreas) ?? deriveStrings(fallbackOrders, routeStops, 'area'),
    deliveryDays: readStringArray(object?.deliveryDays) ?? deriveStrings(fallbackOrders, routeStops, 'day'),
    missingCoordinates:
      readFiniteNumber(object?.missingCoordinates) ??
      (inputOrders ?? routeStops).filter((item) =>
        'latitude' in item
          ? item.latitude === null || item.longitude === null
          : item.deliveryStop.latitude === null || item.deliveryStop.longitude === null
      ).length,
    stopsCount: readFiniteNumber(object?.stopsCount) ?? (inputOrders?.length ?? routeStops.length)
  };
}

function deriveStrings(
  inputOrders: RoutePlanOrderInput[],
  routeStops: RoutePlanStopRecord[],
  kind: 'area' | 'day'
): string[] {
  if (inputOrders.length > 0) {
    return uniqueStrings(inputOrders.map((order) => (kind === 'area' ? order.deliveryArea : order.deliveryDay)));
  }

  return uniqueStrings(
    routeStops.map((routeStop) => {
      const rawPayload = objectOrNull(routeStop.deliveryStop.order.rawPayload);
      const attributes = readAttributes(rawPayload);
      return kind === 'area'
        ? readString(rawPayload?.deliveryArea) ?? readAttribute(attributes, 'Delivery Area')
        : readString(rawPayload?.deliveryDay) ?? readAttribute(attributes, 'Delivery Day');
    })
  );
}

function readShippingAddress(
  value: unknown,
  fallback: DeliveryStopRecord
): RoutePlanShippingAddressInput {
  const object = objectOrNull(value);
  return {
    address1: readString(object?.address1) ?? fallback.address1,
    address2: readString(object?.address2) ?? fallback.address2,
    city: readString(object?.city) ?? fallback.city,
    countryCode: readString(object?.countryCode) ?? fallback.countryCode,
    postalCode: readString(object?.postalCode) ?? fallback.postalCode,
    province: readString(object?.province) ?? fallback.province
  };
}

function readAttributes(value: Record<string, unknown> | null): RoutePlanOrderAttributeInput[] {
  if (!Array.isArray(value?.attributes)) {
    return [];
  }

  return value.attributes.flatMap((attribute) => {
    const object = objectOrNull(attribute);
    const key = readString(object?.key);
    const valueText = readString(object?.value);
    if (key === null || valueText === null) {
      return [];
    }

    return [{ key, value: valueText }];
  });
}

function readAttribute(attributes: RoutePlanOrderAttributeInput[], key: string): string | null {
  return attributes.find((attribute) => attribute.key.toLowerCase() === key.toLowerCase())?.value ?? null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return null;
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return objectOrNull(value) ?? {};
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function uniqueStrings(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => value !== null && value.trim() !== ''))];
}

function decimalString(value: number | null): string | null {
  return value === null ? null : String(value);
}

function decimalNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}


function parseTorontoTimeWindow(deliveryDate: string | null, time: string | null): Date | null {
  if (deliveryDate === null || time === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(deliveryDate) || !/^\d{2}:\d{2}$/u.test(time)) return null;
  return new Date(`${deliveryDate}T${time}:00-04:00`);
}

function parsePlanDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseShopifyOrderLegacyId(value: string): bigint | null {
  const match = /\/(\d+)$/u.exec(value);
  if (match?.[1] === undefined) {
    return null;
  }

  return BigInt(match[1]);
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
