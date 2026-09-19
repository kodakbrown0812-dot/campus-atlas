# Public source boundary

This branch synchronizes application source with the already deployed Atlas Sites version 40. It is not a new deployment and does not integrate a model interpreter.

The production application code matches source commit `2b51640db88bfd9336bc5c2659c8f133d28e89d8`. Three conversation-derived artifacts in `fixtures/camping/runs/immutable-state-v2/` are intentionally not added to this public export. Original artifacts and their full integrity test remain preserved in the private local evidence workspace.

The public test suite explicitly skips that artifact-integrity test unless `ATLAS_PRIVATE_CAMPING_FIXTURE_URL` is set to a local directory file URL ending in `/`. When supplied, all original byte-count and SHA-256 assertions execute unchanged. This is a disclosed private-evidence dependency, not a passing test or a claim of equivalent public proof coverage. Other synthetic engine regressions remain enabled.

The GitHub source mirror, deployed Sites release and private development experiments are separate states. Later source-coverage work and model-assisted shadow experiments are not part of this synchronization. Failed experimental interpretations remain quarantined; this export makes no maximum-room reliability or semantic completeness claim.

No raw API responses, newly accumulated audit reports or private room transcripts are added by this synchronization. Existing public repository history is preserved, not rewritten. Synchronization does not itself deploy the site or change production data.
