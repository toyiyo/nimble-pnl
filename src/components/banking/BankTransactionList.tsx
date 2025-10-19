import { BankTransaction } from "@/hooks/useBankTransactions";
import { BankTransactionRow } from "./BankTransactionRow";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface BankTransactionListProps {
  transactions: BankTransaction[];
  status: 'for_review' | 'categorized' | 'excluded';
}

export function BankTransactionList({ transactions, status }: BankTransactionListProps) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Payee</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            {status === 'for_review' && <TableHead>Suggested</TableHead>}
            {status === 'categorized' && <TableHead>Category</TableHead>}
            {status === 'excluded' && <TableHead>Reason</TableHead>}
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map((transaction) => (
            <BankTransactionRow
              key={transaction.id}
              transaction={transaction}
              status={status}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
