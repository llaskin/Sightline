/**
 * The single source of the origin the test suites claim to send from.
 *
 * It must equal the origin the application's same-origin guard accepts. Four
 * places used to hardcode "http://localhost:3100" instead. That passed on the
 * machine it was written on and returned 403 on every other one: CI sets
 * APP_ORIGIN to http://127.0.0.1:3110, so the first CI run rejected every
 * mutating request in the integration suite.
 *
 * There is deliberately no fallback here. A default is what let the tests and
 * the configuration drift apart in the first place, and it would hide the same
 * failure again rather than surface it.
 */
export const TEST_ORIGIN = (() => {
  const configured = process.env.APP_ORIGIN;
  if (!configured) {
    throw new Error(
      'APP_ORIGIN must be set before the test helpers load. It is the origin ' +
        'the same-origin guard accepts, so the tests must send that same value.',
    );
  }
  return configured;
})();
