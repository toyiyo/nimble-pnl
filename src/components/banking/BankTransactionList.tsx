import { BankTransaction } from "@/hooks/useBankTransactions";
import { BankTransactionRow } from "./BankTransactionRow";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface BankTransactionListProps {
  transactions: BankTransaction[];
  status: 'for_review' | 'categorized' | 'excluded';
}

export function BankTransactionList({ transactions, status }: BankTransactionListProps) {
  return (
    <div className="overflow-x-auto -mx-6 px-6">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[100px]">Date</TableHead>
            <TableHead className="min-w-[200px]">Description</TableHead>
            <TableHead className="min-w-[150px] hidden md:table-cell">Payee</TableHead>
            <TableHead className="text-right min-w-[100px]">Amount</TableHead>
            {status === 'for_review' && <TableHead className="min-w-[150px] hidden lg:table-cell">Suggested</TableHead>}
            {status === 'categorized' && <TableHead className="min-w-[150px] hidden lg:table-cell">Category</TableHead>}
            {status === 'excluded' && <TableHead className="min-w-[150px] hidden lg:table-cell">Reason</TableHead>}
            <TableHead className="text-right min-w-[120px]">Actions</TableHead>
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
