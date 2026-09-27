import type { Service } from "./exchange-schema";

/** Raw owner-only form data; never inferred from formatted display labels. */
export type EditableListing = Pick<Service, "title" | "description" | "deliveryMode" | "creditRate" | "pricingType">
  & { id: string; genreId: string; zipCode: string; frequency: NonNullable<Service["frequency"]>;
    availability: NonNullable<Service["availability"]>; imageIds: string[] };

export function editableListing(service: Service): EditableListing {
  return {
    id: service._id.toHexString(), title: service.title, description: service.description,
    genreId: service.genreId?.toHexString() ?? "", deliveryMode: service.deliveryMode,
    zipCode: service.zipCode ?? "", creditRate: service.creditRate, pricingType: service.pricingType,
    frequency: service.frequency ?? { type: "single" }, availability: service.availability ?? [],
    imageIds: (service.images ?? []).map(id => id.toHexString()),
  };
}
