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
  onExportCSV: () => void;
  onExportPDF: () => void;
  isExporting?: boolean;
}

export const ExportDropdown = ({ onExportCSV, onExportPDF, isExporting = false }: ExportDropdownProps) => {
  const [exportType, setExportType] = useState<'csv' | 'pdf' | null>(null);

  const handleExportCSV = () => {
    setExportType('csv');
    onExportCSV();
    setTimeout(() => setExportType(null), 1000);
  };

  const handleExportPDF = () => {
    setExportType('pdf');
    onExportPDF();
    setTimeout(() => setExportType(null), 1000);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={isExporting}>
          {isExporting ? (
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
        <DropdownMenuItem onClick={handleExportCSV} className="cursor-pointer">
          {exportType === 'csv' ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileSpreadsheet className="mr-2 h-4 w-4" />
          )}
          Export as CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportPDF} className="cursor-pointer">
          {exportType === 'pdf' ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileText className="mr-2 h-4 w-4" />
          )}
          Export as PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
