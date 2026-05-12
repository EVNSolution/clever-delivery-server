export type DriverRouteAccessLookupInput = {
  phoneE164: string;
  routeContext: string;
};

export type DriverRouteAccessCompanyGuidance = {
  companyDisplayName: string;
  deliveryDate: string;
  driverInstructions: string[];
  operatorSupportContact: string | null;
  pickupGuidance: string | null;
  routeName: string;
  shopDomain: string;
  timezone: string | null;
};

export type DriverRouteAccessLookupResult =
  | {
      driverContext: {
        driverId: string;
        shopDomain: string;
      };
      status: 'INVITED';
      routeAccess: {
        nextState: 'consent_required';
        routeContext: string;
        routePlanId: string;
      };
      companyGuidance: DriverRouteAccessCompanyGuidance;
    }
  | { status: 'BLOCKED' | 'DISABLED' | 'NOT_FOUND' };

export type DriverRouteAccessServiceContract = {
  lookupRouteAccess(input: DriverRouteAccessLookupInput): Promise<DriverRouteAccessLookupResult>;
};
