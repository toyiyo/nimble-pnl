import { Badge } from "@/components/ui/badge";
import { FileText, Hash, ArrowRightLeft } from "lucide-react";
import type { LinkedInfoResult } from "@/lib/bankTransactionLinkedInfo";

const ICONS: Record<LinkedInfoResult['type'], React.ReactNode> = {
  invoice: <FileText className="h-3 w-3 mr-1" />,
  check: <Hash className="h-3 w-3 mr-1" />,
  ach: <ArrowRightLeft className="h-3 w-3 mr-1" />,
  other: <FileText className="h-3 w-3 mr-1" />,
};

interface LinkedInfoSubtitleProps {
  info: LinkedInfoResult;
}

export function LinkedInfoSubtitle({ info }: LinkedInfoSubtitleProps) {
  return (
    <div className="flex items-center gap-1.5 mt-1 text-[13px] text-muted-foreground">
      <Badge
        variant="outline"
        className="text-[11px] px-1.5 py-0 h-5 font-medium bg-muted/50 border-border/60 shrink-0"
      >
        {ICONS[info.type]}
        {info.badge}
      </Badge>
      <span className="truncate">
        {[info.vendor, info.detail].filter(Boolean).join(' — ')}
      </span>
    </div>
  );
}
