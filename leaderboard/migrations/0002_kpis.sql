-- 0.9.0: the three KPI values of each score. NULL for scores from older versions.
ALTER TABLE scores ADD COLUMN reliability REAL; -- % of the day in the normal band
ALTER TABLE scores ADD COLUMN cost REAL;        -- average generation cost, NT$/kWh
ALTER TABLE scores ADD COLUMN carbon REAL;      -- average CO₂ intensity, g/kWh
