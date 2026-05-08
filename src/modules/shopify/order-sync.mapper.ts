export type ShopifyOrderAttribute = {
  key: string;
  value: string;
};

export type ShopifyOrderNode = {
  cancelledAt?: string | null;
  currentTotalPriceSet: {
    shopMoney: {
      amount: string;
      currencyCode: string;
    };
  } | null;
  customAttributes?: ShopifyOrderAttribute[] | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  email: string | null;
  id: string;
  legacyResourceId: string;
  name: string;
  note?: string | null;
  phone: string | null;
  processedAt: string | null;
  shippingAddress: ShopifyShippingAddress | null;
  updatedAt: string;
};

type ShopifyShippingAddress = {
  address1: string | null;
  address2: string | null;
  city: string | null;
  countryCodeV2: string | null;
  latitude: number | null;
  longitude: number | null;
  name: string | null;
  phone: string | null;
  province: string | null;
  provinceCode?: string | null;
  zip: string | null;
};

export type DeliveryWeekday = 'THURSDAY' | 'FRIDAY' | 'SATURDAY';
export type DeliveryServiceType = 'DELIVERY' | 'EVENING_DELIVERY' | 'PICKUP';
export type CanonicalOrderReadiness = 'READY_TO_PLAN' | 'NEEDS_REVIEW' | 'SKIPPED';
export type PlanningStatus = 'UNPLANNED' | 'PLANNED';

export type CanonicalOrderRow = {
  cancelledAt: string | null;
  currencyCode: string | null;
  deliveryArea: string | null;
  deliveryDayRaw: string | null;
  deliveryStopId: string | null;
  deliveryWeekday: DeliveryWeekday | null;
  email: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  geocodeStatus: 'PENDING' | 'RESOLVED' | 'FAILED' | 'NOT_REQUIRED';
  hasCoordinates: boolean;
  latitude: number | null;
  longitude: number | null;
  name: string;
  orderId: string;
  phone: string | null;
  pickup: boolean;
  planningStatus: PlanningStatus;
  processedAt: string | null;
  readiness: CanonicalOrderReadiness;
  recipientName: string | null;
  reviewReasons: string[];
  serviceType: DeliveryServiceType | null;
  shippingAddress: {
    address1: string | null;
    address2: string | null;
    city: string | null;
    countryCode: string | null;
    postalCode: string | null;
    province: string | null;
  };
  shopifyOrderGid: string;
  shopifyOrderLegacyId: string | null;
  timeWindowEnd: string | null;
  timeWindowStart: string | null;
  totalPriceAmount: string | null;
  updatedAtShopify: string | null;
};

export type SyncedOrderInput = {
  cancelledAt: Date | null;
  currencyCode: string | null;
  deliveryArea: string | null;
  deliveryDayRaw: string | null;
  deliveryWeekday: DeliveryWeekday | null;
  email: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  name: string;
  phone: string | null;
  pickup: boolean;
  processedAt: Date | null;
  rawPayload: ShopifyOrderNode & Record<string, unknown>;
  readiness: CanonicalOrderReadiness;
  reviewReasons: string[];
  serviceType: DeliveryServiceType | null;
  shopifyOrderGid: string;
  shopifyOrderLegacyId: bigint | null;
  timeWindowEnd: string | null;
  timeWindowStart: string | null;
  totalPriceAmount: string | null;
  updatedAtShopify: Date;
};

export type SyncedDeliveryStopInput = {
  address1: string | null;
  address2: string | null;
  city: string | null;
  countryCode: string | null;
  geocodeStatus: 'PENDING' | 'RESOLVED';
  instructions: string | null;
  latitude: string | null;
  longitude: string | null;
  phone: string | null;
  postalCode: string | null;
  province: string | null;
  recipientName: string | null;
};

export type SyncedOrderWithDeliveryStopInput = {
  deliveryStop: SyncedDeliveryStopInput | null;
  order: SyncedOrderInput;
};

export function mapShopifyOrderNodeToDeliveryInputs(
  node: ShopifyOrderNode
): SyncedOrderWithDeliveryStopInput {
  const attributes = normalizeAttributes(node.customAttributes ?? []);
  const deliveryArea = readAttribute(attributes, 'Delivery Area');
  const deliveryDayRaw = readAttribute(attributes, 'Delivery Day');
  const pickupDay = readAttribute(attributes, 'Pickup Day');
  const parsedDeliveryDay = parseDeliveryDay(deliveryDayRaw);
  const pickup = pickupDay !== null;
  const hasShippingAddress = node.shippingAddress !== null && hasAddress(node.shippingAddress);
  const hasCoordinates =
    node.shippingAddress?.latitude !== null &&
    node.shippingAddress?.latitude !== undefined &&
    node.shippingAddress.longitude !== null &&
    node.shippingAddress.longitude !== undefined;
  const cancelledAt = parseOptionalDate(node.cancelledAt ?? null);
  const reviewReasons = buildReviewReasons({
    cancelledAt,
    deliveryArea,
    deliveryDayRaw,
    hasCoordinates,
    hasShippingAddress,
    parsedDeliveryDay
  });
  const readiness: CanonicalOrderReadiness =
    cancelledAt !== null ? 'NEEDS_REVIEW' : reviewReasons.length === 0 ? 'READY_TO_PLAN' : 'NEEDS_REVIEW';
  const serviceType = pickup ? 'PICKUP' : parsedDeliveryDay.serviceType;

  return {
    deliveryStop:
      node.shippingAddress === null
        ? null
        : mapShippingAddressToDeliveryStop(node.shippingAddress, node.note ?? null, hasCoordinates),
    order: {
      cancelledAt,
      currencyCode: node.currentTotalPriceSet?.shopMoney.currencyCode ?? null,
      deliveryArea,
      deliveryDayRaw,
      deliveryWeekday: parsedDeliveryDay.weekday,
      email: node.email,
      financialStatus: node.displayFinancialStatus,
      fulfillmentStatus: node.displayFulfillmentStatus,
      name: node.name,
      phone: node.phone,
      pickup,
      processedAt: parseOptionalDate(node.processedAt),
      rawPayload: {
        ...node,
        attributes,
        deliveryArea,
        deliveryDayRaw,
        deliveryWeekday: parsedDeliveryDay.weekday,
        pickup,
        readiness,
        reviewReasons,
        serviceType,
        timeWindowEnd: parsedDeliveryDay.timeWindowEnd,
        timeWindowStart: parsedDeliveryDay.timeWindowStart
      },
      readiness,
      reviewReasons,
      serviceType,
      shopifyOrderGid: node.id,
      shopifyOrderLegacyId: parseLegacyResourceId(node.legacyResourceId),
      timeWindowEnd: parsedDeliveryDay.timeWindowEnd,
      timeWindowStart: parsedDeliveryDay.timeWindowStart,
      totalPriceAmount: node.currentTotalPriceSet?.shopMoney.amount ?? null,
      updatedAtShopify: parseRequiredDate(node.updatedAt)
    }
  };
}

function mapShippingAddressToDeliveryStop(
  address: ShopifyShippingAddress,
  note: string | null,
  hasCoordinates: boolean
): SyncedDeliveryStopInput {
  return {
    address1: address.address1,
    address2: address.address2,
    city: address.city,
    countryCode: address.countryCodeV2,
    geocodeStatus: hasCoordinates ? 'RESOLVED' : 'PENDING',
    instructions: normalizeOptionalString(note),
    latitude: address.latitude === null ? null : String(address.latitude),
    longitude: address.longitude === null ? null : String(address.longitude),
    phone: address.phone,
    postalCode: address.zip,
    province: address.province,
    recipientName: address.name
  };
}

function buildReviewReasons(input: {
  cancelledAt: Date | null;
  deliveryArea: string | null;
  deliveryDayRaw: string | null;
  hasCoordinates: boolean;
  hasShippingAddress: boolean;
  parsedDeliveryDay: ParsedDeliveryDay;
}): string[] {
  const reasons: string[] = [];
  if (!input.hasShippingAddress) reasons.push('missing_address');
  if (input.deliveryArea === null) reasons.push('missing_delivery_area');
  if (input.deliveryDayRaw === null) reasons.push('missing_delivery_day');
  if (input.deliveryDayRaw !== null && input.parsedDeliveryDay.weekday === null) {
    reasons.push('delivery_day_parse_failed');
  }
  if (!input.hasCoordinates) reasons.push('missing_coordinates');
  if (input.cancelledAt !== null) reasons.push('cancelled_order');
  return reasons;
}

type ParsedDeliveryDay = {
  serviceType: Exclude<DeliveryServiceType, 'PICKUP'> | null;
  timeWindowEnd: string | null;
  timeWindowStart: string | null;
  weekday: DeliveryWeekday | null;
};

function parseDeliveryDay(value: string | null): ParsedDeliveryDay {
  if (value === null) {
    return { serviceType: null, timeWindowEnd: null, timeWindowStart: null, weekday: null };
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'thursday') {
    return { serviceType: 'DELIVERY', timeWindowEnd: null, timeWindowStart: null, weekday: 'THURSDAY' };
  }
  if (normalized === 'friday') {
    return { serviceType: 'DELIVERY', timeWindowEnd: null, timeWindowStart: null, weekday: 'FRIDAY' };
  }
  if (normalized === 'saturday') {
    return { serviceType: 'DELIVERY', timeWindowEnd: null, timeWindowStart: null, weekday: 'SATURDAY' };
  }
  if (/^friday\s+5\s*pm\s+to\s+9\s*pm/iu.test(value)) {
    return {
      serviceType: 'EVENING_DELIVERY',
      timeWindowEnd: '21:00',
      timeWindowStart: '17:00',
      weekday: 'FRIDAY'
    };
  }

  return { serviceType: null, timeWindowEnd: null, timeWindowStart: null, weekday: null };
}

function hasAddress(address: ShopifyShippingAddress): boolean {
  return [address.address1, address.city, address.zip, address.countryCodeV2].some(
    (value) => normalizeOptionalString(value) !== null
  );
}

function normalizeAttributes(value: ShopifyOrderAttribute[]): ShopifyOrderAttribute[] {
  return value.flatMap((attribute) => {
    const key = normalizeOptionalString(attribute.key);
    const attributeValue = normalizeOptionalString(attribute.value);
    if (key === null || attributeValue === null) {
      return [];
    }
    return [{ key, value: attributeValue }];
  });
}

function readAttribute(attributes: ShopifyOrderAttribute[], key: string): string | null {
  return attributes.find((attribute) => attribute.key.toLowerCase() === key.toLowerCase())?.value ?? null;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function parseLegacyResourceId(value: string): bigint | null {
  if (!/^\d+$/u.test(value)) {
    return null;
  }

  return BigInt(value);
}

function parseOptionalDate(value: string | null): Date | null {
  if (value === null) {
    return null;
  }

  return parseRequiredDate(value);
}

function parseRequiredDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid Shopify order timestamp: ${value}`);
  }

  return date;
}
