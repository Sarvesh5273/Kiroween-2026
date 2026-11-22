import fc from "fast-check";

// Seeded global config so every property-test failure reproduces.
fc.configureGlobal({ seed: 0x5eed2027, numRuns: 100 });
