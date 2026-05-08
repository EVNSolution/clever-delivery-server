import type { DeliveryServiceType, DeliveryWeekday, ShopifyOrderLineItem } from './order-sync.mapper.js';

export type DeliverySession = 'DAY' | 'EVENING' | 'PICKUP';
export type DeliveryDateSource = 'LINE_ITEM_DATE_RANGE' | 'ORDER_DATE_CYCLE_RULE' | 'MISSING';

export type DeliveryScopeInput = {
  createdAt: string | null;
  deliveryArea?: string | null;
  deliveryDayRaw: string | null;
  lineItems: ShopifyOrderLineItem[];
  pickupDayRaw: string | null;
  processedAt: string | null;
  shopTimezone?: string;
};

export type DeliveryScope = {
  deliveryBatchEndDate: string | null;
  deliveryBatchStartDate: string | null;
  deliveryDate: string | null;
  deliveryDateSource: DeliveryDateSource;
  deliverySession: DeliverySession | null;
  deliveryWeekday: DeliveryWeekday | null;
  orderCreatedAt: string | null;
  orderDateLocal: string | null;
  planningGroupKey: string | null;
  routeScopeKey: string | null;
  serviceType: DeliveryServiceType | null;
  timeWindowEnd: string | null;
  timeWindowStart: string | null;
};

type ParsedService = {
  deliverySession: DeliverySession | null;
  deliveryWeekday: DeliveryWeekday | null;
  serviceType: DeliveryServiceType | null;
  timeWindowEnd: string | null;
  timeWindowStart: string | null;
};

type DateRange = {
  endDate: string;
  startDate: string;
};

const DEFAULT_TIMEZONE = 'America/Toronto';

export function calculateDeliveryScope(input: DeliveryScopeInput): DeliveryScope {
  const service = parseService(input.pickupDayRaw ?? input.deliveryDayRaw, input.pickupDayRaw !== null);
  const orderCreatedAt = input.createdAt ?? input.processedAt;
  const timezone = input.shopTimezone ?? DEFAULT_TIMEZONE;
  const orderDateLocal = orderCreatedAt === null ? null : toLocalDate(orderCreatedAt, timezone);
  const lineItemRange = findLineItemDateRange(input.lineItems, orderDateLocal);
  const fallbackRange = lineItemRange ?? (orderDateLocal === null ? null : calculateCycleRange(orderDateLocal));
  const deliveryDate =
    fallbackRange === null || service.deliveryWeekday === null
      ? null
      : findDateForWeekday(fallbackRange, service.deliveryWeekday);
  const deliveryDateSource: DeliveryDateSource =
    deliveryDate === null ? 'MISSING' : lineItemRange === null ? 'ORDER_DATE_CYCLE_RULE' : 'LINE_ITEM_DATE_RANGE';
  const routeScopeKey =
    deliveryDate === null || service.serviceType === null
      ? null
      : [deliveryDate, service.serviceType, service.timeWindowStart ?? '', service.timeWindowEnd ?? ''].join('|');
  const deliveryArea = normalizeOptional(input.deliveryArea);

  return {
    deliveryBatchEndDate: fallbackRange?.endDate ?? null,
    deliveryBatchStartDate: fallbackRange?.startDate ?? null,
    deliveryDate,
    deliveryDateSource,
    deliverySession: service.deliverySession,
    deliveryWeekday: service.deliveryWeekday,
    orderCreatedAt,
    orderDateLocal,
    planningGroupKey: routeScopeKey === null ? null : deliveryArea === null ? routeScopeKey : `${routeScopeKey}|${deliveryArea}`,
    routeScopeKey,
    serviceType: service.serviceType,
    timeWindowEnd: service.timeWindowEnd,
    timeWindowStart: service.timeWindowStart
  };
}

function parseService(value: string | null, pickup: boolean): ParsedService {
  const normalized = normalizeDeliveryDayText(value);
  const weekday = parseWeekday(normalized);
  if (pickup) {
    return {
      deliverySession: weekday === null ? null : 'PICKUP',
      deliveryWeekday: weekday,
      serviceType: weekday === null ? null : 'PICKUP',
      timeWindowEnd: null,
      timeWindowStart: null
    };
  }
  if (/^friday\s+5\s*pm\s+to\s+9\s*pm/iu.test(value ?? '')) {
    return {
      deliverySession: 'EVENING',
      deliveryWeekday: 'FRIDAY',
      serviceType: 'EVENING_DELIVERY',
      timeWindowEnd: '21:00',
      timeWindowStart: '17:00'
    };
  }
  return {
    deliverySession: weekday === null ? null : 'DAY',
    deliveryWeekday: weekday,
    serviceType: weekday === null ? null : 'DELIVERY',
    timeWindowEnd: null,
    timeWindowStart: null
  };
}

function parseWeekday(value: string | null): DeliveryWeekday | null {
  if (value === 'thursday') return 'THURSDAY';
  if (value === 'friday') return 'FRIDAY';
  if (value === 'saturday') return 'SATURDAY';
  return null;
}

function normalizeDeliveryDayText(value: string | null): string | null {
  if (value === null) return null;
  return value
    .trim()
    .toLowerCase()
    .replace(/\s*-\s*pickup$/iu, '')
    .replace(/\s+pickup$/iu, '');
}

function findLineItemDateRange(items: ShopifyOrderLineItem[], orderDateLocal: string | null): DateRange | null {
  for (const item of items) {
    const candidates = [item.title, item.name, item.variantTitle].flatMap((value) =>
      value === null || value === undefined ? [] : [value]
    );
    for (const candidate of candidates) {
      const range = parseDateRange(candidate, orderDateLocal);
      if (range !== null) return range;
    }
  }
  return null;
}

function parseDateRange(value: string, orderDateLocal: string | null): DateRange | null {
  const dotted = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})\s*-\s*(?:(20\d{2})[.\-/])?(\d{1,2})[.\-/](\d{1,2})/u.exec(value);
  if (dotted !== null) {
    const [, startYear, startMonth, startDay, endYear, endMonth, endDay] = dotted;
    if (startYear && startMonth && startDay && endMonth && endDay) {
      return {
        endDate: formatYmd(Number(endYear ?? startYear), Number(endMonth), Number(endDay)),
        startDate: formatYmd(Number(startYear), Number(startMonth), Number(startDay))
      };
    }
  }

  const short = /(?<!\d)(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})(?!\d)/u.exec(value);
  if (short !== null) {
    const [, startMonth, startDay, endMonth, endDay] = short;
    if (startMonth && startDay && endMonth && endDay) {
      const year = orderDateLocal === null ? new Date().getUTCFullYear() : Number(orderDateLocal.slice(0, 4));
      return {
        endDate: formatYmd(year, Number(endMonth), Number(endDay)),
        startDate: formatYmd(year, Number(startMonth), Number(startDay))
      };
    }
  }

  return null;
}

function calculateCycleRange(orderDateLocal: string): DateRange {
  const orderDate = parseYmd(orderDateLocal);
  const day = orderDate.getUTCDay();
  const daysSinceTuesday = (day - 2 + 7) % 7;
  const openTuesday = addDays(orderDate, -daysSinceTuesday);
  const cutoffMonday = addDays(openTuesday, 6);
  return {
    endDate: formatDate(addDays(cutoffMonday, 5)),
    startDate: formatDate(addDays(cutoffMonday, 3))
  };
}

function findDateForWeekday(range: DateRange, weekday: DeliveryWeekday): string | null {
  const target = weekday === 'THURSDAY' ? 4 : weekday === 'FRIDAY' ? 5 : 6;
  let cursor = parseYmd(range.startDate);
  const end = parseYmd(range.endDate);
  while (cursor.getTime() <= end.getTime()) {
    if (cursor.getUTCDay() === target) return formatDate(cursor);
    cursor = addDays(cursor, 1);
  }
  return null;
}

function toLocalDate(value: string, timezone: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: timezone,
    year: 'numeric'
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year === undefined || month === undefined || day === undefined ? null : `${year}-${month}-${day}`;
}

function normalizeOptional(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function parseYmd(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatYmd(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}
