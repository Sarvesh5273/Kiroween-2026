---
inclusion: always
---

# No Spec Gaming

## Never hardcode to pass fixtures
- Never hardcode part IDs, bounding boxes, or step orders to make a fixture pass.
- Solver output must come from the geometry and the algorithm.

## Never hide failures
- Never swallow exceptions silently, for example `catch {}`. Handle the error or rethrow it.
- Never write trivial assertions such as `expect(true).toBe(true)`.

## Randomness and property tests
- Never use unseeded `Math.random()` inside solver logic or `fast-check` tests.
- Use a seeded PRNG so failures reproduce.
- Every solver or property-based test must verify a true geometric or graph property, for example collision-free removal paths or a valid dependency order.
