BEGIN;
CREATE TABLE IF NOT EXISTS public.carnes_cms_catalog (id integer PRIMARY KEY CHECK (id = 1), content jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS public.carnes_cms_images (name text PRIMARY KEY, content bytea NOT NULL);
COMMIT;
