-- Creates the isolated integration-test database alongside the development one.
-- Integration tests refuse to run against any database whose name does not end
-- in `_test`, so these two can never be confused.
CREATE DATABASE excuse_detector_test OWNER excuse;
