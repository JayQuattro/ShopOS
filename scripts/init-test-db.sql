-- Creates the dedicated test database on first container init so integration
-- tests have a clean target without manual setup.
CREATE DATABASE shopos_test;
GRANT ALL PRIVILEGES ON DATABASE shopos_test TO shopos;
