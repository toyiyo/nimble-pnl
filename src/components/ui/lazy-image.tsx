import React, { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

interface LazyImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** The image source URL */
  src: string;
  /** Alt text for accessibility */
  alt: string;
  /** Optional width for Supabase image transform */
  transformWidth?: number;
  /** Optional quality for Supabase image transform (1-100) */
  transformQuality?: number;
  /** Placeholder to show while loading */
  placeholder?: 'skeleton' | 'blur' | 'none';
  /** Root margin for intersection observer (default: 200px) */
  rootMargin?: string;
  /** Additional className for the image */
  className?: string;
  /** Additional className for the container */
  containerClassName?: string;
  /** Callback when image loads successfully */
  onLoad?: () => void;
  /** Callback when image fails to load */
  onError?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
}

/**
 * Transforms a Supabase storage URL to use the image transform API.
 *
 * Supabase Image Transforms require the /render/image/ endpoint:
 * FROM: https://xxx.supabase.co/storage/v1/object/public/bucket/path.jpg
 * TO:   https://xxx.supabase.co/storage/v1/render/image/public/bucket/path.jpg?width=128&quality=75
 */
function transformSupabaseUrl(
  url: string,
  width?: number,
  quality?: number
): string {
  if (!url || !width) return url;

  // Check if this is a Supabase storage URL
  if (!url.includes('supabase.co/storage')) {
    return url;
  }

  // Convert object URL to render/image URL for transforms
  // /storage/v1/object/public/ -> /storage/v1/render/image/public/
  let transformedUrl = url.replace(
    '/storage/v1/object/public/',
    '/storage/v1/render/image/public/'
  );

  // Build transform parameters
  const params = new URLSearchParams();
  if (width) params.set('width', String(width));
  if (quality) params.set('quality', String(quality));

  // Append to URL
  const separator = transformedUrl.includes('?') ? '&' : '?';
  return `${transformedUrl}${separator}${params.toString()}`;
}

/**
 * LazyImage - A performant image component with lazy loading
 *
 * Features:
 * - Intersection Observer for viewport-based loading
 * - Skeleton placeholder during load
 * - Fade-in transition on load
 * - Supabase image transform support
 * - Error handling with fallback
 */
export const LazyImage: React.FC<LazyImageProps> = ({
  src,
  alt,
  transformWidth,
  transformQuality = 75,
  placeholder = 'skeleton',
  rootMargin = '200px',
  className,
  containerClassName,
  onLoad,
  onError,
  ...imgProps
}) => {
  // Check if IntersectionObserver is available (SSR-safe)
  // If not available, default to showing image immediately
  const hasIntersectionObserver =
    typeof window !== 'undefined' && 'IntersectionObserver' in window;

  // In virtualized contexts, components are only mounted when visible,
  // so we can start with isInView true. For non-virtualized contexts,
  // the IntersectionObserver will handle visibility detection.
  const [isInView, setIsInView] = useState(!hasIntersectionObserver);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Transform URL for optimized delivery
  const transformedSrc = transformSupabaseUrl(src, transformWidth, transformQuality);

  // Reset load/error state when src changes
  useEffect(() => {
    setIsLoaded(false);
    setHasError(false);
    // Re-evaluate intersection for new image if observer is available
    if (hasIntersectionObserver && containerRef.current) {
      setIsInView(false);
    }
  }, [src, transformedSrc, hasIntersectionObserver]);

  // Set up Intersection Observer for lazy loading
  useEffect(() => {
    if (!hasIntersectionObserver) {
      setIsInView(true);
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsInView(true);
            observer.unobserve(entry.target);
          }
        });
      },
      {
        rootMargin,
        threshold: 0,
      }
    );

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [rootMargin, hasIntersectionObserver, transformedSrc]);

  const handleLoad = () => {
    setIsLoaded(true);
    onLoad?.();
  };

  const handleError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    setHasError(true);
    onError?.(e);
  };

  // Don't render anything if there's no src
  if (!src) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={cn('relative overflow-hidden', containerClassName)}
    >
      {/* Placeholder */}
      {placeholder === 'skeleton' && !isLoaded && !hasError && (
        <Skeleton className="absolute inset-0 w-full h-full" />
      )}

      {/* Image - only render src when in view */}
      {isInView && !hasError && (
        <img
          {...imgProps}
          src={transformedSrc}
          alt={alt}
          onLoad={handleLoad}
          onError={handleError}
          className={cn(
            'transition-opacity duration-300',
            isLoaded ? 'opacity-100' : 'opacity-0',
            className
          )}
        />
      )}

      {/* Error state - hide the broken image */}
      {hasError && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-muted"
          aria-label={`Failed to load image: ${alt}`}
        >
          <span className="text-muted-foreground text-xs">No image</span>
        </div>
      )}
    </div>
  );
};

export default LazyImage;
