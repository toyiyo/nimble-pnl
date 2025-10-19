import { BankTransaction } from "@/hooks/useBankTransactions";
import { BankTransactionRow } from "./BankTransactionRow";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartAccount } from "@/hooks/useChartOfAccounts";

interface BankTransactionListProps {
  transactions: BankTransaction[];
  status: 'for_review' | 'categorized' | 'excluded';
  accounts: ChartAccount[];
}

export function BankTransactionList({ transactions, status, accounts }: BankTransactionListProps) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap">Date</TableHead>
            <TableHead className="min-w-[200px]">Description</TableHead>
            <TableHead className="whitespace-nowrap hidden md:table-cell">Payee</TableHead>
            <TableHead className="text-right whitespace-nowrap">Amount</TableHead>
            {status === 'for_review' && <TableHead className="min-w-[150px] hidden lg:table-cell">Suggested</TableHead>}
            {status === 'categorized' && <TableHead className="min-w-[150px] hidden lg:table-cell">Category</TableHead>}
            {status === 'excluded' && <TableHead className="whitespace-nowrap hidden lg:table-cell">Reason</TableHead>}
            <TableHead className="text-right whitespace-nowrap">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map((transaction) => (
            <BankTransactionRow
              key={transaction.id}
              transaction={transaction}
              status={status}
              accounts={accounts}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
