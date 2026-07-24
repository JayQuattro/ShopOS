import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type AssetSummary = Readonly<{
  id: string;
  customerId: string;
  displayName: string;
  category: string;
  manufacturer: string | null;
  model: string | null;
  modelYear: number | null;
  status: string;
  hasAutomotiveProfile: boolean;
  hasEquipmentProfile: boolean;
}>;

export type AssetDetail = AssetSummary &
  Readonly<{
    subtype: string | null;
    serialNumber: string | null;
    usageType: string | null;
    usageValueMilli: string | null;
    usageUnit: string | null;
    description: string | null;
    automotiveProfile: Readonly<{
      vin: string | null;
      licensePlate: string | null;
      trim: string | null;
      engine: string | null;
      drivetrain: string | null;
    }> | null;
    equipmentProfile: Readonly<{
      engineModel: string | null;
      fuelType: string | null;
      equipmentCategory: string | null;
    }> | null;
  }>;

export type CreateAssetInput = Readonly<{
  customerId: string;
  displayName: string;
  category: string;
  subtype?: string;
  manufacturer?: string;
  model?: string;
  modelYear?: number;
  serialNumber?: string;
  description?: string;
}>;

export type ListAssetsInput = Readonly<{
  customerId?: string;
  search?: string;
  includeInactive?: boolean;
}>;

export class AssetRepository {
  constructor(private readonly deps: Readonly<{ db: PrismaClient; context: TenantContext }>) {}

  async findById(id: string): Promise<AssetDetail | null> {
    assertTenantAccess(
      this.deps.context,
      { organizationId: this.deps.context.organizationId },
      "assets.read",
    );

    const asset = await this.deps.db.asset.findFirst({
      where: { id, organizationId: this.deps.context.organizationId },
      include: {
        automotiveProfile: {
          select: { vin: true, licensePlate: true, trim: true, engine: true, drivetrain: true },
        },
        equipmentProfile: {
          select: { engineModel: true, fuelType: true, equipmentCategory: true },
        },
      },
    });

    if (!asset) return null;

    return {
      id: asset.id,
      customerId: asset.customerId,
      displayName: asset.displayName,
      category: asset.category,
      subtype: asset.subtype,
      manufacturer: asset.manufacturer,
      model: asset.model,
      modelYear: asset.modelYear,
      serialNumber: asset.serialNumber,
      status: asset.status,
      usageType: asset.usageType,
      usageValueMilli: asset.usageValueMilli?.toString() ?? null,
      usageUnit: asset.usageUnit,
      description: asset.description,
      hasAutomotiveProfile: !!asset.automotiveProfile,
      hasEquipmentProfile: !!asset.equipmentProfile,
      automotiveProfile: asset.automotiveProfile
        ? {
            vin: asset.automotiveProfile.vin,
            licensePlate: asset.automotiveProfile.licensePlate,
            trim: asset.automotiveProfile.trim,
            engine: asset.automotiveProfile.engine,
            drivetrain: asset.automotiveProfile.drivetrain,
          }
        : null,
      equipmentProfile: asset.equipmentProfile
        ? {
            engineModel: asset.equipmentProfile.engineModel,
            fuelType: asset.equipmentProfile.fuelType,
            equipmentCategory: asset.equipmentProfile.equipmentCategory,
          }
        : null,
    };
  }

  async list(input: ListAssetsInput = {}): Promise<readonly AssetSummary[]> {
    assertTenantAccess(
      this.deps.context,
      { organizationId: this.deps.context.organizationId },
      "assets.read",
    );

    const assets = await this.deps.db.asset.findMany({
      where: {
        organizationId: this.deps.context.organizationId,
        ...(input.customerId ? { customerId: input.customerId } : {}),
        ...(input.includeInactive ? {} : { status: "ACTIVE" }),
        ...(input.search
          ? {
              OR: [
                { displayName: { contains: input.search, mode: "insensitive" as const } },
                { manufacturer: { contains: input.search, mode: "insensitive" as const } },
                { model: { contains: input.search, mode: "insensitive" as const } },
                { serialNumber: { contains: input.search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        customerId: true,
        displayName: true,
        category: true,
        manufacturer: true,
        model: true,
        modelYear: true,
        status: true,
      },
      orderBy: { displayName: "asc" },
    });

    return assets.map((a) => ({
      id: a.id,
      customerId: a.customerId,
      displayName: a.displayName,
      category: a.category,
      manufacturer: a.manufacturer,
      model: a.model,
      modelYear: a.modelYear,
      status: a.status,
      hasAutomotiveProfile: false,
      hasEquipmentProfile: false,
    }));
  }

  async create(input: CreateAssetInput): Promise<AssetSummary> {
    assertTenantAccess(
      this.deps.context,
      { organizationId: this.deps.context.organizationId },
      "assets.write",
    );

    // Verify the customer exists in the same org (cross-tenant prevention).
    const customer = await this.deps.db.customer.findFirst({
      where: { id: input.customerId, organizationId: this.deps.context.organizationId },
      select: { id: true },
    });
    if (!customer) {
      throw new Error("Referenced customer not found in the authorized organization.");
    }

    const asset = await this.deps.db.asset.create({
      data: {
        organizationId: this.deps.context.organizationId,
        customerId: input.customerId,
        displayName: input.displayName,
        category: input.category,
        ...(input.subtype ? { subtype: input.subtype } : {}),
        ...(input.manufacturer ? { manufacturer: input.manufacturer } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.modelYear ? { modelYear: input.modelYear } : {}),
        ...(input.serialNumber ? { serialNumber: input.serialNumber } : {}),
        ...(input.description ? { description: input.description } : {}),
      },
      select: {
        id: true,
        customerId: true,
        displayName: true,
        category: true,
        manufacturer: true,
        model: true,
        modelYear: true,
        status: true,
      },
    });

    return {
      id: asset.id,
      customerId: asset.customerId,
      displayName: asset.displayName,
      category: asset.category,
      manufacturer: asset.manufacturer,
      model: asset.model,
      modelYear: asset.modelYear,
      status: asset.status,
      hasAutomotiveProfile: false,
      hasEquipmentProfile: false,
    };
  }

  async setAutomotiveProfile(
    assetId: string,
    profile: Readonly<{
      vin?: string;
      licensePlate?: string;
      trim?: string;
      engine?: string;
      drivetrain?: string;
    }>,
  ): Promise<void> {
    assertTenantAccess(
      this.deps.context,
      { organizationId: this.deps.context.organizationId },
      "assets.write",
    );

    const asset = await this.deps.db.asset.findFirst({
      where: { id: assetId, organizationId: this.deps.context.organizationId },
      select: { id: true },
    });
    if (!asset) throw new Error("Asset not found in the authorized organization.");

    await this.deps.db.automotiveAssetProfile.upsert({
      where: { assetId: asset.id },
      create: {
        assetId: asset.id,
        ...(profile.vin ? { vin: profile.vin } : {}),
        ...(profile.licensePlate ? { licensePlate: profile.licensePlate } : {}),
        ...(profile.trim ? { trim: profile.trim } : {}),
        ...(profile.engine ? { engine: profile.engine } : {}),
        ...(profile.drivetrain ? { drivetrain: profile.drivetrain } : {}),
      },
      update: {
        ...(profile.vin !== undefined ? { vin: profile.vin } : {}),
        ...(profile.licensePlate !== undefined ? { licensePlate: profile.licensePlate } : {}),
        ...(profile.trim !== undefined ? { trim: profile.trim } : {}),
        ...(profile.engine !== undefined ? { engine: profile.engine } : {}),
        ...(profile.drivetrain !== undefined ? { drivetrain: profile.drivetrain } : {}),
      },
    });
  }

  async setEquipmentProfile(
    assetId: string,
    profile: Readonly<{
      engineModel?: string;
      fuelType?: string;
      equipmentCategory?: string;
    }>,
  ): Promise<void> {
    assertTenantAccess(
      this.deps.context,
      { organizationId: this.deps.context.organizationId },
      "assets.write",
    );

    const asset = await this.deps.db.asset.findFirst({
      where: { id: assetId, organizationId: this.deps.context.organizationId },
      select: { id: true },
    });
    if (!asset) throw new Error("Asset not found in the authorized organization.");

    await this.deps.db.equipmentAssetProfile.upsert({
      where: { assetId: asset.id },
      create: {
        assetId: asset.id,
        ...(profile.engineModel ? { engineModel: profile.engineModel } : {}),
        ...(profile.fuelType ? { fuelType: profile.fuelType } : {}),
        ...(profile.equipmentCategory ? { equipmentCategory: profile.equipmentCategory } : {}),
      },
      update: {
        ...(profile.engineModel !== undefined ? { engineModel: profile.engineModel } : {}),
        ...(profile.fuelType !== undefined ? { fuelType: profile.fuelType } : {}),
        ...(profile.equipmentCategory !== undefined
          ? { equipmentCategory: profile.equipmentCategory }
          : {}),
      },
    });
  }
}
