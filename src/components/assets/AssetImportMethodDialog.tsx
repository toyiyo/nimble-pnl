import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TableProperties, Sparkles, FileSpreadsheet, ArrowRight } from 'lucide-react';

export type ImportMethod = 'mapping' | 'ai';

interface AssetImportMethodDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectMethod: (method: ImportMethod) => void;
  fileName: string;
}

export function AssetImportMethodDialog({
  open,
  onClose,
  onSelectMethod,
  fileName,
}: AssetImportMethodDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        {/* Header with gradient accent */}
        <div className="relative px-6 pt-6 pb-4">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800" />
          <DialogHeader className="relative">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-white dark:bg-slate-800 shadow-sm border">
                <FileSpreadsheet className="h-5 w-5 text-slate-600 dark:text-slate-300" />
              </div>
              <DialogTitle className="text-lg font-semibold">Choose Import Method</DialogTitle>
            </div>
            <DialogDescription className="text-sm">
              Importing <span className="font-medium text-foreground bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{fileName}</span>
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Options */}
        <div className="p-6 pt-2 space-y-3">
          {/* Smart Column Mapping Option */}
          <button
            onClick={() => onSelectMethod('mapping')}
            className="group w-full text-left rounded-xl border-2 border-transparent bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 p-4 transition-all duration-200 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 p-2.5 rounded-lg bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 group-hover:scale-105 transition-transform">
                <TableProperties className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100">Smart Column Mapping</h3>
                  <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">
                    Recommended
                  </span>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  Auto-detect columns and review mappings before import. Best for standard CSV/Excel formats.
                </p>
              </div>
              <ArrowRight className="h-5 w-5 text-slate-400 group-hover:text-blue-500 group-hover:translate-x-1 transition-all flex-shrink-0 mt-1" />
            </div>
          </button>

          {/* AI Extraction Option */}
          <button
            onClick={() => onSelectMethod('ai')}
            className="group w-full text-left rounded-xl border-2 border-transparent bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-950/30 dark:to-purple-950/30 p-4 transition-all duration-200 hover:border-violet-300 dark:hover:border-violet-700 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2"
          >
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 p-2.5 rounded-lg bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400 group-hover:scale-105 transition-transform">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100">AI Extraction</h3>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  Let AI parse complex file structures and extract assets automatically. Best for unusual formats or XML.
                </p>
              </div>
              <ArrowRight className="h-5 w-5 text-slate-400 group-hover:text-violet-500 group-hover:translate-x-1 transition-all flex-shrink-0 mt-1" />
            </div>
          </button>
        </div>

        {/* Footer hint */}
        <div className="px-6 pb-5 pt-1">
          <p className="text-xs text-center text-muted-foreground">
            Not sure? Try <span className="font-medium">Smart Column Mapping</span> first — you can always re-upload with AI.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
