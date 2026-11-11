// Transactional service functions — the single implementation of every
// money-moving write, shared by the REST routes, the AI assistant confirm
// step and the MCP write tools. Each runs inside the caller's transaction;
// any failure rolls the whole operation back.
import type { PoolClient } from 'pg';
import { ApiError, badRequest, conflict, notFound } from './errors';
import { insertAudit } from './audit';
import { fifoConsume, dealProfit } from './fifo';
import { money, num } from './money';
import { nextRef } from './refs';
import { createJournalEntry, getDefaultAccount, postTransaction } from './journal';
import { getOrgSettings, vehicleAllInCostDb } from './costing';
import { insertVehicleTx, type VehicleInput } from './vehicles';
import type { AuthedUser } from '../middleware/auth';

export const today = (): string => new Date().toISOString().slice(0, 10);

export interface Actor {
  id: string;
  displayName: string;
}

// --- Expenses ---------------------------------------------------------------
export interface ExpenseInput {
  description: string;
  amount: number;
  category: string;
  date: string;
  vendor?: string;
  vehicleId?: string | null;
  kind: 'Direct' | 'Overhead';
  paymentMethod?: string;
  status: 'Paid' | 'Pending';
  invoiceRef?: string;
  notes?: string;
}

/** Look up an expense category id by name (org-specific, else built-in). */
export async function expenseCategoryId(
  client: PoolClient,
  orgId: string,
  categoryName: string,
): Promise<string | null> {
  const res = await client.query(
    `SELECT id FROM dealer.expense_categories
      WHERE name = $1 AND (organization_id = $2 OR organization_id IS NULL)
      ORDER BY organization_id NULLS LAST LIMIT 1`,
    [categoryName, orgId],
  );
  return (res.rows[0]?.id as string) ?? null;
}

/** Look up (or create) a vendor by name. */
export async function vendorIdForName(
  client: PoolClient,
  orgId: string,
  vendorName: string,
): Promise<string | null> {
  const name = vendorName.trim();
  if (!name) return null;
  const found = await client.query(
    `SELECT id FROM dealer.vendors WHERE organization_id = $1 AND name = $2 AND deleted_at IS NULL`,
    [orgId, name],
  );
  if (found.rows.length > 0) return found.rows[0].id as string;
  const created = await client.query(
    `INSERT INTO dealer.vendors (organization_id, name, kind) VALUES ($1, $2, 'Other') RETURNING id`,
    [orgId, name],
  );
  return created.rows[0].id as string;
}

/**
 * Record an expense. A Paid expense also posts a transaction + journal
 * entry (money out of the default bank account), mirroring the frontend.
 */
export async function recordExpenseTx(
  client: PoolClient,
  orgId: string,
  input: ExpenseInput,
  user: AuthedUser,
): Promise<Record<string, unknown>> {
  const categoryId = await expenseCategoryId(client, orgId, input.category);
  const vendorId = input.vendor ? await vendorIdForName(client, orgId, input.vendor) : null;
  const res = await client.query(
    `INSERT INTO dealer.expenses
       (organization_id, description, amount, category_id, category_name, date,
        vendor_id, vendor_name, vehicle_id, kind, payment_method, status,
        invoice_ref, created_by, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [
      orgId,
      input.description,
      money(input.amount),
      categoryId,
      input.category,
      input.date,
      vendorId,
      input.vendor ?? '',
      input.vehicleId ?? null,
      input.kind,
      input.paymentMethod ?? '',
      input.status,
      input.invoiceRef ?? '',
      user.id,
      input.notes ?? '',
    ],
  );
  const row = res.rows[0] as Record<string, unknown>;
  if (input.status === 'Paid') {
    const account = await getDefaultAccount(client, orgId);
    await postTransaction(client, orgId, {
      accountId: account.id,
      type: 'Expense payment',
      amount: -money(input.amount),
      category: input.category,
      reference: (input.invoiceRef ?? '').trim() || (row.id as string),
      date: input.date,
      note: input.description,
    });
    await createJournalEntry(client, orgId, {
      memo: input.description,
      date: input.date,
      lines: [
        { account: input.category, debit: money(input.amount), credit: 0 },
        { account: account.name, debit: 0, credit: money(input.amount) },
      ],
    });
  }
  await insertAudit(client, {
    orgId,
    actorId: user.id,
    actorName: user.displayName,
    action: 'EXPENSE_RECORDED',
    entityType: 'Expense',
    entityId: row.id as string,
    summary: `Expense ${input.description} — $${money(input.amount)} (${input.category}).`,
  });
  return row;
}

// --- Purchases --------------------------------------------------------------
export interface PurchaseInput {
  seller: string;
  auction?: string;
  purchaseDate: string;
  vehiclePrice: number;
  buyerFees?: number;
  auctionFees?: number;
  taxes?: number;
  transportEstimate?: number;
  paymentMethod?: string;
  paymentStatus: 'Paid' | 'Partial' | 'Unpaid';
  documents?: string;
  vehicle: VehicleInput;
}

/**
 * Record a purchase in ONE transaction: vehicle + purchase + (when Paid or
 * Partial) financial transaction + balanced journal entry + vendor payable
 * receivable when Partial. Mirrors frontend recordPurchase().
 */
export async function recordPurchaseTx(
  client: PoolClient,
  orgId: string,
  input: PurchaseInput,
  user: AuthedUser,
): Promise<{ purchase: Record<string, unknown>; vehicle: Record<string, unknown> }> {
  const vehiclePrice = money(input.vehiclePrice);
  const buyerFees = money(input.buyerFees ?? 0);
  const auctionFees = money(input.auctionFees ?? 0);
  const taxes = money(input.taxes ?? 0);
  const total = money(vehiclePrice + buyerFees + auctionFees + taxes);

  const vehicle = await insertVehicleTx(client, orgId, {
    ...input.vehicle,
    purchaseDate: input.purchaseDate,
    purchasePrice: vehiclePrice,
    auctionFees,
    status: input.vehicle.status ?? 'Purchased',
  });
  const vehicleId = vehicle.id as string;
  const ref = await nextRef(client, orgId, 'ACQ');
  const purchaseRes = await client.query(
    `INSERT INTO dealer.vehicle_purchases
       (organization_id, ref, vehicle_id, seller, auction, purchase_date, vehicle_price,
        buyer_fees, auction_fees, taxes, transport_estimate, payment_method,
        payment_status, documents)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [
      orgId,
      ref,
      vehicleId,
      input.seller,
      input.auction ?? '',
      input.purchaseDate,
      vehiclePrice,
      buyerFees,
      auctionFees,
      taxes,
      money(input.transportEstimate ?? 0),
      input.paymentMethod ?? '',
      input.paymentStatus,
      input.documents ?? '',
    ],
  );
  const purchase = purchaseRes.rows[0] as Record<string, unknown>;

  if (input.paymentStatus !== 'Unpaid') {
    const paid = input.paymentStatus === 'Paid' ? total : money(total / 2);
    const account = await getDefaultAccount(client, orgId);
    const stockNumber = vehicle.stock_number as string;
    await postTransaction(client, orgId, {
      accountId: account.id,
      type: 'Vehicle purchase',
      amount: -paid,
      category: 'Purchases',
      reference: ref,
      date: today(),
      note: `Purchase ${stockNumber}`,
    });
    await createJournalEntry(client, orgId, {
      memo: `Purchase ${stockNumber} (${ref})`,
      date: today(),
      lines: [
        { account: 'Vehicle Inventory', debit: total, credit: 0 },
        { account: account.name, debit: 0, credit: paid },
        { account: 'Accounts Payable', debit: 0, credit: money(total - paid) },
      ],
    });
    if (input.paymentStatus === 'Partial') {
      await client.query(
        `INSERT INTO dealer.receivables
           (organization_id, kind, entity_name, reference, total, paid, due_date, status)
         VALUES ($1, 'Vendor', $2, $3, $4, $5, $6, 'Partial')`,
        [orgId, input.seller, ref, total, paid, input.purchaseDate],
      );
    }
  }

  await insertAudit(client, {
    orgId,
    actorId: user.id,
    actorName: user.displayName,
    action: 'PURCHASE_RECORDED',
    entityType: 'Purchase',
    entityId: purchase.id as string,
    summary: `Purchase ${ref} recorded: ${vehicle.year as number} ${vehicle.make as string} ${vehicle.model as string} for $${total}. Vehicle ${vehicle.stock_number as string} created.`,
  });
  return { purchase, vehicle };
}

// --- Transport --------------------------------------------------------------
export interface TransportInput {
  vehicleId: string;
  carrier: string;
  driver?: string;
  pickupLocation?: string;
  deliveryLocation?: string;
  pickupDate?: string | null;
  expectedDelivery?: string | null;
  actualDelivery?: string | null;
  price?: number;
  status?: string;
  gatePass?: string;
  billOfLading?: string;
  damageNotes?: string;
  invoiceRef?: string;
  paymentStatus?: 'Paid' | 'Partial' | 'Unpaid';
}

export async function createTransportTx(
  client: PoolClient,
  orgId: string,
  input: TransportInput,
  user: AuthedUser,
): Promise<Record<string, unknown>> {
  const res = await client.query(
    `INSERT INTO dealer.transportation_orders
       (organization_id, vehicle_id, carrier, driver, pickup_location, delivery_location,
        pickup_date, expected_delivery, actual_delivery, price, status, gate_pass,
        bill_of_lading, damage_notes, invoice_ref, payment_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [
      orgId,
      input.vehicleId,
      input.carrier,
      input.driver ?? '',
      input.pickupLocation ?? '',
      input.deliveryLocation ?? '',
      input.pickupDate ?? null,
      input.expectedDelivery ?? null,
      input.actualDelivery ?? null,
      money(input.price ?? 0),
      input.status ?? 'Awaiting pickup',
      input.gatePass ?? '',
      input.billOfLading ?? '',
      input.damageNotes ?? '',
      input.invoiceRef ?? '',
      input.paymentStatus ?? 'Unpaid',
    ],
  );
  const row = res.rows[0] as Record<string, unknown>;
  await insertAudit(client, {
    orgId,
    actorId: user.id,
    actorName: user.displayName,
    action: 'TRANSPORT_CREATED',
    entityType: 'TransportOrder',
    entityId: row.id as string,
    summary: `Transport order for ${input.vehicleId} created (${input.carrier}, $${money(input.price ?? 0)}).`,
  });
  return row;
}

/**
 * Update a transport order. A transition TO 'Delivered' (from any other
 * status) adds the order price to the vehicle's transport_cost and flips an
 * In-transit vehicle to Received — mirroring frontend updateTransport().
 */
export async function updateTransportTx(
  client: PoolClient,
  orgId: string,
  orderId: string,
  patch: Partial<TransportInput> & { status?: string },
  user: AuthedUser,
): Promise<Record<string, unknown>> {
  const current = await client.query(
    `SELECT * FROM dealer.transportation_orders
      WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [orderId, orgId],
  );
  if (current.rows.length === 0) throw notFound('Transport order not found');
  const order = current.rows[0] as Record<string, unknown>;

  const columnMap: Record<string, string> = {
    vehicleId: 'vehicle_id',
    carrier: 'carrier',
    driver: 'driver',
    pickupLocation: 'pickup_location',
    deliveryLocation: 'delivery_location',
    pickupDate: 'pickup_date',
    expectedDelivery: 'expected_delivery',
    actualDelivery: 'actual_delivery',
    price: 'price',
    status: 'status',
    gatePass: 'gate_pass',
    billOfLading: 'bill_of_lading',
    damageNotes: 'damage_notes',
    invoiceRef: 'invoice_ref',
    paymentStatus: 'payment_status',
  };
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(columnMap)) {
    const v = (patch as Record<string, unknown>)[key];
    if (v !== undefined) {
      values.push(key === 'price' ? money(num(v)) : v);
      sets.push(`${column} = $${values.length}`);
    }
  }
  let updated = order;
  if (sets.length > 0) {
    const res = await client.query(
      `UPDATE dealer.transportation_orders SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $${values.length + 1} AND organization_id = $${values.length + 2}
        RETURNING *`,
      [...values, orderId, orgId],
    );
    updated = res.rows[0] as Record<string, unknown>;
  }
  const newStatus = (patch.status ?? order.status) as string;
  if (newStatus === 'Delivered' && order.status !== 'Delivered') {
    await client.query(
      `UPDATE dealer.vehicles
          SET transport_cost = transport_cost + $1,
              status = CASE WHEN status = 'In transit' THEN 'Received' ELSE status END
        WHERE id = $2 AND organization_id = $3`,
      [num(order.price), order.vehicle_id, orgId],
    );
    await client.query(
      `INSERT INTO dealer.transportation_events (organization_id, order_id, status, note)
       VALUES ($1, $2, 'Delivered', 'Delivered; price added to vehicle cost basis.')`,
      [orgId, orderId],
    );
    await insertAudit(client, {
      orgId,
      actorId: user.id,
      actorName: user.displayName,
      action: 'TRANSPORT_DELIVERED',
      entityType: 'TransportOrder',
      entityId: orderId,
      summary: `Transport ${orderId} delivered; $${money(num(order.price))} added to vehicle cost basis.`,
    });
  } else if (patch.status && patch.status !== order.status) {
    await client.query(
      `INSERT INTO dealer.transportation_events (organization_id, order_id, status, note)
       VALUES ($1, $2, $3, '')`,
      [orgId, orderId, patch.status],
    );
  }
  return updated;
}

// --- Parts (FIFO) -----------------------------------------------------------
export interface BatchInput {
  qty: number;
  unitPrice: number;
  invoice?: string;
  purchaseDate?: string;
}

export async function receiveBatchTx(
  client: PoolClient,
  orgId: string,
  partId: string,
  input: BatchInput,
  user: AuthedUser,
): Promise<Record<string, unknown>> {
  const date = input.purchaseDate ?? today();
  const res = await client.query(
    `INSERT INTO dealer.part_batches
       (organization_id, part_id, qty_received, qty_remaining, unit_price, invoice, purchase_date)
     VALUES ($1,$2,$3,$3,$4,$5,$6) RETURNING *`,
    [orgId, partId, input.qty, money(input.unitPrice), input.invoice ?? '', date],
  );
  const batch = res.rows[0] as Record<string, unknown>;
  await client.query(
    `INSERT INTO dealer.part_movements
       (organization_id, part_id, batch_id, qty, type, unit_cost, total_cost, vehicle_id, date, note)
     VALUES ($1,$2,$3,$4,'purchase',$5,$6,NULL,$7,$8)`,
    [
      orgId,
      partId,
      batch.id,
      input.qty,
      money(input.unitPrice),
      money(input.qty * input.unitPrice),
      date,
      `Batch received (${input.invoice ?? ''})`,
    ],
  );
  await insertAudit(client, {
    orgId,
    actorId: user.id,
    actorName: user.displayName,
    action: 'PART_BATCH_RECEIVED',
    entityType: 'PartBatch',
    entityId: batch.id as string,
    summary: `Received ${input.qty} units of part ${partId} at $${money(input.unitPrice)} (${input.invoice ?? 'no invoice'}).`,
  });
  return batch;
}

export interface AllocateResult {
  allocation: Record<string, unknown>;
  slices: Array<{ batchId: string; qty: number; unitPrice: number }>;
  fifoCost: number;
}

/** FIFO allocate: oldest batches first; throws 400 on insufficient stock. */
export async function allocatePartTx(
  client: PoolClient,
  orgId: string,
  partId: string,
  vehicleId: string,
  qty: number,
  user: AuthedUser,
): Promise<AllocateResult> {
  const part = await client.query(
    `SELECT id FROM dealer.parts WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [partId, orgId],
  );
  if (part.rows.length === 0) throw notFound('Part not found');
  const vehicle = await client.query(
    `SELECT id, stock_number FROM dealer.vehicles WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [vehicleId, orgId],
  );
  if (vehicle.rows.length === 0) throw notFound('Vehicle not found');

  const batchesRes = await client.query(
    `SELECT id, part_id, qty_remaining, unit_price, purchase_date FROM dealer.part_batches
      WHERE organization_id = $1 AND part_id = $2 AND qty_remaining > 0 AND deleted_at IS NULL
      ORDER BY purchase_date ASC, id ASC`,
    [orgId, partId],
  );
  const batches = batchesRes.rows.map((r) => ({
    id: r.id as string,
    partId: r.part_id as string,
    qtyRemaining: Number(r.qty_remaining),
    unitPrice: num(r.unit_price),
    purchaseDate:
      r.purchase_date instanceof Date
        ? (r.purchase_date as Date).toISOString().slice(0, 10)
        : String(r.purchase_date),
  }));
  let consumed;
  try {
    consumed = fifoConsume(batches, partId, qty);
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : 'Insufficient stock');
  }
  const { slices, totalCost } = consumed;
  const allocRes = await client.query(
    `INSERT INTO dealer.part_allocations (organization_id, part_id, vehicle_id, qty, fifo_cost, date)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [orgId, partId, vehicleId, qty, totalCost, today()],
  );
  const allocation = allocRes.rows[0] as Record<string, unknown>;
  for (const slice of slices) {
    await client.query(
      `INSERT INTO dealer.part_allocation_slices (allocation_id, batch_id, qty, unit_price)
       VALUES ($1,$2,$3,$4)`,
      [allocation.id, slice.batchId, slice.qty, slice.unitPrice],
    );
    await client.query(
      `UPDATE dealer.part_batches SET qty_remaining = qty_remaining - $1 WHERE id = $2`,
      [slice.qty, slice.batchId],
    );
    await client.query(
      `INSERT INTO dealer.part_movements
         (organization_id, part_id, batch_id, qty, type, unit_cost, total_cost, vehicle_id, date, note)
       VALUES ($1,$2,$3,$4,'consume',$5,$6,$7,$8,$9)`,
      [
        orgId,
        partId,
        slice.batchId,
        -slice.qty,
        slice.unitPrice,
        -money(slice.qty * slice.unitPrice),
        vehicleId,
        today(),
        `FIFO: ${slice.qty} @ $${slice.unitPrice} to ${vehicle.rows[0].stock_number as string}`,
      ],
    );
  }
  await insertAudit(client, {
    orgId,
    actorId: user.id,
    actorName: user.displayName,
    action: 'PART_ALLOCATED',
    entityType: 'PartAllocation',
    entityId: allocation.id as string,
    summary: `${qty} units of ${partId} allocated to ${vehicle.rows[0].stock_number as string} at FIFO cost $${totalCost}.`,
  });
  return { allocation, slices, fifoCost: totalCost };
}

/**
 * Return part of an allocation: restore batches in reverse FIFO order
 * (last-consumed slice first), write positive 'return' movements, and shrink
 * the allocation + its slices so costing stays consistent.
 */
export async function returnAllocationTx(
  client: PoolClient,
  orgId: string,
  partId: string,
  allocationId: string,
  qty: number,
  user: AuthedUser,
): Promise<{ allocation: Record<string, unknown>; restored: Array<{ batchId: string; qty: number; unitPrice: number }> }> {
  const allocRes = await client.query(
    `SELECT * FROM dealer.part_allocations
      WHERE id = $1 AND organization_id = $2 AND part_id = $3 AND deleted_at IS NULL`,
    [allocationId, orgId, partId],
  );
  if (allocRes.rows.length === 0) throw notFound('Allocation not found');
  const allocation = allocRes.rows[0] as Record<string, unknown>;
  if (qty <= 0) throw badRequest('Return quantity must be positive');
  if (qty > Number(allocation.qty)) {
    throw badRequest(`Cannot return ${qty} units; allocation only has ${allocation.qty}.`);
  }
  // Slices in reverse FIFO order (newest consumption restored first).
  const slicesRes = await client.query(
    `SELECT s.batch_id, s.qty, s.unit_price, b.purchase_date
       FROM dealer.part_allocation_slices s
       JOIN dealer.part_batches b ON b.id = s.batch_id
      WHERE s.allocation_id = $1
      ORDER BY b.purchase_date DESC, s.batch_id DESC`,
    [allocationId],
  );
  const restored: Array<{ batchId: string; qty: number; unitPrice: number }> = [];
  let remaining = qty;
  let returnedCost = 0;
  for (const slice of slicesRes.rows) {
    if (remaining === 0) break;
    const take = Math.min(Number(slice.qty), remaining);
    const unitPrice = num(slice.unit_price);
    restored.push({ batchId: slice.batch_id as string, qty: take, unitPrice });
    returnedCost = money(returnedCost + take * unitPrice);
    remaining -= take;
    await client.query(
      `UPDATE dealer.part_batches SET qty_remaining = qty_remaining + $1 WHERE id = $2`,
      [take, slice.batch_id],
    );
    await client.query(
      `INSERT INTO dealer.part_movements
         (organization_id, part_id, batch_id, qty, type, unit_cost, total_cost, vehicle_id, date, note)
       VALUES ($1,$2,$3,$4,'return',$5,$6,$7,$8,$9)`,
      [
        orgId,
        partId,
        slice.batch_id,
        take,
        unitPrice,
        money(take * unitPrice),
        allocation.vehicle_id,
        today(),
        `Return of allocation ${allocationId}`,
      ],
    );
    const newSliceQty = Number(slice.qty) - take;
    if (newSliceQty === 0) {
      await client.query(
        `DELETE FROM dealer.part_allocation_slices WHERE allocation_id = $1 AND batch_id = $2`,
        [allocationId, slice.batch_id],
      );
    } else {
      await client.query(
        `UPDATE dealer.part_allocation_slices SET qty = $1 WHERE allocation_id = $2 AND batch_id = $3`,
        [newSliceQty, allocationId, slice.batch_id],
      );
    }
  }
  const newQty = Number(allocation.qty) - qty;
  const newCost = money(num(allocation.fifo_cost) - returnedCost);
  let updated = allocation;
  if (newQty === 0) {
    await client.query(`UPDATE dealer.part_allocations SET deleted_at = now() WHERE id = $1`, [allocationId]);
    updated = { ...allocation, qty: 0, fifo_cost: 0 };
  } else {
    const res = await client.query(
      `UPDATE dealer.part_allocations SET qty = $1, fifo_cost = $2 WHERE id = $3 RETURNING *`,
      [newQty, newCost, allocationId],
    );
    updated = res.rows[0] as Record<string, unknown>;
  }
  await insertAudit(client, {
    orgId,
    actorId: user.id,
    actorName: user.displayName,
    action: 'PART_RETURNED',
    entityType: 'PartAllocation',
    entityId: allocationId,
    summary: `Returned ${qty} units from allocation ${allocationId} (FIFO cost $${returnedCost} restored).`,
  });
  return { allocation: updated, restored };
}

// --- Deals & sales ----------------------------------------------------------
export interface DealInput {
  vehicleId: string;
  customerId: string;
  salesperson?: string;
  sellingPrice: number;
  discount?: number;
  taxes?: number;
  fees?: number;
  deposit?: number;
  tradeInValue?: number;
  tradeInDesc?: string;
  paymentMethod?: string;
}

export async function createDealTx(
  client: PoolClient,
  orgId: string,
  input: DealInput,
  user: AuthedUser,
): Promise<Record<string, unknown>> {
  const vehicle = await client.query(
    `SELECT id FROM dealer.vehicles WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [input.vehicleId, orgId],
  );
  if (vehicle.rows.length === 0) throw notFound('Vehicle not found');
  const customer = await client.query(
    `SELECT id FROM dealer.customers WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [input.customerId, orgId],
  );
  if (customer.rows.length === 0) throw notFound('Customer not found');
  const ref = await nextRef(client, orgId, 'DEAL');
  const res = await client.query(
    `INSERT INTO dealer.deals
       (organization_id, ref, vehicle_id, customer_id, salesperson, selling_price, discount,
        taxes, fees, deposit, trade_in_value, trade_in_desc, payment_method, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'Draft') RETURNING *`,
    [
      orgId,
      ref,
      input.vehicleId,
      input.customerId,
      input.salesperson ?? '',
      money(input.sellingPrice),
      money(input.discount ?? 0),
      money(input.taxes ?? 0),
      money(input.fees ?? 0),
      money(input.deposit ?? 0),
      money(input.tradeInValue ?? 0),
      input.tradeInDesc ?? '',
      input.paymentMethod ?? '',
    ],
  );
  const deal = res.rows[0] as Record<string, unknown>;
  await insertAudit(client, {
    orgId,
    actorId: user.id,
    actorName: user.displayName,
    action: 'DEAL_CREATED',
    entityType: 'Deal',
    entityId: deal.id as string,
    summary: `Deal ${ref} created for vehicle ${input.vehicleId} at $${money(input.sellingPrice)}.`,
  });
  return deal;
}

/**
 * Finalise a deal in ONE transaction: validate deal + vehicle + customer,
 * compute all-in cost + profit with the frontend engine, create the sale
 * (snapshot figures) + transaction + balanced 4-line journal + receivable
 * for any outstanding balance, mark the vehicle Sold, the deal Finalized and
 * the customer's leads Sold. Mirrors frontend finalizeSale().
 */
export async function finalizeSaleTx(
  client: PoolClient,
  orgId: string,
  dealId: string,
  user: AuthedUser,
): Promise<{ sale: Record<string, unknown> }> {
  const dealRes = await client.query(
    `SELECT * FROM dealer.deals WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [dealId, orgId],
  );
  if (dealRes.rows.length === 0) throw notFound('Deal not found');
  const deal = dealRes.rows[0] as Record<string, unknown>;
  if (deal.status === 'Finalized') throw conflict('Deal is already finalized.');
  if (deal.status !== 'Draft' && deal.status !== 'Negotiation') {
    throw badRequest(`Deal is ${deal.status} and cannot be finalized.`);
  }
  const vehicleRes = await client.query(
    `SELECT * FROM dealer.vehicles WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [deal.vehicle_id, orgId],
  );
  if (vehicleRes.rows.length === 0) throw notFound('Vehicle not found');
  const vehicle = vehicleRes.rows[0] as Record<string, unknown>;
  if (vehicle.status === 'Sold') {
    throw badRequest(`Vehicle ${vehicle.stock_number as string} is already sold.`);
  }
  if (vehicle.status !== 'Available' && vehicle.status !== 'Reserved') {
    throw badRequest(
      `Vehicle ${vehicle.stock_number as string} is ${vehicle.status as string} — only Available or Reserved vehicles can be sold.`,
    );
  }
  const customerRes = await client.query(
    `SELECT * FROM dealer.customers WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [deal.customer_id, orgId],
  );
  if (customerRes.rows.length === 0) throw notFound('Customer not found');
  const customer = customerRes.rows[0] as Record<string, unknown>;

  const settings = await getOrgSettings(client, orgId);
  const totalCost = await vehicleAllInCostDb(
    client,
    orgId,
    vehicle.id as string,
    {
      purchasePrice: num(vehicle.purchase_price),
      auctionFees: num(vehicle.auction_fees),
      transportCost: num(vehicle.transport_cost),
    },
    settings.overheadPerVehicle,
  );
  const profit = dealProfit(
    {
      sellingPrice: num(deal.selling_price),
      discount: num(deal.discount),
      taxes: num(deal.taxes),
      fees: num(deal.fees),
    },
    totalCost,
  );
  const netSelling = money(num(deal.selling_price) - num(deal.discount));
  const saleRef = await nextRef(client, orgId, 'SALE');
  const date = today();

  const saleRes = await client.query(
    `INSERT INTO dealer.sales
       (organization_id, ref, deal_id, vehicle_id, customer_id, selling_price,
        total_cost, gross_profit, net_profit, margin_pct, date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      orgId,
      saleRef,
      dealId,
      vehicle.id,
      customer.id,
      netSelling,
      totalCost,
      profit.grossProfit,
      profit.netProfit,
      profit.marginPct,
      date,
    ],
  );
  const sale = saleRes.rows[0] as Record<string, unknown>;

  const account = await getDefaultAccount(client, orgId);
  await postTransaction(client, orgId, {
    accountId: account.id,
    type: 'Vehicle sale',
    amount: netSelling,
    category: 'Sales',
    reference: saleRef,
    date,
    note: `${vehicle.year as number} ${vehicle.make as string} ${vehicle.model as string} sold to ${customer.name as string}`,
  });
  await createJournalEntry(client, orgId, {
    memo: `Sale ${saleRef}: ${vehicle.year as number} ${vehicle.make as string} ${vehicle.model as string}`,
    date,
    lines: [
      { account: account.name, debit: netSelling, credit: 0 },
      { account: 'Sales Revenue', debit: 0, credit: netSelling },
      { account: 'Cost of Goods Sold', debit: totalCost, credit: 0 },
      { account: 'Vehicle Inventory', debit: 0, credit: totalCost },
    ],
  });

  await client.query(
    `UPDATE dealer.vehicles SET status = 'Sold' WHERE id = $1 AND organization_id = $2`,
    [vehicle.id, orgId],
  );
  await client.query(
    `UPDATE dealer.deals SET status = 'Finalized', finalized_at = now(), sale_id = $1
      WHERE id = $2 AND organization_id = $3`,
    [sale.id, dealId, orgId],
  );
  await client.query(
    `UPDATE dealer.leads SET stage = 'Sold'
      WHERE organization_id = $1 AND customer_id = $2 AND deleted_at IS NULL`,
    [orgId, customer.id],
  );
  const outstanding = money(netSelling - num(deal.deposit));
  if (outstanding > 0) {
    await client.query(
      `INSERT INTO dealer.receivables
         (organization_id, kind, entity_name, reference, total, paid, due_date, status)
       VALUES ($1, 'Customer', $2, $3, $4, $5, $6, 'Partial')`,
      [orgId, customer.name, saleRef, netSelling, money(num(deal.deposit)), date],
    );
  }
  await insertAudit(client, {
    orgId,
    actorId: user.id,
    actorName: user.displayName,
    action: 'SALE_FINALIZED',
    entityType: 'Sale',
    entityId: sale.id as string,
    summary: `Sale ${saleRef} finalized: ${vehicle.year as number} ${vehicle.make as string} ${vehicle.model as string} sold for $${netSelling}, net profit $${profit.netProfit}.`,
  });
  return { sale };
}

// --- Receivables / payments -------------------------------------------------
/**
 * Record a payment against a receivable. Rejects any amount over the
 * outstanding balance (400). Customer receivables take money in; Vendor /
 * Carrier rows are payables and take money out.
 */
export async function recordPaymentTx(
  client: PoolClient,
  orgId: string,
  receivableId: string,
  amount: number,
  accountId: string,
  user: AuthedUser,
): Promise<{ receivable: Record<string, unknown> }> {
  const recRes = await client.query(
    `SELECT * FROM dealer.receivables WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [receivableId, orgId],
  );
  if (recRes.rows.length === 0) throw notFound('Receivable not found');
  const rec = recRes.rows[0] as Record<string, unknown>;
  const outstanding = money(num(rec.total) - num(rec.paid));
  if (amount <= 0) throw badRequest('Amount must be positive.');
  if (amount > outstanding) {
    throw badRequest(`Amount exceeds the outstanding balance of $${outstanding}.`);
  }
  const accountRes = await client.query(
    `SELECT id, name FROM dealer.accounts WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [accountId, orgId],
  );
  if (accountRes.rows.length === 0) throw notFound('Account not found');
  const account = accountRes.rows[0] as Record<string, unknown>;
  const date = today();
  const amountMoney = money(amount);

  await client.query(
    `INSERT INTO dealer.payments (organization_id, receivable_id, account_id, amount, date, note)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [orgId, receivableId, accountId, amountMoney, date, `Payment for ${rec.reference as string}`],
  );
  const newPaid = money(num(rec.paid) + amountMoney);
  const newStatus = newPaid >= num(rec.total) ? 'Paid' : 'Partial';
  const updatedRes = await client.query(
    `UPDATE dealer.receivables SET paid = $1, status = $2 WHERE id = $3 RETURNING *`,
    [newPaid, newStatus, receivableId],
  );
  const updated = updatedRes.rows[0] as Record<string, unknown>;

  if (rec.kind === 'Customer') {
    await postTransaction(client, orgId, {
      accountId,
      type: 'Customer payment',
      amount: amountMoney,
      category: 'Receivables',
      reference: rec.reference as string,
      date,
      note: `Payment from ${rec.entity_name as string}`,
    });
    await createJournalEntry(client, orgId, {
      memo: `Payment ${rec.reference as string}`,
      date,
      lines: [
        { account: account.name as string, debit: amountMoney, credit: 0 },
        { account: 'Accounts Receivable', debit: 0, credit: amountMoney },
      ],
    });
  } else {
    await postTransaction(client, orgId, {
      accountId,
      type: 'Vendor payment',
      amount: -amountMoney,
      category: 'Payables',
      reference: rec.reference as string,
      date,
      note: `Payment to ${rec.entity_name as string}`,
    });
    await createJournalEntry(client, orgId, {
      memo: `Payment ${rec.reference as string}`,
      date,
      lines: [
        { account: 'Accounts Payable', debit: amountMoney, credit: 0 },
        { account: account.name as string, debit: 0, credit: amountMoney },
      ],
    });
  }
  await insertAudit(client, {
    orgId,
    actorId: user.id,
    actorName: user.displayName,
    action: 'PAYMENT_RECORDED',
    entityType: 'Receivable',
    entityId: receivableId,
    summary: `Payment of $${amountMoney} recorded for ${rec.reference as string}.`,
  });
  return { receivable: updated };
}

// --- Transfers / journal ----------------------------------------------------
export async function transferTx(
  client: PoolClient,
  orgId: string,
  fromAccountId: string,
  toAccountId: string,
  amount: number,
  note: string,
  user: AuthedUser,
): Promise<{ ref: string }> {
  if (fromAccountId === toAccountId) {
    throw badRequest('Source and destination accounts must differ.');
  }
  if (amount <= 0) throw badRequest('Amount must be positive.');
  const accounts = await client.query(
    `SELECT id, name FROM dealer.accounts
      WHERE id = ANY($1::uuid[]) AND organization_id = $2 AND deleted_at IS NULL`,
    [[fromAccountId, toAccountId], orgId],
  );
  if (accounts.rows.length !== 2) throw notFound('One or both accounts were not found');
  const byId = new Map(accounts.rows.map((r) => [r.id as string, r.name as string]));
  const date = today();
  const amountMoney = money(amount);
  const journal = await createJournalEntry(client, orgId, {
    memo: `Transfer: ${note}`,
    date,
    lines: [
      { account: byId.get(toAccountId) ?? toAccountId, debit: amountMoney, credit: 0 },
      { account: byId.get(fromAccountId) ?? fromAccountId, debit: 0, credit: amountMoney },
    ],
  });
  await postTransaction(client, orgId, {
    accountId: fromAccountId,
    type: 'Transfer',
    amount: -amountMoney,
    category: 'Transfers',
    reference: journal.ref,
    date,
    note,
  });
  await postTransaction(client, orgId, {
    accountId: toAccountId,
    type: 'Transfer',
    amount: amountMoney,
    category: 'Transfers',
    reference: journal.ref,
    date,
    note,
  });
  await insertAudit(client, {
    orgId,
    actorId: user.id,
    actorName: user.displayName,
    action: 'TRANSFER_RECORDED',
    entityType: 'JournalEntry',
    entityId: journal.id,
    summary: `Transfer of $${amountMoney} from ${byId.get(fromAccountId)} to ${byId.get(toAccountId)}.`,
  });
  return { ref: journal.ref };
}

/**
 * Reverse a journal entry: creates a new entry with negated lines and marks
 * the original reversed. Originals are never updated or deleted.
 */
export async function reverseJournalTx(
  client: PoolClient,
  orgId: string,
  entryId: string,
  user: AuthedUser,
): Promise<{ reversal: Record<string, unknown>; original: Record<string, unknown> }> {
  const entryRes = await client.query(
    `SELECT * FROM dealer.journal_entries WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [entryId, orgId],
  );
  if (entryRes.rows.length === 0) throw notFound('Journal entry not found');
  const entry = entryRes.rows[0] as Record<string, unknown>;
  if (entry.reversed) throw conflict('Journal entry has already been reversed.');
  const linesRes = await client.query(
    `SELECT account, debit, credit FROM dealer.journal_entry_lines WHERE entry_id = $1`,
    [entryId],
  );
  const reversal = await createJournalEntry(client, orgId, {
    memo: `Reversal of ${entry.ref as string}: ${entry.memo as string}`,
    date: today(),
    lines: linesRes.rows.map((l) => ({
      account: l.account as string,
      debit: num(l.credit),
      credit: num(l.debit),
    })),
  });
  const updatedRes = await client.query(
    `UPDATE dealer.journal_entries SET reversed = TRUE, reversed_by = $1 WHERE id = $2 RETURNING *`,
    [reversal.id, entryId],
  );
  // Keep the reversal discoverable from the original's date/memo context.
  await insertAudit(client, {
    orgId,
    actorId: user.id,
    actorName: user.displayName,
    action: 'JOURNAL_REVERSED',
    entityType: 'JournalEntry',
    entityId: entryId,
    summary: `Journal entry ${entry.ref as string} reversed by ${reversal.ref}.`,
  });
  return {
    reversal: { id: reversal.id, ref: reversal.ref, date: today(), memo: `Reversal of ${entry.ref as string}`, lines: linesRes.rows, reversed: false, reversedBy: null },
    original: updatedRes.rows[0] as Record<string, unknown>,
  };
}
