function uniqueText(parts) {
  return parts
    .filter(part => typeof part === 'string' || typeof part === 'number')
    .map(part => String(part).trim())
    .filter(Boolean)
    .filter((part, index, values) => values.indexOf(part) === index);
}

export function prioritizeStreetAddressFeatures(features, query = '', limit = 5) {
  if (!Array.isArray(features)) return [];
  const validFeatures = features.filter(feature =>
    feature && typeof feature.properties === 'object' && feature.properties !== null
  );
  const streetFeatures = validFeatures.filter(feature =>
    Boolean(feature.properties.street || feature.properties.housenumber)
    || String(feature.properties.osm_value || '').toLowerCase() === 'street'
  );
  let prioritized = streetFeatures.length > 0 ? streetFeatures : validFeatures;

  const houseNumber = String(query).trim().match(/^(\d+[a-z]?)(?=\s|$)/i)?.[1]?.toLowerCase();
  if (houseNumber && streetFeatures.length > 0) {
    prioritized = [...streetFeatures].sort((left, right) => {
      const leftMatches = String(left.properties.housenumber || '').toLowerCase() === houseNumber;
      const rightMatches = String(right.properties.housenumber || '').toLowerCase() === houseNumber;
      return Number(rightMatches) - Number(leftMatches);
    });
  }

  return prioritized.slice(0, Math.max(0, Math.floor(limit)));
}

export function getAddressSuggestionDetails(feature) {
  const properties = feature?.properties || {};
  const houseNumber = properties.housenumber ?? properties.house_number;
  const street = properties.street || properties.road;
  const streetAddress = uniqueText([houseNumber, street]).join(' ');
  const primary = uniqueText([streetAddress, street, properties.name])[0] || '';
  const secondary = uniqueText([
    properties.suburb,
    properties.neighbourhood,
    properties.locality,
    properties.city_district,
    properties.district,
    properties.local_government_area,
    properties.local_government,
    properties.lga,
    properties.municipality,
    properties.county,
    properties.city,
    properties.state_district,
    properties.state,
    properties.country,
    properties.postcode
  ]).filter(part => part !== primary);

  return { primary, secondary: secondary.join(', ') };
}

export function getAddressSuggestionLabel(feature) {
  const details = getAddressSuggestionDetails(feature);
  return [details.primary, details.secondary].filter(Boolean).join(', ');
}
