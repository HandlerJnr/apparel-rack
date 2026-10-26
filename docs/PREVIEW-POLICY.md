# Preview policy

The project is enabled so preview builds can run. No production domains are connected. Automatic custom production-domain assignment is disabled. The production branch is main, and automatic deployments from main are disabled in vercel.json. The preview branch is used for review builds.

Vercel classified the first Git-connected build as Production. It was paused, its automatic production domain was removed, and the project was re-enabled solely to allow Preview builds. That initial build remains in deployment history. Do not promote or assign production domains without an explicit launch decision.
