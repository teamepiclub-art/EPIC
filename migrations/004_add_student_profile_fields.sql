-- Migration 004: Add Student Profile and Department Preferences Fields to Registrations
-- Preserves existing records and adds the comprehensive academic & recruitment attributes

ALTER TABLE registrations ADD COLUMN field_of_study TEXT;
ALTER TABLE registrations ADD COLUMN academic_year TEXT;
ALTER TABLE registrations ADD COLUMN matricule TEXT;
ALTER TABLE registrations ADD COLUMN primary_department TEXT;
ALTER TABLE registrations ADD COLUMN secondary_department TEXT;
ALTER TABLE registrations ADD COLUMN motivation TEXT;
