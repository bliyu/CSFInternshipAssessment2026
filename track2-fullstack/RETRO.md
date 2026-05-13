# Retrospective

I kept the implementation intentionally small and reviewable. The main trade-off was favoring targeted changes over a broader backend refactor. That let me fix the paddock count bug, add weight tracking end to end, and extend the tests without introducing unnecessary surface area. The downside is that some business logic still lives directly in the Express route layer, which is workable for the current app size but not ideal long term.

With more time, I would focus next on extracting animal-related business logic into a service layer and wrapping multi-step updates in explicit SQLite transactions. That would reduce the chance of future consistency bugs, especially anywhere the code updates more than one table in response to a single request.

I deliberately left the overall stack alone. Node, Express, SQLite, and the simple HTML frontend are appropriate for the scope of the assessment, and changing the stack would create noise without improving the reviewer experience. I also left visual polish modest on the frontend weight history feature so the changes stayed consistent with the existing Health Events section and easy to verify.
