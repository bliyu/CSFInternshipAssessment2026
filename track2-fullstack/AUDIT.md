# FarmTracker Code Review Audit

Before making code changes, I reviewed the backend routes, database schema, frontend animal detail page, README, and existing tests.

The highest priority issue is data consistency around paddock animal counts. When an animal is created or deleted, `animal_count` is updated manually. However, when an animal is moved from one paddock to another, the new paddock count is increased but the previous paddock count is not decreased. This can make paddock capacity information inaccurate over time. I would fix this first because it affects core livestock records and could mislead users about paddock occupancy.

Another concern is validation. The API checks for a few required fields, but it does not consistently validate numeric values, foreign keys, or invalid input. For example, paddock capacity can be non-positive, and animal creation can reference a paddock without clearly checking whether it exists first. The new weight tracking feature should avoid repeating this pattern by validating positive weights and returning clear 404 or 422 responses.

The app also keeps most animal-related logic directly inside one route file. This is acceptable for a small assessment app, but it makes the file grow as new features are added. I would either extract database helpers or document a concrete service/repository structure as the architectural improvement.

I would leave large framework changes for later. The current Node, Express, and SQLite stack is simple and appropriate for the scope. Instead of replacing the stack, I would focus on scoped fixes, tests, and documentation so the reviewer can easily run and verify the work.
