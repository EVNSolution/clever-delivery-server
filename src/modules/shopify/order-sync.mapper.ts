export type ShopifyOrderNode = {
  currentTotalPriceSet: {
    shopMoney: {
      amount: string;
      currencyCode: string;
    };
  } | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  email: string | null;
  id: string;
  legacyResourceId: string;
  name: string;
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
  zip: string | null;
};

export type SyncedOrderInput = {
  currencyCode: string | null;
  email: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  name: string;
  phone: string | null;
  processedAt: Date | null;
  rawPayload: ShopifyOrderNode;
  shopifyOrderGid: string;
  shopifyOrderLegacyId: bigint | null;
  totalPriceAmount: string | null;
  updatedAtShopify: Date;
};

export type SyncedDeliveryStopInput = {
  address1: string | null;
  address2: string | null;
  city: string | null;
  countryCode: string | null;
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
  return {
    deliveryStop:
      node.shippingAddress === null ? null : mapShippingAddressToDeliveryStop(node.shippingAddress),
    order: {
      currencyCode: node.currentTotalPriceSet?.shopMoney.currencyCode ?? null,
      email: node.email,
      financialStatus: node.displayFinancialStatus,
      fulfillmentStatus: node.displayFulfillmentStatus,
      name: node.name,
      phone: node.phone,
      processedAt: parseOptionalDate(node.processedAt),
      rawPayload: node,
      shopifyOrderGid: node.id,
      shopifyOrderLegacyId: parseLegacyResourceId(node.legacyResourceId),
      totalPriceAmount: node.currentTotalPriceSet?.shopMoney.amount ?? null,
      updatedAtShopify: parseRequiredDate(node.updatedAt)
    }
  };
}

function mapShippingAddressToDeliveryStop(address: ShopifyShippingAddress): SyncedDeliveryStopInput {
  return {
    address1: address.address1,
    address2: address.address2,
    city: address.city,
    countryCode: address.countryCodeV2,
    instructions: null,
    latitude: address.latitude === null ? null : String(address.latitude),
    longitude: address.longitude === null ? null : String(address.longitude),
    phone: address.phone,
    postalCode: address.zip,
    province: address.province,
    recipientName: address.name
  };
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
