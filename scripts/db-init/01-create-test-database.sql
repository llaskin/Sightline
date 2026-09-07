-- Creates the two isolated databases alongside the development one.
--
-- `excuse_detector_test` is truncated by the integration suite between tests,
-- so it must never be the development database. `excuse_detector_e2e` is reset
-- and reseeded by the browser suite. Keeping all three separate is what lets
-- either suite run without destroying local work.
CREATE DATABASE excuse_detector_test OWNER excuse;
CREATE DATABASE excuse_detector_e2e OWNER excuse;
