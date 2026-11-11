// Shared string constants for the frontend domain types the server mirrors
// (src/store/types.ts). Kept as plain consts so pure modules stay free of
// framework imports.

export type ExpenseCategory =
  | 'Mechanical repairs' | 'Bodywork' | 'Paint' | 'Detailing' | 'Tires'
  | 'Battery' | 'Glass' | 'Inspection' | 'Parts' | 'Labor' | 'Transportation'
  | 'Auction fees' | 'Advertising' | 'Rent' | 'Utilities' | 'Insurance'
  | 'Payroll' | 'Other overhead';

export type Role =
  | 'Owner' | 'Admin' | 'Manager' | 'Sales' | 'Accountant' | 'Technician' | 'Viewer';

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Mechanical repairs', 'Bodywork', 'Paint', 'Detailing', 'Tires',
  'Battery', 'Glass', 'Inspection', 'Parts', 'Labor', 'Transportation',
  'Auction fees', 'Advertising', 'Rent', 'Utilities', 'Insurance',
  'Payroll', 'Other overhead',
];

export const VEHICLE_STATUSES = [
  'Purchased', 'Awaiting pickup', 'In transit', 'Received', 'Inspection',
  'In reconditioning', 'Available', 'Reserved', 'Sold', 'Returned', 'Wholesale',
] as const;

export const TRANSPORT_STATUSES = [
  'Awaiting pickup', 'Scheduled', 'Picked up', 'In transit',
  'Delivered', 'Delayed', 'Cancelled',
] as const;

export const LEAD_STAGES = [
  'New Lead', 'Contacted', 'Viewing', 'Negotiation', 'Sold', 'Lost',
] as const;
