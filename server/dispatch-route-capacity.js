function packageSizeRank(size) {
  return ({
    SMALL: 1,
    MEDIUM: 2,
    LARGE: 3
  }[String(size || '').toUpperCase()] || 0);
}

export function riderCanCarryDeliveryRoute(rider, stops) {
  const totalPackages = stops.reduce((total, stop) =>
    total + Number(stop.packages ?? stop.package_count ?? 0), 0);
  const totalWeightKg = stops.reduce((total, stop) =>
    total + Number(stop.packageWeightKg ?? stop.package_weight_kg ?? 0), 0);
  const rawMaxPackageCount = rider.maxPackageCount ?? rider.max_package_count;
  const rawMaxPackageWeightKg = rider.maxPackageWeightKg ?? rider.max_package_weight_kg;
  const maxPackageCount = rawMaxPackageCount == null ? null : Number(rawMaxPackageCount);
  const maxPackageWeightKg = rawMaxPackageWeightKg == null ? null : Number(rawMaxPackageWeightKg);
  const maxPackageSize = rider.maxPackageSize ?? rider.max_package_size;
  const requestedSize = Math.max(...stops.map(stop =>
    packageSizeRank(stop.packageSize ?? stop.package_size)));

  return (!Number.isInteger(maxPackageCount) || totalPackages <= maxPackageCount)
    && (maxPackageWeightKg === null || !Number.isFinite(maxPackageWeightKg)
      || totalWeightKg <= maxPackageWeightKg)
    && (!requestedSize || !packageSizeRank(maxPackageSize)
      || requestedSize <= packageSizeRank(maxPackageSize));
}
