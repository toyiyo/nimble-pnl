-- ============================================================================
-- Review funnel, slice 1: pages, responses, and guest contact PII.
--
-- Each REVOKE sits immediately after its own CREATE TABLE. Production's
-- pg_default_acl grants `anon` AND `authenticated` full CRUD on newly created
-- public tables, so any gap between creation and revoke is a window in which
-- the table is writable by both. The revoke names the roles directly rather
-- than PUBLIC, because that default ACL is a direct grant to each role.
--
-- Both roles must be revoked before the GRANTs below, or the grants read as
-- documentation rather than policy: a GRANT of a narrower set does not take
-- away what the default ACL already handed out, so `authenticated` would
-- silently keep INSERT/DELETE on every table here.
-- ============================================================================

CREATE TABLE public.review_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'),
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  logo_path TEXT NULL,
  headline TEXT NOT NULL DEFAULT 'How was everything?',
  subheadline TEXT NULL,
  promoter_threshold SMALLINT NOT NULL DEFAULT 4
    CHECK (promoter_threshold BETWEEN 1 AND 5),
  destination_url TEXT NULL CHECK (destination_url ~ '^https://'),
  created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

REVOKE ALL ON public.review_pages FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_pages TO authenticated;
ALTER TABLE public.review_pages ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN public.review_pages.slug IS
'Globally unique, not per-restaurant: /r/:slug is a global namespace. The builder appends a random suffix on collision rather than reporting the collision, so slugs cannot be probed across tenants.';

-- ============================================================================

CREATE TABLE public.review_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  review_page_id UUID NOT NULL REFERENCES public.review_pages(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  routed_to TEXT NOT NULL CHECK (routed_to IN ('destination', 'feedback')),
  comment TEXT NULL,
  contact_consent BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'in_progress', 'resolved')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  commented_at TIMESTAMPTZ NULL,
  ip_hash TEXT NULL
);

REVOKE ALL ON public.review_responses FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.review_responses TO authenticated;
ALTER TABLE public.review_responses ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN public.review_responses.restaurant_id IS
'Denormalized from review_pages so RLS filters without a join. Kept honest by review_responses_set_restaurant_id(), which overwrites it on every INSERT and UPDATE — even the service role cannot set it to a value that disagrees with the page.';

-- There is deliberately no INSERT grant or policy for `authenticated`: the
-- only writer is the edge function's service role. A restaurant cannot
-- manufacture its own five-star ratings.

-- ============================================================================

CREATE TABLE public.review_response_contacts (
  review_response_id UUID PRIMARY KEY
    REFERENCES public.review_responses(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  contact_name TEXT NULL,
  contact_email TEXT NULL
);

REVOKE ALL ON public.review_response_contacts FROM anon, authenticated;
GRANT SELECT ON public.review_response_contacts TO authenticated;
ALTER TABLE public.review_response_contacts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.review_response_contacts IS
'Guest name and email, split out of review_responses because Postgres RLS is row-level: there is no way to let a view:reviews holder read a feedback row while withholding the guest email from it. SELECT here requires manage:reviews.';

-- ============================================================================
-- restaurant_id triggers. Two functions, not one: they read different parent
-- tables.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.review_responses_set_restaurant_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  SELECT rp.restaurant_id INTO NEW.restaurant_id
  FROM public.review_pages rp
  WHERE rp.id = NEW.review_page_id;

  IF NEW.restaurant_id IS NULL THEN
    RAISE EXCEPTION 'review_page_id % does not exist', NEW.review_page_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER review_responses_set_restaurant_id
  BEFORE INSERT OR UPDATE ON public.review_responses
  FOR EACH ROW EXECUTE FUNCTION public.review_responses_set_restaurant_id();

CREATE OR REPLACE FUNCTION public.review_response_contacts_set_restaurant_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  SELECT rr.restaurant_id INTO NEW.restaurant_id
  FROM public.review_responses rr
  WHERE rr.id = NEW.review_response_id;

  IF NEW.restaurant_id IS NULL THEN
    RAISE EXCEPTION 'review_response_id % does not exist', NEW.review_response_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER review_response_contacts_set_restaurant_id
  BEFORE INSERT OR UPDATE ON public.review_response_contacts
  FOR EACH ROW EXECUTE FUNCTION public.review_response_contacts_set_restaurant_id();

CREATE TRIGGER update_review_pages_updated_at
  BEFORE UPDATE ON public.review_pages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX idx_review_responses_restaurant_submitted
  ON public.review_responses (restaurant_id, submitted_at DESC);

CREATE INDEX idx_review_responses_ratelimit
  ON public.review_responses (review_page_id, ip_hash, submitted_at DESC);

CREATE INDEX idx_review_responses_unread
  ON public.review_responses (restaurant_id, status)
  WHERE status = 'new';

CREATE INDEX idx_review_pages_restaurant
  ON public.review_pages (restaurant_id);

-- ============================================================================
-- RLS policies
-- ============================================================================

CREATE POLICY review_pages_select ON public.review_pages
  FOR SELECT TO authenticated
  USING (user_has_capability(restaurant_id, 'view:reviews'));

CREATE POLICY review_pages_insert ON public.review_pages
  FOR INSERT TO authenticated
  WITH CHECK (user_has_capability(restaurant_id, 'manage:reviews'));

CREATE POLICY review_pages_update ON public.review_pages
  FOR UPDATE TO authenticated
  USING (user_has_capability(restaurant_id, 'manage:reviews'))
  WITH CHECK (user_has_capability(restaurant_id, 'manage:reviews'));

CREATE POLICY review_pages_delete ON public.review_pages
  FOR DELETE TO authenticated
  USING (user_has_capability(restaurant_id, 'manage:reviews'));

CREATE POLICY review_responses_select ON public.review_responses
  FOR SELECT TO authenticated
  USING (user_has_capability(restaurant_id, 'view:reviews'));

CREATE POLICY review_responses_update ON public.review_responses
  FOR UPDATE TO authenticated
  USING (user_has_capability(restaurant_id, 'manage:reviews'))
  WITH CHECK (user_has_capability(restaurant_id, 'manage:reviews'));

CREATE POLICY review_response_contacts_select ON public.review_response_contacts
  FOR SELECT TO authenticated
  USING (user_has_capability(restaurant_id, 'manage:reviews'));

-- ============================================================================
-- Logo bucket
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'review-page-logos',
  'review-page-logos',
  true,
  2097152,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Public read: a guest's browser loads this with no credentials.
CREATE POLICY review_logos_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'review-page-logos');

-- Writes: manage:reviews for the restaurant that owns the first path segment.
-- storage.extension is checked in addition to the bucket's allowed_mime_types:
-- a mislabelled SVG served to every guest who scans that QR code is a blast
-- radius outside the uploader's own tenant.
CREATE POLICY review_logos_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'review-page-logos'
    AND storage.extension(name) IN ('png', 'jpg', 'jpeg', 'webp')
    AND user_has_capability((storage.foldername(name))[1]::uuid, 'manage:reviews')
  );

CREATE POLICY review_logos_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'review-page-logos'
    AND user_has_capability((storage.foldername(name))[1]::uuid, 'manage:reviews')
  );

CREATE POLICY review_logos_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'review-page-logos'
    AND user_has_capability((storage.foldername(name))[1]::uuid, 'manage:reviews')
  );

-- Objects are keyed {restaurant_id}/{review_page_id}/{uuid}.{ext}, which is
-- what makes (storage.foldername(name))[1] the restaurant id.
