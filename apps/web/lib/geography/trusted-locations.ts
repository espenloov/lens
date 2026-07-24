import type { TimeSeriesRequest } from "../time-series/contracts";

export type TrustedLocation = {
  readonly key: string;
  readonly label: string;
  readonly longitude: number;
  readonly latitude: number;
};

const UK_TOWNS: Readonly<Record<string, Omit<TrustedLocation, "key">>> = {
  birmingham: {
    label: "Birmingham",
    longitude: -1.8904,
    latitude: 52.4862,
  },
  bristol: {
    label: "Bristol",
    longitude: -2.5879,
    latitude: 51.4545,
  },
  cambridge: {
    label: "Cambridge",
    longitude: 0.1218,
    latitude: 52.2053,
  },
  cardiff: {
    label: "Cardiff",
    longitude: -3.1791,
    latitude: 51.4816,
  },
  leeds: {
    label: "Leeds",
    longitude: -1.5491,
    latitude: 53.8008,
  },
  liverpool: {
    label: "Liverpool",
    longitude: -2.9916,
    latitude: 53.4084,
  },
  london: {
    label: "London",
    longitude: -0.1276,
    latitude: 51.5072,
  },
  manchester: {
    label: "Manchester",
    longitude: -2.2426,
    latitude: 53.4808,
  },
  "newcastle upon tyne": {
    label: "Newcastle upon Tyne",
    longitude: -1.6178,
    latitude: 54.9783,
  },
  nottingham: {
    label: "Nottingham",
    longitude: -1.1497,
    latitude: 52.9548,
  },
  oxford: {
    label: "Oxford",
    longitude: -1.2577,
    latitude: 51.752,
  },
  sheffield: {
    label: "Sheffield",
    longitude: -1.4701,
    latitude: 53.3811,
  },
  york: {
    label: "York",
    longitude: -1.0827,
    latitude: 53.9583,
  },
};
const RESOLVED_LOCATION_CACHE = new Map<
  string,
  readonly TrustedLocation[]
>();
const NO_LOCATIONS: readonly TrustedLocation[] = [];

function normalizeLocation(value: string): string {
  return value.trim().toLocaleLowerCase("en-GB").replace(/\s+/g, " ");
}

export function resolveTrustedLocations(
  request: TimeSeriesRequest,
): readonly TrustedLocation[] {
  const location = request.filters.location;

  if (
    request.dataset !== "uk_price_paid" ||
    location === null ||
    location.level !== "town"
  ) {
    return NO_LOCATIONS;
  }

  const cacheKey = location.values.map(normalizeLocation).join("\u001f");
  const cached = RESOLVED_LOCATION_CACHE.get(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  const resolved = location.values.flatMap((value) => {
    const key = normalizeLocation(value);
    const match = UK_TOWNS[key];

    return match === undefined ? [] : [{ key, ...match }];
  });

  const result =
    resolved.length === location.values.length ? resolved : NO_LOCATIONS;
  RESOLVED_LOCATION_CACHE.set(cacheKey, result);

  return result;
}

export function locationKey(value: string): string {
  return normalizeLocation(value);
}
