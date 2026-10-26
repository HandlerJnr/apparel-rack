# Preview policy

Production serving is paused in Vercel. Automatic custom production-domain assignment is disabled. The production branch remains main, whose automatic deployments are disabled in vercel.json. The preview branch is used for review builds.

Vercel initially classified the first Git-connected build as Production; this was not the intended release. Production serving was paused before review. Keep it paused until an explicit launch decision.
