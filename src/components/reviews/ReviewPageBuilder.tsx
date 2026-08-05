import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

import { QrCode, Upload } from 'lucide-react';

import { useReviewPages, type ReviewPageWithStats } from '@/hooks/useReviewPages';
import { isValidSlug, slugifyPageName, withCollisionSuffix } from '@/lib/reviews/reviewSlug';

import { ReviewQrDialog } from './ReviewQrDialog';

interface ReviewPageBuilderProps {
  page: ReviewPageWithStats | null;
  restaurantId: string;
  onCreated: (id: string) => void;
}

const THRESHOLDS = [1, 2, 3, 4, 5] as const;

export function ReviewPageBuilder({ page, restaurantId, onCreated }: ReviewPageBuilderProps) {
  const { createPage, updatePage, uploadLogo, isSaving } = useReviewPages(restaurantId);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [headline, setHeadline] = useState('How was everything?');
  const [subheadline, setSubheadline] = useState('');
  const [threshold, setThreshold] = useState(4);
  const [destinationUrl, setDestinationUrl] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [qrOpen, setQrOpen] = useState(false);

  useEffect(() => {
    setName(page?.name ?? '');
    setSlug(page?.slug ?? '');
    setSlugTouched(Boolean(page));
    setHeadline(page?.headline ?? 'How was everything?');
    setSubheadline(page?.subheadline ?? '');
    setThreshold(page?.promoter_threshold ?? 4);
    setDestinationUrl(page?.destination_url ?? '');
    setIsActive(page?.is_active ?? true);
  }, [page]);

  const publicUrl = `${window.location.origin}/r/${slug}`;
  const slugError = slug.length > 0 && !isValidSlug(slug);
  const urlError = destinationUrl.length > 0 && !destinationUrl.startsWith('https://');
  const canSave = name.trim().length > 0 && isValidSlug(slug) && !urlError;

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugTouched) setSlug(slugifyPageName(value));
  };

  const handleSave = async () => {
    const payload = {
      name: name.trim(),
      slug,
      headline: headline.trim() || 'How was everything?',
      subheadline: subheadline.trim() || null,
      promoter_threshold: threshold,
      destination_url: destinationUrl.trim() || null,
    };

    if (page) {
      await updatePage({ id: page.id, ...payload, is_active: isActive });
    } else {
      const created = await createPage(payload);
      onCreated(created.id);
    }
  };

  const handleLogo = async (file: File | undefined) => {
    if (!file || !page) return;
    await uploadLogo(page.id, file);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40 bg-muted/50 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-foreground">The page</h3>
          {page && (
            <div className="flex items-center gap-2">
              <Label htmlFor="page-active" className="text-[12px] text-muted-foreground">
                Live
              </Label>
              <Switch
                id="page-active"
                checked={isActive}
                onCheckedChange={setIsActive}
                className="data-[state=checked]:bg-foreground"
              />
            </div>
          )}
        </div>

        <div className="p-4 space-y-4">
          <div>
            <Label
              htmlFor="page-name"
              className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
            >
              Name
            </Label>
            <Input
              id="page-name"
              value={name}
              onChange={(event) => handleNameChange(event.target.value)}
              placeholder="Table tents"
              className="mt-1.5 h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            />
            <p className="mt-1 text-[12px] text-muted-foreground">
              Only you see this — it&apos;s how you tell your pages apart.
            </p>
          </div>

          <div>
            <Label
              htmlFor="page-slug"
              className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
            >
              Public link
            </Label>
            <Input
              id="page-slug"
              value={slug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(event.target.value.toLowerCase());
              }}
              aria-invalid={slugError}
              aria-describedby="page-slug-help"
              className="mt-1.5 h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            />
            <p id="page-slug-help" className="mt-1 text-[12px] text-muted-foreground break-all">
              {slugError
                ? '3–48 characters: lowercase letters, numbers, and hyphens, not starting or ending with one.'
                : publicUrl}
            </p>
            {slugError && (
              <Button
                type="button"
                variant="ghost"
                className="mt-1 h-8 px-0 text-[12px] text-muted-foreground hover:text-foreground"
                onClick={() => setSlug(withCollisionSuffix(slugifyPageName(name)))}
              >
                Suggest one
              </Button>
            )}
          </div>

          <div>
            <Label
              htmlFor="page-headline"
              className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
            >
              Headline
            </Label>
            <Input
              id="page-headline"
              value={headline}
              onChange={(event) => setHeadline(event.target.value)}
              className="mt-1.5 h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            />
          </div>

          <div>
            <Label
              htmlFor="page-subheadline"
              className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
            >
              Subheadline
            </Label>
            <Input
              id="page-subheadline"
              value={subheadline}
              onChange={(event) => setSubheadline(event.target.value)}
              placeholder="Optional"
              className="mt-1.5 h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
          <h3 className="text-[13px] font-semibold text-foreground">Where ratings go</h3>
        </div>

        <div className="p-4 space-y-4">
          <fieldset>
            <legend className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Send to Google at
            </legend>
            {/* Selection-follows-focus is correct here: this is an ordinary
                setting, arrowing through it commits nothing but a local state
                change, and the manager still has to press Save. Radix's
                RadioGroup is exactly right — unlike the guest star control,
                where the same behaviour would file a rating. */}
            <RadioGroup
              value={String(threshold)}
              onValueChange={(value) => setThreshold(Number(value))}
              className="mt-2 flex items-center gap-2"
            >
              {THRESHOLDS.map((star) => (
                <div key={star} className="flex items-center">
                  <RadioGroupItem
                    id={`threshold-${star}`}
                    value={String(star)}
                    className="peer sr-only"
                  />
                  <Label
                    htmlFor={`threshold-${star}`}
                    aria-label={`${star} stars and above`}
                    className="cursor-pointer rounded-lg px-2 py-1 text-[24px] leading-none text-muted-foreground/40 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-data-[state=checked]:text-foreground"
                  >
                    {star <= threshold ? '★' : '☆'}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            <p className="mt-2 text-[12px] text-muted-foreground">
              {threshold} stars and up see the Google link. Everything below goes to your private
              feedback form.
            </p>
          </fieldset>

          <div>
            <Label
              htmlFor="page-destination"
              className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
            >
              Google review link
            </Label>
            <Input
              id="page-destination"
              value={destinationUrl}
              onChange={(event) => setDestinationUrl(event.target.value)}
              placeholder="https://g.page/r/…/review"
              aria-invalid={urlError}
              aria-describedby="page-destination-help"
              className="mt-1.5 h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            />
            <p id="page-destination-help" className="mt-1 text-[12px] text-muted-foreground">
              {urlError
                ? 'Must start with https://'
                : 'Leave this empty and happy guests just see a thank-you.'}
            </p>
          </div>
        </div>
      </div>

      {page && (
        <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
          <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
            <h3 className="text-[13px] font-semibold text-foreground">Logo and QR</h3>
          </div>

          <div className="p-4 flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => handleLogo(event.target.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              className="h-9 px-4 rounded-lg text-[13px] font-medium"
            >
              <Upload className="mr-2 h-4 w-4" />
              {page.logo_path ? 'Replace logo' : 'Upload logo'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setQrOpen(true)}
              className="h-9 px-4 rounded-lg text-[13px] font-medium"
            >
              <QrCode className="mr-2 h-4 w-4" />
              QR code
            </Button>
            <p className="w-full text-[12px] text-muted-foreground">
              PNG, JPEG, or WebP, up to 2 MB.
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          disabled={!canSave || isSaving}
          onClick={handleSave}
          className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
        >
          {isSaving ? 'Saving…' : page ? 'Save' : 'Create page'}
        </Button>
      </div>

      {page && (
        <ReviewQrDialog
          open={qrOpen}
          onOpenChange={setQrOpen}
          slug={page.slug}
          publicUrl={`${window.location.origin}/r/${page.slug}`}
        />
      )}
    </div>
  );
}
