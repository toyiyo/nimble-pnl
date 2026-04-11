import { useState } from 'react';
import { PlayCircle, X, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HelpVideoCardProps {
  videoKey: string;
  videoUrl: string;
  title: string;
  description: string;
  duration?: string;
}

const STORAGE_PREFIX = 'help_video_seen_';

export function HelpVideoCard({ videoKey, videoUrl, title, description, duration }: HelpVideoCardProps) {
  const storageKey = `${STORAGE_PREFIX}${videoKey}`;
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem(storageKey) !== 'seen'
  );

  if (!videoUrl) {
    return null;
  }

  const handleDismiss = () => {
    localStorage.setItem(storageKey, 'seen');
    setExpanded(false);
  };

  const handleExpand = () => {
    setExpanded(true);
  };

  if (!expanded) {
    return (
      <button
        onClick={handleExpand}
        aria-label={title}
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-full',
          'border border-border/40 bg-muted/30 hover:bg-muted/50',
          'text-[13px] text-foreground transition-colors w-full'
        )}
      >
        <PlayCircle className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
        <span className="font-medium flex-1 text-left truncate">{title}</span>
        {duration && (
          <span className="text-[12px] text-muted-foreground shrink-0">{duration}</span>
        )}
        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <p className="text-[14px] font-medium text-foreground">{title}</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">{description}</p>
          </div>
          <button
            onClick={handleDismiss}
            aria-label="Dismiss help video"
            className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <video
          data-testid="help-video-player"
          src={videoUrl}
          controls
          playsInline
          preload="metadata"
          className="w-full rounded-lg bg-black"
        />
      </div>
    </div>
  );
}
