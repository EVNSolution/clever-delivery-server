import type {
  RoutePlanDetail,
  RoutePlanDetailStop,
  RoutePlanRouteGeometry,
  RoutePlanSummary
} from './route-plan.types.js';
import type { RouteGeometryProvider } from './route-plan.service.js';

const DEFAULT_OSRM_BASE_URL = 'https://router.project-osrm.org';

type FetchLike = (url: string, init: { method: 'GET' }) => Promise<Response>;

type OsrmRouteGeometryProviderOptions = {
  baseUrl?: string | undefined;
  fetch?: FetchLike | undefined;
};

export class OsrmRouteGeometryProvider implements RouteGeometryProvider {
  private readonly baseUrl: string;
  private readonly fetch: FetchLike;

  constructor(options: OsrmRouteGeometryProviderOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_OSRM_BASE_URL);
    this.fetch = options.fetch ?? fetch;
  }

  async buildRouteGeometry(input: RoutePlanDetail): Promise<RoutePlanRouteGeometry | null> {
    const coordinates = getRoutableCoordinates(input.routePlan, input.stops);
    if (coordinates.length < 2) {
      return null;
    }

    const response = await this.fetch(buildRouteUrl(this.baseUrl, coordinates), { method: 'GET' });
    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    return readOsrmRouteGeometry(payload);
  }
}

function getRoutableCoordinates(
  routePlan: RoutePlanSummary,
  stops: RoutePlanDetailStop[]
): Array<[number, number]> {
  return [
    toLngLat(routePlan.depot.latitude, routePlan.depot.longitude),
    ...[...stops]
      .sort((left, right) => left.sequence - right.sequence)
      .map((stop) => toLngLat(stop.coordinates.latitude, stop.coordinates.longitude))
  ].filter((coordinate): coordinate is [number, number] => coordinate !== null);
}

function toLngLat(latitude: number | null, longitude: number | null): [number, number] | null {
  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
    return null;
  }

  return [longitude, latitude];
}

function buildRouteUrl(baseUrl: string, coordinates: Array<[number, number]>): string {
  const coordinatePath = coordinates.map(([longitude, latitude]) => `${longitude},${latitude}`).join(';');
  return `${baseUrl}/route/v1/driving/${coordinatePath}?overview=full&geometries=geojson&steps=false`;
}

function readOsrmRouteGeometry(payload: unknown): RoutePlanRouteGeometry | null {
  const object = objectOrNull(payload);
  if (object?.code !== 'Ok' || !Array.isArray(object.routes)) {
    return null;
  }

  const geometry = objectOrNull(object.routes[0])?.geometry;
  const geometryObject = objectOrNull(geometry);
  if (geometryObject?.type !== 'LineString' || !Array.isArray(geometryObject.coordinates)) {
    return null;
  }

  const coordinates = geometryObject.coordinates.flatMap((coordinate) => {
    if (!Array.isArray(coordinate) || coordinate.length < 2) {
      return [];
    }

    const longitude = Number(coordinate[0]);
    const latitude = Number(coordinate[1]);
    return isValidLongitude(longitude) && isValidLatitude(latitude) ? [[longitude, latitude] as [number, number]] : [];
  });

  return coordinates.length >= 2 ? { type: 'LineString', coordinates } : null;
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  return (trimmed === '' ? DEFAULT_OSRM_BASE_URL : trimmed).replace(/\/+$/u, '');
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isValidLatitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;
}
