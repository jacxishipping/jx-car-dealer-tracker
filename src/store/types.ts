// JX Car Dealer Tracker — shared data model (single source of truth).
// Every module reads/writes these records. Money is in USD, rounded to 2dp.

export type VehicleStatus =
  | 'Purchased' | 'Awaiting pickup' | 'In transit' | 'Received' | 'Inspection'
  | 'In reconditioning' | 'Available' | 'Reserved' | 'Sold' | 'Returned' | 'Wholesale'

export type TransportStatus =
  | 'Awaiting pickup' | 'Scheduled' | 'Picked up' | 'In transit'
  | 'Delivered' | 'Delayed' | 'Cancelled'

export type LeadStage =
  | 'New Lead' | 'Contacted' | 'Viewing' | 'Negotiation' | 'Sold' | 'Lost'

export type Role =
  | 'Owner' | 'Admin' | 'Manager' | 'Sales' | 'Accountant' | 'Technician' | 'Viewer'

export interface Vehicle {
  id: string
  stockNumber: string
  vin: string
  year: number
  make: string
  model: string
  trim: string
  extColor: string
  intColor: string
  mileage: number
  transmission: string
  engine: string
  fuel: string
  drivetrain: string
  bodyType: string
  condition: 'Excellent' | 'Good' | 'Fair' | 'Poor'
  titleStatus: 'Clean' | 'Salvage' | 'Rebuilt' | 'Lien' | 'Missing'
  status: VehicleStatus
  purchaseDate: string // ISO date
  purchaseSource: 'Auction' | 'Wholesale' | 'Private seller' | 'Trade-in' | 'Other dealer'
  purchasePrice: number
  auctionFees: number
  transportCost: number
  askingPrice: number
  minPrice: number
  photos: string[] // placeholder labels, e.g. "front.jpg"
  notes: string
  createdAt: string
}

export interface Purchase {
  id: string
  ref: string // e.g. ACQ-0001
  vehicleId: string
  seller: string
  auction: string
  purchaseDate: string
  vehiclePrice: number
  buyerFees: number
  auctionFees: number
  taxes: number
  transportEstimate: number
  paymentMethod: string
  paymentStatus: 'Paid' | 'Partial' | 'Unpaid'
  documents: string
  createdAt: string
}

export interface TransportOrder {
  id: string
  vehicleId: string
  carrier: string
  driver: string
  pickupLocation: string
  deliveryLocation: string
  pickupDate: string
  expectedDelivery: string
  actualDelivery: string | null
  price: number
  status: TransportStatus
  gatePass: string
  billOfLading: string
  damageNotes: string
  invoiceRef: string
  paymentStatus: 'Paid' | 'Partial' | 'Unpaid'
  photos: string[]
}

export type ExpenseCategory =
  | 'Mechanical repairs' | 'Bodywork' | 'Paint' | 'Detailing' | 'Tires'
  | 'Battery' | 'Glass' | 'Inspection' | 'Parts' | 'Labor' | 'Transportation'
  | 'Auction fees' | 'Advertising' | 'Rent' | 'Utilities' | 'Insurance'
  | 'Payroll' | 'Other overhead'

export interface Expense {
  id: string
  description: string
  amount: number
  category: ExpenseCategory
  date: string
  vendor: string
  vehicleId: string | null // null = general overhead
  kind: 'Direct' | 'Overhead'
  paymentMethod: string
  status: 'Paid' | 'Pending'
  invoiceRef: string
  createdBy: string
  notes: string
}

export interface ReconJob {
  id: string
  vehicleId: string
  title: string
  category: ExpenseCategory
  status: 'Not started' | 'In progress' | 'Done'
  technician: string
  estimatedCost: number
  actualCost: number
  startedAt: string
  completedAt: string | null
  notes: string
}

export interface Part {
  id: string
  sku: string
  name: string
  manufacturer: string
  supplier: string
  minStock: number
}

export interface PartBatch {
  id: string
  partId: string
  qtyReceived: number
  qtyRemaining: number
  unitPrice: number
  invoice: string
  purchaseDate: string
}

export interface PartMovement {
  id: string
  partId: string
  batchId: string | null
  qty: number // positive = in, negative = out (consumption is negative)
  type: 'purchase' | 'consume' | 'return' | 'adjust' | 'sale'
  unitCost: number
  totalCost: number
  vehicleId: string | null
  date: string
  note: string
}

export interface PartAllocation {
  id: string
  partId: string
  vehicleId: string
  qty: number
  fifoCost: number
  date: string
  batches: { batchId: string; qty: number; unitPrice: number }[]
}

export interface Customer {
  id: string
  name: string
  phone: string
  email: string
  address: string
  preferredContact: 'Phone' | 'Email' | 'WhatsApp'
  budget: number
  leadSource: string
  salesperson: string
  notes: string
  interestedVehicleIds: string[]
}

export interface Lead {
  id: string
  customerId: string
  stage: LeadStage
  createdAt: string
  followUpDate: string
  notes: string
}

export interface Interaction {
  id: string
  customerId: string
  type: 'Call' | 'Email' | 'WhatsApp' | 'Visit' | 'Test drive'
  date: string
  notes: string
  salesperson: string
}

export interface Offer {
  id: string
  vehicleId: string
  customerId: string
  amount: number
  date: string
  status: 'Open' | 'Accepted' | 'Declined' | 'Expired'
  notes: string
}

export interface Deal {
  id: string
  ref: string // e.g. DEAL-0001
  vehicleId: string
  customerId: string
  salesperson: string
  sellingPrice: number
  discount: number
  taxes: number
  fees: number
  deposit: number
  tradeInValue: number
  tradeInDesc: string
  paymentMethod: string
  status: 'Draft' | 'Negotiation' | 'Finalized' | 'Cancelled'
  createdAt: string
  finalizedAt: string | null
  saleRef: string | null
}

export interface Sale {
  id: string
  ref: string // e.g. SALE-0001
  dealId: string
  vehicleId: string
  customerId: string
  sellingPrice: number
  totalCost: number
  grossProfit: number
  netProfit: number
  marginPct: number
  date: string
}

export interface Account {
  id: string
  name: string
  type: 'Bank' | 'Cash' | 'Petty cash' | 'Floorplan' | 'Credit'
  currency: string
  openingBalance: number
  status: 'Active' | 'Closed'
}

export interface FinancialTransaction {
  id: string
  accountId: string
  type: 'Deposit' | 'Withdrawal' | 'Vehicle purchase' | 'Vehicle sale' | 'Customer payment' | 'Vendor payment' | 'Transfer' | 'Refund' | 'Debt payment' | 'Expense payment'
  amount: number // signed: + in, − out
  category: string
  reference: string
  date: string
  note: string
}

export interface JournalLine {
  account: string
  debit: number
  credit: number
}

export interface JournalEntry {
  id: string
  ref: string
  date: string
  memo: string
  lines: JournalLine[]
  reversedBy: string | null
  reversed: boolean
}

export interface Receivable {
  id: string
  kind: 'Customer' | 'Vendor' | 'Carrier'
  entityName: string
  reference: string
  total: number
  paid: number
  dueDate: string
  status: 'Open' | 'Partial' | 'Paid' | 'Overdue'
}

export interface DocRecord {
  id: string
  title: string
  type: string
  entityType: 'Vehicle' | 'Customer' | 'Expense' | 'Transaction' | 'Deal'
  entityId: string
  fileName: string
  fileSize: number
  fileType: string
  uploadedAt: string
  uploadedBy: string
  expiresAt: string | null
  accessRole: Role
}

export interface TeamMember {
  id: string
  name: string
  email: string
  role: Role
  active: boolean
}

export interface AuditEvent {
  id: string
  at: string
  actor: string
  action: string
  entityType: string
  entityId: string
  summary: string
}

export interface NotificationItem {
  id: string
  title: string
  detail: string
  kind: 'alert' | 'info' | 'success'
  date: string
  read: boolean
}

export interface Settings {
  orgName: string
  currency: string
  targetHoldDays: number
  overheadPerVehicle: number
  theme: 'light' | 'dark'
}

export interface AppState {
  vehicles: Vehicle[]
  purchases: Purchase[]
  transport: TransportOrder[]
  expenses: Expense[]
  reconJobs: ReconJob[]
  parts: Part[]
  partBatches: PartBatch[]
  partMovements: PartMovement[]
  partAllocations: PartAllocation[]
  customers: Customer[]
  leads: Lead[]
  interactions: Interaction[]
  offers: Offer[]
  deals: Deal[]
  sales: Sale[]
  accounts: Account[]
  transactions: FinancialTransaction[]
  journal: JournalEntry[]
  receivables: Receivable[]
  documents: DocRecord[]
  team: TeamMember[]
  audit: AuditEvent[]
  notifications: NotificationItem[]
  settings: Settings
  currentRole: Role
  currentUser: string
}

export const VEHICLE_STATUSES: VehicleStatus[] = [
  'Purchased', 'Awaiting pickup', 'In transit', 'Received', 'Inspection',
  'In reconditioning', 'Available', 'Reserved', 'Sold', 'Returned', 'Wholesale',
]

export const TRANSPORT_STATUSES: TransportStatus[] = [
  'Awaiting pickup', 'Scheduled', 'Picked up', 'In transit', 'Delivered', 'Delayed', 'Cancelled',
]

export const LEAD_STAGES: LeadStage[] = [
  'New Lead', 'Contacted', 'Viewing', 'Negotiation', 'Sold', 'Lost',
]

export const ROLES: Role[] = [
  'Owner', 'Admin', 'Manager', 'Sales', 'Accountant', 'Technician', 'Viewer',
]

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Mechanical repairs', 'Bodywork', 'Paint', 'Detailing', 'Tires',
  'Battery', 'Glass', 'Inspection', 'Parts', 'Labor', 'Transportation',
  'Auction fees', 'Advertising', 'Rent', 'Utilities', 'Insurance',
  'Payroll', 'Other overhead',
]

export const uid = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}${Date.now().toString(36).slice(-4).toUpperCase()}`

export const money = (n: number) =>
  Math.round(n * 100) / 100

export const fmtMoney = (n: number) =>
  '$' + money(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
