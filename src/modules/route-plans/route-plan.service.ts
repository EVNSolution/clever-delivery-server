import type {
  CreateRoutePlanInput,
  RoutePlanDetail,
  RoutePlanService,
  RoutePlanSummary
} from './route-plan.types.js';

export type RoutePlanRepository = {
  createRoutePlanDraft(input: {
    createdBy: string;
    depot: CreateRoutePlanInput['payload']['depot'];
    name: string;
    orders: CreateRoutePlanInput['payload']['orders'];
    planDate: string;
    routeScope?: CreateRoutePlanInput['payload']['routeScope'];
    shopDomain: string;
  }): Promise<RoutePlanSummary>;
  findRoutePlanDetail(input: {
    routePlanId: string;
    shopDomain: string;
  }): Promise<RoutePlanDetail | null>;
  listRoutePlans(input: { shopDomain: string }): Promise<RoutePlanSummary[]>;
};

export class RoutePlanAdminService implements RoutePlanService {
  constructor(private readonly repository: RoutePlanRepository) {}

  createRoutePlan(input: CreateRoutePlanInput): Promise<RoutePlanSummary> {
    return this.repository.createRoutePlanDraft({
      createdBy: input.createdBy,
      depot: input.payload.depot,
      name: input.payload.name,
      orders: input.payload.orders,
      planDate: input.payload.planDate,
      routeScope: input.payload.routeScope,
      shopDomain: input.shopDomain
    });
  }

  getRoutePlanDetail(input: {
    routePlanId: string;
    shopDomain: string;
  }): Promise<RoutePlanDetail | null> {
    return this.repository.findRoutePlanDetail(input);
  }

  listRoutePlans(input: { shopDomain: string }): Promise<RoutePlanSummary[]> {
    return this.repository.listRoutePlans(input);
  }
}
