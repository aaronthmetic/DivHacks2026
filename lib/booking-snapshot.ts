import { InputError } from "./auth-validation";
import type { Service, ServiceSnapshot } from "./exchange-schema";

/** Store the agreed listing details, never a live reference to its mutable fields. */
export function snapshotService(service: Service): ServiceSnapshot {
  return {
    title: service.title, description: service.description,
    pricingType: service.pricingType, creditRate: service.creditRate,
    genreId: service.genreId, deliveryMode: service.deliveryMode,
    ...(service.zipCode !== undefined ? { zipCode: service.zipCode } : {}),
    ...(service.countryCode !== undefined ? { countryCode: service.countryCode } : {}),
    ...(service.frequency !== undefined ? { frequency: { ...service.frequency } } : {}),
    images: [...(service.images ?? [])],
  };
}

export function validateScheduledAt(value?: Date) {
  if (value !== undefined && (!(value instanceof Date) || !Number.isFinite(value.getTime()))) {
    throw new InputError("Invalid scheduled date.");
  }
}
