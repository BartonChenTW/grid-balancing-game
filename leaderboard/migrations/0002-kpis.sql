-- 0.9.0: store the three KPI values with each score. Run once on the live database:
--   npx wrangler@4 d1 execute follow-the-load --remote --file=migrations/0002-kpis.sql
ALTER TABLE scores ADD COLUMN reliability REAL;
ALTER TABLE scores ADD COLUMN cost REAL;
ALTER TABLE scores ADD COLUMN carbon REAL;
