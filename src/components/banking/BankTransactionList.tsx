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
    <div className="w-full overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
      <Table className="min-w-[700px] max-w-full">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[110px] whitespace-nowrap">Date</TableHead>
            <TableHead className="min-w-[180px]">Description</TableHead>
            <TableHead className="w-[120px] whitespace-nowrap hidden md:table-cell">Payee</TableHead>
            <TableHead className="w-[140px] whitespace-nowrap hidden lg:table-cell">Bank Account</TableHead>
            <TableHead className="w-[100px] text-right whitespace-nowrap">Amount</TableHead>
            {status === 'for_review' && <TableHead className="w-[140px] hidden lg:table-cell">Category</TableHead>}
            {status === 'categorized' && <TableHead className="w-[140px] hidden lg:table-cell">Category</TableHead>}
            {status === 'excluded' && <TableHead className="w-[120px] hidden lg:table-cell">Reason</TableHead>}
            <TableHead className="w-[60px] text-right whitespace-nowrap">Actions</TableHead>
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
