export type RoutePlanDepotInput = {
  address: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type RoutePlanOrderAttributeInput = {
  key: string;
  value: string;
};

export type RoutePlanShippingAddressInput = {
  address1: string | null;
  address2: string | null;
  city: string | null;
  countryCode: string | null;
  postalCode: string | null;
  province: string | null;
};

export type RoutePlanOrderInput = {
  attributes: RoutePlanOrderAttributeInput[];
  currencyCode: string | null;
  deliveryArea: string | null;
  deliveryDay: string | null;
  email: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  latitude: number | null;
  longitude: number | null;
  name: string;
  phone: string | null;
  processedAt: Date | null;
  rawPayload: unknown;
  recipientName: string | null;
  shippingAddress: RoutePlanShippingAddressInput;
  shopifyOrderGid: string;
  totalPriceAmount: string | null;
};

export type CreateRoutePlanPayload = {
  depot: RoutePlanDepotInput;
  name: string;
  orders: RoutePlanOrderInput[];
  planDate: string;
};

export type CreateRoutePlanInput = {
  createdBy: string;
  payload: CreateRoutePlanPayload;
  shopDomain: string;
};

export type RoutePlanSummary = {
  createdAt: string;
  deliveryAreas: string[];
  deliveryDays: string[];
  depot: {
    latitude: number | null;
    longitude: number | null;
  };
  id: string;
  missingCoordinates: number;
  name: string;
  planDate: string;
  status: string;
  stopsCount: number;
  updatedAt: string;
};

export type RoutePlanDetailStop = {
  address: RoutePlanShippingAddressInput;
  attributes: RoutePlanOrderAttributeInput[];
  coordinates: {
    latitude: number | null;
    longitude: number | null;
  };
  deliveryArea: string | null;
  deliveryDay: string | null;
  deliveryStopId: string;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  orderId: string;
  orderName: string;
  paymentStatus: string | null;
  recipientName: string | null;
  sequence: number;
  shopifyOrderGid: string;
  status: string;
};

export type RoutePlanDetail = {
  routePlan: RoutePlanSummary;
  stops: RoutePlanDetailStop[];
};

export type RoutePlanService = {
  createRoutePlan(input: CreateRoutePlanInput): Promise<RoutePlanSummary>;
  getRoutePlanDetail(input: {
    routePlanId: string;
    shopDomain: string;
  }): Promise<RoutePlanDetail | null>;
  listRoutePlans(input: { shopDomain: string }): Promise<RoutePlanSummary[]>;
};
