// Deterministic text-command parser — a direct port of the frontend
// AiAssistant parseCommand() (src/pages/AiAssistant.tsx). There is NO AI
// backend: commands are matched by regex + keyword rules. Sensitive
// operations (sell / purchase / pay / refund / delete) are detected FIRST
// and are never executed from a command.
import type { ExpenseCategory } from './types';

export type ParsedCommand =
  | { kind: 'create_vehicle'; year: number; make: string; model: string; price: number }
  | { kind: 'record_transport'; stockNumber: string; amount: number }
  | { kind: 'record_expense'; amount: number; category: ExpenseCategory; vehicleRef: string }
  | { kind: 'query_aged'; days: number }
  | { kind: 'query_losing' }
  | { kind: 'query_followups' }
  | { kind: 'sensitive'; action: string; detail: string }
  | { kind: 'unknown' };

export const EXAMPLE_COMMANDS = [
  'Add a 2022 Honda Accord for $16,500',
  'Record $350 transportation for stock number CDT-101',
  'Add $280 detailing expense to the Honda',
  'Show all vehicles held for more than 45 days',
  'Which vehicles are losing money?',
  'Show customers who need follow-up',
] as const;

/** Commands that are never executed from text, even after confirmation. */
export const SENSITIVE_ACTIONS = ['sell', 'sale', 'purchase', 'buy', 'pay', 'payment', 'refund', 'delete', 'remove'] as const;

const CATEGORY_WORDS: [RegExp, ExpenseCategory][] = [
  [/detail/i, 'Detailing'],
  [/mechanic|repair/i, 'Mechanical repairs'],
  [/body/i, 'Bodywork'],
  [/paint/i, 'Paint'],
  [/tire|tyre/i, 'Tires'],
  [/battery/i, 'Battery'],
  [/glass|windshield|windscreen/i, 'Glass'],
  [/inspect/i, 'Inspection'],
  [/part/i, 'Parts'],
  [/labo[u]?r/i, 'Labor'],
  [/transport/i, 'Transportation'],
  [/auction/i, 'Auction fees'],
  [/advertis|listing/i, 'Advertising'],
  [/rent/i, 'Rent'],
  [/utilit/i, 'Utilities'],
  [/insur/i, 'Insurance'],
  [/payroll|salary|wage/i, 'Payroll'],
];

export function parseCommand(raw: string): ParsedCommand {
  const cmd = raw.trim();
  const lower = cmd.toLowerCase();

  // Sensitive operations first: they are never executed from a command.
  const sensitive = lower.match(/\b(sell|sale|purchase|buy|pay|payment|refund|delete|remove)\b/);
  if (sensitive) {
    return { kind: 'sensitive', action: sensitive[1], detail: cmd };
  }

  // "Add a 2022 Honda Accord for $16,500"
  const add = cmd.match(
    /add\s+(?:a\s+|an\s+|the\s+)?(\d{4})\s+([A-Za-z]+)\s+([A-Za-z0-9][A-Za-z0-9 ]*?)\s+for\s+\$?([\d,]+(?:\.\d{2})?)/i,
  );
  if (add) {
    return {
      kind: 'create_vehicle',
      year: Number(add[1]),
      make: add[2].replace(/^\w/, (c) => c.toUpperCase()),
      model: add[3].trim(),
      price: Number(add[4].replace(/,/g, '')),
    };
  }

  // "Record $350 transportation for stock number CDT-101"
  const transport = cmd.match(
    /record\s+\$?([\d,]+(?:\.\d{2})?)\s+transport(?:ation)?\s+(?:for|to)\s+(?:stock\s+number\s+)?([A-Za-z0-9-]+)/i,
  );
  if (transport) {
    return {
      kind: 'record_transport',
      amount: Number(transport[1].replace(/,/g, '')),
      stockNumber: transport[2].toUpperCase(),
    };
  }

  // "Add $280 detailing expense to the Honda"
  const expense = cmd.match(
    /(?:add|record)\s+\$?([\d,]+(?:\.\d{2})?)\s+([A-Za-z ]+?)\s+expense\s+(?:to|for)\s+(?:the\s+)?([A-Za-z0-9][A-Za-z0-9 ]*)/i,
  );
  if (expense) {
    const category = CATEGORY_WORDS.find(([re]) => re.test(expense[2]))?.[1] ?? 'Other overhead';
    return {
      kind: 'record_expense',
      amount: Number(expense[1].replace(/,/g, '')),
      category,
      vehicleRef: expense[3].trim(),
    };
  }

  const aged =
    lower.match(/(?:held|older|over|more than)\D*?(\d+)\s*days/) ?? lower.match(/aged\D*?(\d+)/);
  if (/held|aged|older than/.test(lower) && aged) return { kind: 'query_aged', days: Number(aged[1]) };
  if (/losing money|underwater|loss-making|negative profit/.test(lower)) return { kind: 'query_losing' };
  if (/follow[- ]?up/.test(lower)) return { kind: 'query_followups' };
  return { kind: 'unknown' };
}

/** Short human summary of a parsed command, for the operation record. */
export function describeParsed(parsed: ParsedCommand): string {
  switch (parsed.kind) {
    case 'create_vehicle':
      return `Create vehicle: ${parsed.year} ${parsed.make} ${parsed.model} for $${parsed.price.toLocaleString('en-US')}.`;
    case 'record_transport':
      return `Record $${parsed.amount.toLocaleString('en-US')} transportation for stock number ${parsed.stockNumber}.`;
    case 'record_expense':
      return `Record $${parsed.amount.toLocaleString('en-US')} ${parsed.category} expense for "${parsed.vehicleRef}".`;
    case 'query_aged':
      return `List vehicles held for more than ${parsed.days} days.`;
    case 'query_losing':
      return 'List vehicles whose asking price is below their all-in cost.';
    case 'query_followups':
      return 'List customers with overdue follow-ups.';
    case 'sensitive':
      return `Sensitive operation "${parsed.action}" — never executed from a text command.`;
    case 'unknown':
      return 'Could not understand the command.';
  }
}
