-- ============================================================================
-- Rollback for 009_injury_report.sql
-- ============================================================================
-- APPLY MANUALLY. Drops the injury / starter tables only.
-- Does not touch PropValidation, Game, or grades.
-- ============================================================================

SET lock_timeout = '5s';

DROP TABLE IF EXISTS "NhlStartingGoalie";
DROP TABLE IF EXISTS "InjuryReport";
