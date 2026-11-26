export type Item = { x: number; s: string };
export type Row = { y: number; items: Item[] };
export type Page = { rows: Row[] };
export type TxnKind = "purchase" | "payment" | "credit" | "instalment_principal" | "instalment_interest" | "fee" | "interest";
export type ParsedTxn = {
  txnDate: string; // YYYY-MM-DD
  postedDate: string | null;
  description: string; // raw description, wrapped continuation lines joined with a space
  merchant: string; // description without trailing FX '(USD 2.12)' and without leading '(05/24) ' instalment prefix
  amountMinor: number; // integer centavos. positive = charge/spend, negative = payment or credit
  fxAmountMinor: number | null;
  fxCurrency: string | null;
  kind: TxnKind;
  instalmentRef: string | null; // e.g. '1000001'
  instalmentSeq: string | null; // e.g. '02/12'
  subAccount: string | null; // null for unionbank
};
export type ParsedStatement = {
  bank: "unionbank" | "bpi";
  accountRef: string; // stable id of the card, e.g. last4 for unionbank
  accountLast4: string;
  accountName: string;
  statementDate: string; periodStart: string; periodEnd: string; dueDate: string | null; // YYYY-MM-DD
  totals: { previousBalanceMinor: number; purchasesMinor: number; paymentsMinor: number; totalDueMinor: number; minDueMinor: number };
  txns: ParsedTxn[];
  warnings: string[];
};
