// Test shim: `server-only` throws if imported outside a server bundle. Under vitest
// (plain node) we alias it to this no-op so server modules with pure logic can be
// unit-tested. Does not weaken the real guard in the app build.
export {};
