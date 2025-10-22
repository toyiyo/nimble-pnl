import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, FileText, FileSpreadsheet, Loader2 } from "lucide-react";
import { useState } from "react";

interface ExportDropdownProps {
  onExportCSV: () => Promise<void> | void;
  onExportPDF: () => Promise<void> | void;
  isExporting?: boolean;
}

export const ExportDropdown = ({ onExportCSV, onExportPDF, isExporting = false }: ExportDropdownProps) => {
  const [isWorking, setIsWorking] = useState(false);
  const [exportType, setExportType] = useState<'csv' | 'pdf' | null>(null);

  const handleExportCSV = async () => {
    setExportType('csv');
    setIsWorking(true);
    try {
      await onExportCSV();
    } finally {
      setIsWorking(false);
      setExportType(null);
    }
  };

  const handleExportPDF = async () => {
    setExportType('pdf');
    setIsWorking(true);
    try {
      await onExportPDF();
    } finally {
      setIsWorking(false);
      setExportType(null);
    }
  };

  const isDisabled = isExporting || isWorking;
  const showSpinner = isExporting || isWorking;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={isDisabled}>
          {showSpinner ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Exporting...
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              Export
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-background">
        <DropdownMenuItem onClick={handleExportCSV} className="cursor-pointer" disabled={isDisabled}>
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Export as CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportPDF} className="cursor-pointer" disabled={isDisabled}>
          <FileText className="mr-2 h-4 w-4" />
          Export as PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
