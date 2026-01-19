import { useState, useCallback, useRef, useEffect } from 'react';
import { ZoomIn, ZoomOut, RotateCw, Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface ImageViewerProps {
  src: string;
  alt: string;
  className?: string;
  showControls?: boolean;
  controlsPosition?: 'top' | 'bottom' | 'overlay';
  minZoom?: number;
  maxZoom?: number;
  initialZoom?: number;
  onError?: () => void;
  isLoading?: boolean;
}

export function ImageViewer({
  src,
  alt,
  className,
  showControls = true,
  controlsPosition = 'overlay',
  minZoom = 0.5,
  maxZoom = 4,
  initialZoom = 1,
  onError,
  isLoading: externalLoading,
}: ImageViewerProps) {
  const [scale, setScale] = useState(initialZoom);
  const [rotation, setRotation] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isImageLoading, setIsImageLoading] = useState(true);
  const [showControlsVisible, setShowControlsVisible] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const lastTouchDistanceRef = useRef<number | null>(null);
  const lastTapRef = useRef<number>(0);

  const isLoading = externalLoading ?? isImageLoading;
  const isZoomed = scale > 1;

  // Reset state when src changes
  useEffect(() => {
    setScale(initialZoom);
    setRotation(0);
    setPosition({ x: 0, y: 0 });
    setIsImageLoading(true);
  }, [src, initialZoom]);

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setScale((prev) => Math.min(prev + 0.5, maxZoom));
  }, [maxZoom]);

  const handleZoomOut = useCallback(() => {
    setScale((prev) => {
      const newScale = Math.max(prev - 0.5, minZoom);
      if (newScale <= 1) setPosition({ x: 0, y: 0 });
      return newScale;
    });
  }, [minZoom]);

  const handleRotate = useCallback(() => {
    setRotation((prev) => (prev + 90) % 360);
  }, []);

  const handleReset = useCallback(() => {
    setScale(1);
    setRotation(0);
    setPosition({ x: 0, y: 0 });
  }, []);

  // Wheel zoom
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      setScale((prev) => {
        const newScale = Math.max(minZoom, Math.min(maxZoom, prev + delta));
        if (newScale <= 1) setPosition({ x: 0, y: 0 });
        return newScale;
      });
    },
    [minZoom, maxZoom]
  );

  // Double-tap/click to zoom
  const handleDoubleClick = useCallback(() => {
    if (scale > 1) {
      handleReset();
    } else {
      setScale(2);
    }
  }, [scale, handleReset]);

  // Mouse drag for panning
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!isZoomed) return;
      e.preventDefault();
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    },
    [isZoomed, position]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging || !isZoomed) return;
      setPosition({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      });
    },
    [isDragging, isZoomed]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Touch handlers for pinch-to-zoom
  const getTouchDistance = (touches: React.TouchList) => {
    if (touches.length < 2) return 0;
    const touch1 = touches.item(0);
    const touch2 = touches.item(1);
    if (!touch1 || !touch2) return 0;
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.hypot(dx, dy);
  };

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        // Pinch start
        lastTouchDistanceRef.current = getTouchDistance(e.touches);
      } else if (e.touches.length === 1 && isZoomed) {
        // Pan start
        const touch = e.touches.item(0);
        if (touch) {
          setIsDragging(true);
          dragStartRef.current = {
            x: touch.clientX - position.x,
            y: touch.clientY - position.y,
          };
        }
      }

      // Double-tap detection
      const now = Date.now();
      if (now - lastTapRef.current < 300 && e.touches.length === 1) {
        handleDoubleClick();
      }
      lastTapRef.current = now;
    },
    [isZoomed, position, handleDoubleClick]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2 && lastTouchDistanceRef.current !== null) {
        // Pinch zoom
        e.preventDefault();
        const newDistance = getTouchDistance(e.touches);
        const scaleDelta = (newDistance - lastTouchDistanceRef.current) * 0.01;
        setScale((prev) => Math.max(minZoom, Math.min(maxZoom, prev + scaleDelta)));
        lastTouchDistanceRef.current = newDistance;
      } else if (e.touches.length === 1 && isDragging && isZoomed) {
        // Pan
        const touch = e.touches.item(0);
        if (touch) {
          setPosition({
            x: touch.clientX - dragStartRef.current.x,
            y: touch.clientY - dragStartRef.current.y,
          });
        }
      }
    },
    [isDragging, isZoomed, minZoom, maxZoom]
  );

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    lastTouchDistanceRef.current = null;
  }, []);

  const handleImageLoad = useCallback(() => {
    setIsImageLoading(false);
  }, []);

  const handleImageError = useCallback(() => {
    setIsImageLoading(false);
    onError?.();
  }, [onError]);

  const controlsClass = cn(
    'flex items-center gap-1.5 p-1.5 rounded-lg bg-background/80 backdrop-blur-sm border border-border shadow-lg transition-opacity duration-200',
    {
      'absolute bottom-3 left-1/2 -translate-x-1/2 z-10': controlsPosition === 'overlay' || controlsPosition === 'bottom',
      'absolute top-3 left-1/2 -translate-x-1/2 z-10': controlsPosition === 'top',
      'opacity-0 group-hover:opacity-100': controlsPosition === 'overlay' && !showControlsVisible,
    }
  );

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative overflow-hidden bg-muted/30 rounded-lg group select-none',
        isZoomed ? 'cursor-grab' : 'cursor-zoom-in',
        isDragging && 'cursor-grabbing',
        className
      )}
      onMouseEnter={() => setShowControlsVisible(true)}
      onMouseLeave={() => {
        setShowControlsVisible(false);
        handleMouseUp();
      }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onDoubleClick={handleDoubleClick}
    >
      {/* Loading state */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-20">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary/30 border-t-primary" />
        </div>
      )}

      {/* Image */}
      <img
        ref={imageRef}
        src={src}
        alt={alt}
        className={cn(
          'w-full h-full object-contain transition-transform duration-150 ease-out',
          isLoading && 'opacity-0'
        )}
        style={{
          transform: `translate(${position.x}px, ${position.y}px) rotate(${rotation}deg) scale(${scale})`,
          transformOrigin: 'center center',
        }}
        onLoad={handleImageLoad}
        onError={handleImageError}
        draggable={false}
      />

      {/* Controls */}
      {showControls && !isLoading && (
        <div className={controlsClass}>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-foreground/70 hover:text-foreground hover:bg-accent"
            onClick={(e) => {
              e.stopPropagation();
              handleZoomOut();
            }}
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>

          <span className="text-xs font-medium text-foreground/60 min-w-[3rem] text-center tabular-nums">
            {Math.round(scale * 100)}%
          </span>

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-foreground/70 hover:text-foreground hover:bg-accent"
            onClick={(e) => {
              e.stopPropagation();
              handleZoomIn();
            }}
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>

          <div className="w-px h-5 bg-border mx-0.5" />

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-foreground/70 hover:text-foreground hover:bg-accent"
            onClick={(e) => {
              e.stopPropagation();
              handleRotate();
            }}
            aria-label="Rotate"
          >
            <RotateCw className="h-4 w-4" />
          </Button>

          {scale !== 1 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-foreground/70 hover:text-foreground hover:bg-accent"
              onClick={(e) => {
                e.stopPropagation();
                handleReset();
              }}
              aria-label="Reset zoom"
            >
              <Minimize2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      {/* Zoom indicator pill (shows during zoom changes) */}
      {isZoomed && (
        <div className="absolute top-3 right-3 px-2 py-1 rounded-full bg-background/80 backdrop-blur-sm border border-border text-xs font-medium text-foreground/70 tabular-nums">
          {Math.round(scale * 100)}%
        </div>
      )}
    </div>
  );
}
