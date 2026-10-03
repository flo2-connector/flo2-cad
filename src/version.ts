// The versions every check report names (req:each-piece-is-kept-as-the-designs-files,
// owner round 2, Q8). A test holds these equal to package.json and to the
// installed manifold-3d, which is pinned at 3.5.4 and used unmodified.

export const ENGINE_NAME = 'flo2-cad';
export const ENGINE_VERSION = '0.1.0';
export const KERNEL_NAME = 'manifold-3d';
export const KERNEL_VERSION = '3.5.4';

/** True until Phase 2 replaces the stub engine with the real kernel, checker and renderer. */
export const STUB_ENGINE = true;
