import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.VERCEL ||= '1';
const { default: app, signPricingQuote, verifyPricingQuote } = await import('../server.js');

describe('server route registration', () => {
  it('registers the super admin driver verification endpoint', () => {
    const routes = [];
    const stack = app.router?.stack || [];
    for (const layer of stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) {
          routes.push(`${method.toUpperCase()} ${layer.route.path}`);
        }
      }
    }

    assert.ok(routes.includes('POST /api/super-admin/drivers/:id/verification'));
  });

  it('accepts valid pricing quotes and rejects tampered ones', () => {
    const businessId = 'admin-123';
    const quote = signPricingQuote({
      businessId,
      pickup: { lat: 6.5, lng: 3.3 },
      destination: { lat: 6.7, lng: 3.5 },
      distanceKm: 12.4,
      durationMinutes: 24,
      price: 2450,
      currency: 'NGN',
      ruleVersion: 2,
      expiresAt: Date.now() + 60_000
    });

    const verified = verifyPricingQuote(quote, businessId);
    assert.ok(verified);
    assert.equal(verified.businessId, businessId);
    assert.equal(verified.currency, 'NGN');
    assert.equal(verified.ruleVersion, 2);
    assert.equal(verified.price, 2450);
    const [payload, signature] = quote.split('.');
    const tamperedSignature = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
    assert.equal(verifyPricingQuote(`${payload}.${tamperedSignature}`, businessId), null);
  });
});
