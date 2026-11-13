// MCP integration — documentation + in-app tool registry.
//
// This page is NOT a live MCP server. It documents the tool surface the
// production backend must expose and maps every tool to the store function
// that already implements the same logic in this build. A live MCP server
// needs the production backend (PostgreSQL, real auth, server-side RBAC) —
// see docs/ARCHITECTURE.md and docs/schema.sql.
import { JXAlert, JXButton, JXCard, JXChip } from '@jacxishippingorg/jx-ui-react'
import { PageHeader, TableScrollHint } from '../components/ui'

interface Tool {
  name: string
  kind: 'READ' | 'WRITE'
  description: string
  inputSchema: Record<string, string>
  output: string
  auth: string
  confirm: string
  implements: string
}

const READ_TOOLS: Tool[] = [
  { name: 'get_inventory_summary', kind: 'READ', description: 'Dealership KPIs: stock count, inventory value (all-in cost), acquisition cost, sales revenue, gross/net profit, cash, receivables/payables, counts by status.', inputSchema: {}, output: 'DashboardKpis object (see src/store/engine.ts dashboardKpis).', auth: 'Any authenticated role.', confirm: 'None — read-only.', implements: 'dashboardKpis(state) in src/store/engine.ts' },
  { name: 'search_vehicles', kind: 'READ', description: 'Search vehicles by stock number, VIN, make, model or status, with optional status filter.', inputSchema: { query: 'string, optional', status: 'VehicleStatus, optional', limit: 'number, optional (default 20)' }, output: 'Vehicle[] (summary fields).', auth: 'Any authenticated role.', confirm: 'None — read-only.', implements: 'state.vehicles filter in src/store/store.tsx' },
  { name: 'get_vehicle_details', kind: 'READ', description: 'Full record for one vehicle: specs, status, purchase, transport orders, expenses, recon jobs, parts allocated, documents.', inputSchema: { vehicleId: 'string, required — or stockNumber' }, output: 'Vehicle + related records.', auth: 'Any authenticated role.', confirm: 'None — read-only.', implements: 'state lookups by id; vehicleAllInCost() in src/store/engine.ts' },
  { name: 'get_vehicle_profit', kind: 'READ', description: 'Profitability for one vehicle: all-in cost breakdown, asking/min price, and (for a deal) gross/net profit and margin.', inputSchema: { vehicleId: 'string, required', dealId: 'string, optional' }, output: 'DealProfit + cost breakdown.', auth: 'Manager, Accountant, Owner, Admin.', confirm: 'None — read-only.', implements: 'vehicleAllInCost() + dealProfit() in src/store/engine.ts' },
  { name: 'get_sales_summary', kind: 'READ', description: 'Sales totals for a period: revenue, gross/net profit, margin, deals by status, top vehicles.', inputSchema: { from: 'ISO date, optional', to: 'ISO date, optional' }, output: 'Aggregates over Sale[] and Deal[].', auth: 'Manager, Accountant, Owner, Admin.', confirm: 'None — read-only.', implements: 'state.sales / state.deals aggregates (dashboardKpis, monthlySeries)' },
  { name: 'get_expenses', kind: 'READ', description: 'Expenses filtered by category, vehicle, kind (Direct/Overhead) or date range.', inputSchema: { vehicleId: 'string, optional', category: 'ExpenseCategory, optional', kind: '"Direct" | "Overhead", optional', from: 'ISO date, optional', to: 'ISO date, optional' }, output: 'Expense[] + total.', auth: 'Manager, Accountant, Owner, Admin.', confirm: 'None — read-only.', implements: 'state.expenses filter; vehicleDirectExpenses() in engine.ts' },
  { name: 'get_customer_details', kind: 'READ', description: 'One customer with leads, interactions, offers and deals.', inputSchema: { customerId: 'string, required' }, output: 'Customer + related records.', auth: 'Sales, Manager, Owner, Admin.', confirm: 'None — read-only.', implements: 'state.customers / leads / interactions / offers / deals lookups' },
  { name: 'get_followups', kind: 'READ', description: 'Open leads whose follow-up date is in the past (overdue), oldest first.', inputSchema: { salesperson: 'string, optional' }, output: 'Lead[] joined to Customer.', auth: 'Sales, Manager, Owner, Admin.', confirm: 'None — read-only.', implements: 'state.leads filter (same rule as the AI Assistant follow-up query)' },
  { name: 'get_account_balances', kind: 'READ', description: 'Per-account balances (opening balance + signed transactions) and total cash.', inputSchema: {}, output: 'Account[] with computed balance + totalCash.', auth: 'Accountant, Manager, Owner, Admin.', confirm: 'None — read-only.', implements: 'accountBalance() + totalCash() in src/store/engine.ts' },
  { name: 'get_low_stock_parts', kind: 'READ', description: 'Parts whose remaining stock (sum of batch qtyRemaining) is at or below minStock.', inputSchema: {}, output: 'Part[] with stock and minStock.', auth: 'Technician, Manager, Owner, Admin.', confirm: 'None — read-only.', implements: 'partStock() in src/store/engine.ts vs Part.minStock' },
  { name: 'get_aged_inventory', kind: 'READ', description: 'Unsold vehicles held longer than a threshold (default = settings.targetHoldDays, 45).', inputSchema: { days: 'number, optional (default 45)' }, output: 'Vehicle[] with daysInStock.', auth: 'Manager, Owner, Admin.', confirm: 'None — read-only.', implements: 'daysInStock() in src/store/engine.ts' },
]

const WRITE_TOOLS: Tool[] = [
  { name: 'create_vehicle', kind: 'WRITE', description: 'Register a vehicle. VIN must be unique per organization — a duplicate VIN is rejected.', inputSchema: { stockNumber: 'string, required', vin: 'string, required (17 chars)', year: 'number, required', make: 'string, required', model: 'string, required', purchasePrice: 'number, required', askingPrice: 'number, required', purchaseDate: 'ISO date, required', purchaseSource: '"Auction" | "Wholesale" | "Private seller" | "Trade-in" | "Other dealer"' }, output: 'Vehicle id + audit entry.', auth: 'Manager, Owner, Admin.', confirm: 'Confirm step required; duplicate-VIN check enforced server-side (UNIQUE vin per organization).', implements: 'addVehicle() in src/store/store.tsx' },
  { name: 'record_expense', kind: 'WRITE', description: 'Record a Direct or Overhead expense. A Paid expense also posts a transaction + journal entry.', inputSchema: { description: 'string, required', amount: 'number > 0, required', category: 'ExpenseCategory, required', date: 'ISO date, required', vehicleId: 'string | null', kind: '"Direct" | "Overhead", required', status: '"Paid" | "Pending"' }, output: 'Expense id + audit entry (+ transaction/journal when Paid).', auth: 'Manager, Accountant, Owner, Admin.', confirm: 'Confirm step required for Paid expenses (money moves).', implements: 'recordExpense() in src/store/store.tsx' },
  { name: 'create_customer', kind: 'WRITE', description: 'Create a customer record.', inputSchema: { name: 'string, required', phone: 'string, optional', email: 'string, optional', budget: 'number, optional', leadSource: 'string, optional', salesperson: 'string, optional' }, output: 'Customer id.', auth: 'Sales, Manager, Owner, Admin.', confirm: 'Confirm step required.', implements: 'addCustomer() in src/store/store.tsx' },
  { name: 'create_lead', kind: 'WRITE', description: 'Create a lead for an existing customer with a follow-up date.', inputSchema: { customerId: 'string, required', stage: 'LeadStage, required', followUpDate: 'ISO date, required', notes: 'string, optional' }, output: 'Lead id.', auth: 'Sales, Manager, Owner, Admin.', confirm: 'Confirm step required.', implements: 'addLead() in src/store/store.tsx' },
  { name: 'create_purchase', kind: 'WRITE', description: 'Record a vehicle purchase (creates the vehicle + purchase; Paid/Partial also posts transaction, journal entry and a vendor payable).', inputSchema: { seller: 'string, required', vehiclePrice: 'number, required', buyerFees: 'number', auctionFees: 'number', taxes: 'number', paymentStatus: '"Paid" | "Partial" | "Unpaid"', vehicle: 'Vehicle fields (see create_vehicle)' }, output: 'Purchase ref (ACQ-####) + audit entry.', auth: 'Manager, Owner, Admin.', confirm: 'Confirm step required — moves money. Duplicate-VIN check enforced.', implements: 'recordPurchase() in src/store/store.tsx' },
  { name: 'create_sale', kind: 'WRITE', description: 'Create a deal (Draft) and, on finalisation, mark the vehicle Sold, post the sale transaction + journal entry, close the lead and open a customer receivable for any outstanding balance.', inputSchema: { vehicleId: 'string, required', customerId: 'string, required', sellingPrice: 'number, required', discount: 'number', taxes: 'number', fees: 'number', deposit: 'number', paymentMethod: 'string, required' }, output: 'Deal ref (DEAL-####), then Sale ref (SALE-####) on finalisation.', auth: 'Sales (create draft), Manager/Owner (finalise).', confirm: 'Two-step: confirm the draft, then a separate confirm to finalise. Finalisation is atomic and irreversible in-app.', implements: 'createDeal() + finalizeSale() in src/store/store.tsx' },
  { name: 'record_payment', kind: 'WRITE', description: 'Record a payment against a receivable. Amount must be positive and not exceed the outstanding balance.', inputSchema: { receivableId: 'string, required', amount: 'number > 0, required', accountId: 'string, required' }, output: 'Updated receivable + transaction + journal entry + audit entry.', auth: 'Accountant, Manager, Owner, Admin.', confirm: 'Confirm step required — moves money. Overpayment is rejected.', implements: 'recordPayment() in src/store/store.tsx' },
  { name: 'allocate_part_to_vehicle', kind: 'WRITE', description: 'Allocate part stock to a vehicle at FIFO cost (oldest batch first). Fails on insufficient stock; writes part movements + allocation and updates batch quantities.', inputSchema: { partId: 'string, required', vehicleId: 'string, required', qty: 'number > 0, required' }, output: 'Allocation id + FIFO cost + slices consumed.', auth: 'Technician, Manager, Owner, Admin.', confirm: 'Confirm step required; FIFO cost is shown in the preview before confirming.', implements: 'allocatePart() in src/store/store.tsx (fifoConsume in engine.ts)' },
]

function ToolTable({ tools }: { tools: Tool[] }) {
  return (
              <>
                <TableScrollHint />
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        <th className="py-2 pr-3">Tool</th>
                        <th className="py-2 pr-3">What it does</th>
                        <th className="py-2 pr-3">Input schema (JSON)</th>
                        <th className="py-2 pr-3">Auth / confirmation</th>
                        <th className="py-2">Implemented in this build by</th>
                      </tr>
              </thead>
              <tbody>
                {tools.map((t) => (
                  <tr key={t.name} className="border-b border-slate-100 align-top dark:border-slate-700">
                    <td className="py-3 pr-3 font-mono text-xs font-semibold text-indigo-700 dark:text-indigo-300">{t.name}</td>
                    <td className="py-3 pr-3 text-slate-600 dark:text-slate-300">{t.description}<p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Returns: {t.output}</p></td>
                    <td className="py-3 pr-3"><pre className="whitespace-pre-wrap break-words rounded-[var(--radius-control)] bg-slate-50 p-2 font-mono text-[11px] text-slate-600 dark:bg-slate-900 dark:text-slate-300">{JSON.stringify(t.inputSchema, null, 1) === '{}' ? '(no inputs)' : JSON.stringify(t.inputSchema, null, 1)}</pre></td>
                    <td className="py-3 pr-3 text-slate-600 dark:text-slate-300">{t.auth}<p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t.confirm}</p></td>
                    <td className="py-3 font-mono text-[11px] text-slate-500 dark:text-slate-400">{t.implements}</td>
                  </tr>
                ))}
              </tbody>
            </table>
      </div>
      </>
      )
}

      export default function Mcp() {
  return (
    <>
        <PageHeader
          title="MCP Integration"
          subtitle="Model Context Protocol — tool documentation and in-app registry."
        />
        <JXAlert
          severity="warning"
          title="Not a live MCP server"
          description="This page is documentation plus an in-app tool registry. It does not expose an MCP endpoint, accept MCP clients, or call any external service. A live MCP server needs the production backend: PostgreSQL, real authentication, server-side RBAC, and the tools below implemented as server endpoints — see docs/ARCHITECTURE.md and docs/schema.sql. Everything listed here already exists as a store function in this build; the registry table maps each tool to that function."
        />

        <div className="mt-5 grid gap-5 lg:grid-cols-3">
            <JXCard className="!rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
              <div className="p-5">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">Connection (production)</h2>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-600 dark:text-slate-300">
                  <li>Deploy the production backend with the PostgreSQL schema in <code className="font-mono text-xs">docs/schema.sql</code>.</li>
                  <li>Create an API credential for the MCP client (per-organization, scoped to the tools it needs). Credentials are issued in Settings → API access, never pasted into chat.</li>
                  <li>Point the MCP client at the server endpoint (for example <code className="font-mono text-xs">https://api.example.com/mcp</code>) with the credential in the <code className="font-mono text-xs">Authorization</code> header.</li>
                  <li>The client lists tools, then calls them by name with the JSON input shown below. Every call is checked against the caller&apos;s role before it runs.</li>
                </ol>
                <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">No endpoint, host, or credential exists in this build — the steps above describe the production setup only.</p>
              </div>
            </JXCard>
              <JXCard className="!rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
                <div className="p-5">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">Auth &amp; permissions</h2>
                  <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                    <li><strong>Transport:</strong> HTTPS only; bearer credential per client, scoped per organization.</li>
                    <li><strong>Roles:</strong> Owner, Admin, Manager, Sales, Accountant, Technician, Viewer — the same roles as the app (see Team &amp; Permissions). Viewer can only call READ tools.</li>
                    <li><strong>Money rule:</strong> every WRITE tool that moves money (record_expense when Paid, create_purchase, create_sale finalisation, record_payment) requires an explicit confirmation step and writes an audit entry.</li>
                    <li><strong>Invariants enforced server-side:</strong> unique VIN per organization, no overpayment of a receivable, FIFO stock cannot go negative, a vehicle can only be sold from Available or Reserved.</li>
                  </ul>
                </div>
              </JXCard>
                <JXCard className="!rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
                  <div className="p-5">
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white">Audit &amp; safety</h2>
                    <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                      <li>Every WRITE call writes an <code className="font-mono text-xs">audit_logs</code> row (actor, action, entity, summary) — the same audit trail the app shows on the AI Assistant page.</li>
                      <li>Money movement always writes a journal entry alongside the transaction; a balance can never change without a ledger entry.</li>
                      <li>There is no delete tool in this surface. Deletions (if ever added) require Owner confirmation and are soft deletes.</li>
                      <li>Read tools never mutate state.</li>
                    </ul>
                    <div className="mt-4 flex gap-2">
                      <JXChip label={`${READ_TOOLS.length} READ tools`} tone="emerald" />
                      <JXChip label={`${WRITE_TOOLS.length} WRITE tools`} tone="amber" />
                    </div>
                  </div>
                </JXCard>
              </div>

                <JXCard className="mt-5 !rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
                  <div className="p-5">
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white">READ tools ({READ_TOOLS.length})</h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Read-only. Any authenticated role may call them unless a narrower role list is shown.</p>
                    <div className="mt-3"><ToolTable tools={READ_TOOLS} /></div>
                  </div>
                </JXCard>

                  <JXCard className="mt-5 !rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
                    <div className="p-5">
                      <h2 className="text-base font-semibold text-slate-900 dark:text-white">WRITE tools ({WRITE_TOOLS.length})</h2>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">All WRITE tools require an explicit confirmation step in the calling client, enforce the role shown, and write an audit entry. Sensitive operations (sale finalisation, purchases, payments) are two-step in the app and must be two-step over MCP as well.</p>
                      <div className="mt-3"><ToolTable tools={WRITE_TOOLS} /></div>
                    </div>
                  </JXCard>

                    <JXCard className="mt-5 !rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
                      <div className="p-5">
                        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Example call (production shape)</h2>
          <pre className="mt-3 overflow-x-auto rounded-[var(--radius-control)] bg-slate-900 p-4 font-mono text-xs text-slate-100">{`{
                            "jsonrpc": "2.0",
                          "id": 1,
                          "method": "tools/call",
                          "params": {
                            "name": "get_aged_inventory",
                          "arguments": {"days": 45 }
  }
}
// → {"vehicles": [ {"stockNumber": "CDT-110", "daysInStock": 87, … } ] }`}</pre>
                          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                            The example above is the wire shape a production server would use. It is not executable from this page — there is no server in this build.
                          </p>
                          <div className="mt-4">
                            <JXButton variant="outlined" lockWidth={false} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Back to top</JXButton>
                          </div>
                      </div>
                    </JXCard>
                  </>
                  )
}
