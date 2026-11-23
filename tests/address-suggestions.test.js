import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAddressSuggestionDetails,
  getAddressSuggestionLabel,
  prioritizeStreetAddressFeatures
} from '../src/address-suggestions.js';

test('address labels lead with house number and street, followed by locality', () => {
  const feature = {
    properties: {
      housenumber: '15a',
      street: 'Ero Close',
      suburb: 'Igbo Efon',
      district: 'Lekki Phase 2',
      municipality: 'Eti-Osa',
      county: 'Eti-Osa',
      local_government_area: 'Eti-Osa',
      city: 'Lagos',
      country: 'Nigeria'
    }
  };

  assert.deepEqual(getAddressSuggestionDetails(feature), {
    primary: '15a Ero Close',
    secondary: 'Igbo Efon, Lekki Phase 2, Eti-Osa, Lagos, Nigeria'
  });
  assert.equal(getAddressSuggestionLabel(feature), '15a Ero Close, Igbo Efon, Lekki Phase 2, Eti-Osa, Lagos, Nigeria');
});

test('street-level address matches suppress broad area results and exact house numbers rank first', () => {
  const area = { properties: { name: 'Lekki Phase 2' } };
  const wrongHouse = { properties: { housenumber: '8', street: 'Ero Close' } };
  const exactHouse = { properties: { housenumber: '4A', street: 'Ero Close' } };

  assert.deepEqual(
    prioritizeStreetAddressFeatures([area, wrongHouse, exactHouse], '4a Ero Close'),
    [exactHouse, wrongHouse]
  );
  assert.deepEqual(prioritizeStreetAddressFeatures([area]), [area]);
});
