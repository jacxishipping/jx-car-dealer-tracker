// Integration tests — require a live PostgreSQL database.
//
// They run ONLY when DATABASE_URL (or POSTGRES_URL / POSTGRES_PRISMA_URL) is
// set. Without it the whole file is skipped with a clear console message and
// the suite still passes. The tests migrate the (idempotent) schema first,
// exercise the API end to end, then delete the test organization (cascade)
// and verify its rows are gone.
//
// NEVER point these at a production database: they create and then delete a
// test organization, but they do run the migration.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { config } from '../src/config';

const DATABASE_URL = config.databaseUrl;
const hasDb = Boolean(DATABASE_URL);

if (!hasDb) {
  console.log(
    '[integration] Skipping integration tests: no DATABASE_URL (or POSTGRES_URL / POSTGRES_PRISMA_URL) is set.',
  );
} else {
  // Test-only secret for the throwaway test organization.
  process.env.JWT_SECRET ??= 'integration-test-secret-do-not-use-in-production';
}

it('integration tests require DATABASE_URL (skipped when absent)', () => {
  expect(typeof hasDb).toBe('boolean');
});

describe.skipIf(!hasDb)('API integration', () => {
  let app: ReturnType<typeof import('../src/app')['createApp']>;
  let pool: import('pg').Pool;
  let token = '';
  let viewerToken = '';
  let orgId = '';
  let vehicleId = '';
  let dealId = '';
  let receivableId = '';
  let partId = '';
  let customerId = '';

  const email = `integration-${Date.now()}@example.com`;
  const vin = '1HGCM82633A004352';

  beforeAll(async () => {
    const { createApp } = await import('../src/app');
    const { Pool } = await import('pg');
    const { OFFERS_DDL } = await import('../src/lib/schema-extras');
    app = createApp();
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });

    // Idempotent migration (schema.sql + offers DDL), as migrate.ts does.
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const schemaPath = path.resolve(testDir, '..', '..', 'docs', 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schemaSql);
    await pool.query(OFFERS_DDL);
  });

  afterAll(async () => {
    if (pool && orgId) {
      // Ordered cleanup: part_allocation_slices blocks batch deletion via
      // RESTRICT, so remove slices + allocations before the org cascade.
      await pool.query(
        'DELETE FROM dealer.part_allocation_slices WHERE allocation_id IN (SELECT id FROM dealer.part_allocations WHERE organization_id = $1)',
        [orgId],
      );
      await pool.query('DELETE FROM dealer.part_allocations WHERE organization_id = $1', [orgId]);
      await pool.query('DELETE FROM dealer.organizations WHERE id = $1', [orgId]);
      // Users are global (memberships cascade with the org); remove the
      // throwaway test accounts so the DB is left exactly as found.
      await pool.query("DELETE FROM dealer.users WHERE email LIKE 'integration-%@example.com' OR email LIKE 'viewer-%@example.com'");
      const leftovers = await pool.query(
        'SELECT COUNT(*)::int AS n FROM dealer.vehicles WHERE organization_id = $1',
        [orgId],
      );
      expect(Number(leftovers.rows[0].n)).toBe(0);
    }
    if (pool) await pool.end();
  });

  it('registers an organization + Owner and logs in', async () => {
    const register = await request(app)
      .post('/api/auth/register')
      .send({ orgName: 'Integration Motors', name: 'Test Owner', email, password: 'TestPass123!' });
    expect(register.status).toBe(201);
    expect(register.body.token).toBeTruthy();
    expect(register.body.refreshToken).toBeTruthy();
    expect(register.body.user.role).toBe('Owner');
    orgId = register.body.organization.id;
    token = register.body.token;

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'TestPass123!' });
    expect(login.status).toBe(200);
    expect(login.body.memberships).toHaveLength(1);
    expect(login.body.organization.id).toBe(orgId);
    token = login.body.token;

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
  });

  it('rejects a duplicate registration email with 409', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ orgName: 'Other', name: 'Dup', email, password: 'TestPass123!' });
    expect(res.status).toBe(409);
  });

  it('returns 401 without a token and 200 for /health', async () => {
    const unauth = await request(app).get('/api/vehicles');
    expect(unauth.status).toBe(401);
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body.db).toBe('up');
  });

  it('records a purchase (vehicle + purchase + journal) and rejects a duplicate VIN', async () => {
    const purchase = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${token}`)
      .send({
        seller: 'Copart',
        auction: 'Copart',
        purchaseDate: '2026-11-01',
        vehiclePrice: 11200,
        buyerFees: 0,
        auctionFees: 380,
        taxes: 0,
        transportEstimate: 550,
        paymentMethod: 'Bank transfer',
        paymentStatus: 'Paid',
        vehicle: {
          vin,
          year: 2019,
          make: 'Toyota',
          model: 'Camry',
          purchaseDate: '2026-11-01',
          purchaseSource: 'Auction',
          purchasePrice: 11200,
          auctionFees: 380,
          askingPrice: 15900,
          minPrice: 14500,
        },
      });
    expect(purchase.status).toBe(201);
    expect(purchase.body.purchase.ref).toMatch(/^ACQ-\d{4}$/);
    vehicleId = purchase.body.vehicle.id;
    expect(purchase.body.vehicle.stockNumber).toMatch(/^CDT-/);

    const dup = await request(app)
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${token}`)
      .send({
        vin, year: 2020, make: 'Honda', model: 'Civic', purchaseDate: '2026-11-02',
      });
    expect(dup.status).toBe(409);

    // The Paid purchase posted a balanced journal entry.
    const journal = await request(app)
      .get('/api/journal?limit=5')
      .set('Authorization', `Bearer ${token}`);
    expect(journal.status).toBe(200);
    const entry = journal.body.data[0];
    const debit = entry.lines.reduce((s: number, l: { debit: number }) => s + l.debit, 0);
    const credit = entry.lines.reduce((s: number, l: { credit: number }) => s + l.credit, 0);
    expect(debit).toBeCloseTo(credit, 2);
    expect(debit).toBeCloseTo(11580, 2);
  });

  it('allocates parts at FIFO cost: 10@$50 + 10@$60, consume 12 = $620', async () => {
    const part = await request(app)
      .post('/api/parts')
      .set('Authorization', `Bearer ${token}`)
      .send({ sku: 'TEST-BP', name: 'Brake pads (test)', manufacturer: 'Test', supplier: 'Test', minStock: 2 });
    expect(part.status).toBe(201);
    partId = part.body.id;

    for (const [qty, unitPrice, invoice] of [
      [10, 50, 'INV-1'],
      [10, 60, 'INV-2'],
    ] as const) {
      const batch = await request(app)
        .post(`/api/parts/${partId}/batches`)
        .set('Authorization', `Bearer ${token}`)
        .send({ qty, unitPrice, invoice });
      expect(batch.status).toBe(201);
    }

    const alloc = await request(app)
      .post(`/api/parts/${partId}/allocate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicleId, qty: 12 });
    expect(alloc.status).toBe(201);
    expect(alloc.body.fifoCost).toBe(620);
    expect(alloc.body.slices).toEqual([
      expect.objectContaining({ qty: 10, unitPrice: 50 }),
      expect.objectContaining({ qty: 2, unitPrice: 60 }),
    ]);

    const tooMuch = await request(app)
      .post(`/api/parts/${partId}/allocate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicleId, qty: 99 });
    expect(tooMuch.status).toBe(400);
  });

  it('finalises a sale atomically (vehicle Sold + sale + balanced journal + receivable)', async () => {
    // Vehicle must be Available or Reserved to sell.
    const status = await request(app)
      .patch(`/api/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'Available' });
    expect(status.status).toBe(200);

    const customer = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Buyer', phone: '+1 555 0100', email: 'buyer@example.com' });
    expect(customer.status).toBe(201);
    customerId = customer.body.id;

    const deal = await request(app)
      .post('/api/deals')
      .set('Authorization', `Bearer ${token}`)
      .send({
        vehicleId, customerId,
        sellingPrice: 15900, discount: 0, taxes: 200, fees: 100,
        deposit: 1000, paymentMethod: 'Bank transfer',
      });
    expect(deal.status).toBe(201);
    expect(deal.body.ref).toMatch(/^DEAL-\d{4}$/);
    dealId = deal.body.id;

    const finalized = await request(app)
      .post(`/api/deals/${dealId}/finalize`)
      .set('Authorization', `Bearer ${token}`);
    expect(finalized.status).toBe(200);
    const sale = finalized.body.sale;
    expect(sale.ref).toMatch(/^SALE-\d{4}$/);
    // All-in: 11200 + 380 + 0 transport + 0 direct + 620 parts + 150 overhead = 12350
    expect(sale.totalCost).toBe(12350);
    expect(sale.grossProfit).toBe(15900 - 12350);
    expect(sale.netProfit).toBe(15900 - 12350 - 300);

    const vehicle = await request(app)
      .get(`/api/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(vehicle.body.status).toBe('Sold');

    const receivables = await request(app)
      .get('/api/receivables')
      .set('Authorization', `Bearer ${token}`);
    const receivable = receivables.body.data.find(
      (r: { reference: string }) => r.reference === sale.ref,
    );
    expect(receivable).toBeTruthy();
    expect(receivable.total).toBe(15900);
    expect(receivable.paid).toBe(1000);
    receivableId = receivable.id;

    // Sale journal entry is balanced: Bank 15900 / Revenue 15900, COGS 12350 / Inventory 12350.
    const journal = await request(app)
      .get('/api/journal?limit=5')
      .set('Authorization', `Bearer ${token}`);
    const saleEntry = journal.body.data.find(
      (j: { memo: string }) => j.memo.includes(sale.ref),
    );
    expect(saleEntry).toBeTruthy();
    const debit = saleEntry.lines.reduce((s: number, l: { debit: number }) => s + l.debit, 0);
    const credit = saleEntry.lines.reduce((s: number, l: { credit: number }) => s + l.credit, 0);
    expect(debit).toBeCloseTo(credit, 2);
    expect(debit).toBeCloseTo(15900 + 12350, 2);
  });

  it('rejects an overpayment on the receivable (400)', async () => {
    const res = await request(app)
      .post(`/api/receivables/${receivableId}/payments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 999999, accountId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(400);
  });

  it('denies a Viewer finalising a sale (403)', async () => {
    // Create a Viewer member directly (no invite endpoint exists yet).
    const viewerEmail = `viewer-${Date.now()}@example.com`;
    const hash = await bcrypt.hash('ViewerPass123!', 10);
    const userRes = await pool.query(
      `INSERT INTO dealer.users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      [viewerEmail, 'Test Viewer', hash],
    );
    const viewerId = userRes.rows[0].id as string;
    let roleRes = await pool.query(
      `SELECT id FROM dealer.roles WHERE organization_id = $1 AND name = 'Viewer'`,
      [orgId],
    );
    if (roleRes.rows.length === 0) {
      roleRes = await pool.query(
        `INSERT INTO dealer.roles (organization_id, name) VALUES ($1, 'Viewer') RETURNING id`,
        [orgId],
      );
    }
    await pool.query(
      `INSERT INTO dealer.organization_members (organization_id, user_id, role_id, active)
       VALUES ($1, $2, $3, TRUE)`,
      [orgId, viewerId, roleRes.rows[0].id],
    );
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: viewerEmail, password: 'ViewerPass123!' });
    expect(login.status).toBe(200);
    viewerToken = login.body.token;

    // Viewer can read…
    const read = await request(app)
      .get('/api/vehicles')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(read.status).toBe(200);

    // …but cannot finalise a sale (or create a vehicle).
    const denied = await request(app)
      .post(`/api/deals/${dealId}/finalize`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(denied.status).toBe(403);
    const deniedCreate = await request(app)
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ vin: '1HGCM82633A004353', year: 2020, make: 'Honda', model: 'Civic', purchaseDate: '2026-11-02' });
    expect(deniedCreate.status).toBe(403);
  });

  it('serves the full state snapshot and the dashboard', async () => {
    const state = await request(app)
      .get('/api/state')
      .set('Authorization', `Bearer ${token}`);
    expect(state.status).toBe(200);
    expect(state.body.vehicles).toHaveLength(1);
    expect(state.body.sales).toHaveLength(1);
    expect(state.body.organization.id).toBe(orgId);
    expect(state.body.currentRole).toBe('Owner');

    const dashboard = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${token}`);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.kpis.sold).toBe(1);
    expect(dashboard.body.kpis.salesRevenue).toBe(15900);
    expect(dashboard.body.monthlySeries).toHaveLength(6);
    expect(dashboard.body.forecast.label).toBe('FORECAST');
  });

  it('requires confirmation for a sensitive MCP write', async () => {
    const tools = await request(app)
      .get('/api/mcp/tools')
      .set('Authorization', `Bearer ${token}`);
    expect(tools.status).toBe(200);
    expect(tools.body.tools).toHaveLength(19);

    const noConfirm = await request(app)
      .post('/api/mcp/tools/record_payment')
      .set('Authorization', `Bearer ${token}`)
      .send({ arguments: { receivableId, amount: 500, accountId: '00000000-0000-0000-0000-000000000000' } });
    // The account id is validated only on execution; the preview comes first.
    expect(noConfirm.status).toBe(200);
    expect(noConfirm.body.result.requiresConfirmation).toBe(true);
  });
});
