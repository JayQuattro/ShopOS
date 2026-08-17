-- Printable document paper size: an organization default (Work preferences)
-- with per-print overrides on the /print pages. Letter is the North American
-- default; A4 and legal cover the international and contract cases.

CREATE TYPE "paper_size" AS ENUM ('letter', 'a4', 'legal');

ALTER TABLE "organizations"
  ADD COLUMN "default_paper_size" "paper_size" NOT NULL DEFAULT 'letter';
