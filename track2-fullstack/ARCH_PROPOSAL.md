# Architectural Improvement Proposal

## Problem

The most significant architectural issue in FarmTracker is that animal-related route handlers mix HTTP concerns, validation, business rules, and direct SQL in a single file: `app/backend/routes/animals.js`.

That structure is still manageable for the starter health-event feature, but it becomes harder to reason about as soon as we add more stateful behavior such as:

- paddock count updates when animals move
- validation and persistence for health events
- validation and persistence for weight history

This increases the risk of duplicated logic and inconsistent rules. The paddock count bug is a good example: the application already had manual count updates in multiple places, but the move case was missed.

## Proposed Direction

Refactor the backend into three layers while keeping Express and SQLite:

1. `routes/`
   - Parse requests and send responses
   - No direct SQL except perhaps trivial lookups during migration

2. `services/`
   - Hold business logic such as moving an animal between paddocks
   - Enforce cross-entity rules and return domain errors

3. `repositories/`
   - Encapsulate SQL access for animals, paddocks, health events, and weights
   - Provide small methods such as `getAnimalById`, `updateAnimal`, `insertWeight`, `incrementPaddockCount`

## Concrete First Step

The first extraction I would make is an `animalService` with methods such as:

- `updateAnimal(id, updates)`
- `createHealthEvent(animalId, payload)`
- `createWeightRecord(animalId, payload)`
- `listWeightHistory(animalId)`

The `updateAnimal` service should own paddock reassignment behavior so there is only one place that adjusts `animal_count`.

## Transaction Boundary

The recent bug-fix work already wraps animal create/update writes in small transactions at the route layer. As part of the service extraction, I would keep that protection but move transaction ownership out of Express handlers.

The paddock move logic should execute inside a database transaction:

- read current animal
- decrease old paddock count when needed
- increase new paddock count when needed
- update the animal row

That protects the app from partial updates if any step fails and keeps the consistency rule close to the business operation instead of scattering it across handlers.

## Why I Chose a Proposal Instead of a Full Refactor

I kept the implementation scoped to the assessment's requested bug fixes and feature work. A full route-to-service refactor would touch too many files at once and would make review harder. This proposal is concrete enough for the next iteration while preserving a clean, assessable change set.
