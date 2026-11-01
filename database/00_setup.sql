-- Builds the whole database in one go: tables, demo data, then checks.
-- Run from a terminal:  psql -U postgres -d gedt_dev -f database/00_setup.sql
\set ON_ERROR_STOP on
\ir schema.sql
\ir seed.sql
\ir tests.sql
