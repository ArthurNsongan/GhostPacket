// jsqr ships only a UMD build. Loaded as a module it sets `self.jsQR`; re-export it.
// (Bundlers such as Vite, webpack or Next.js do this interop automatically.)
import "../../node_modules/jsqr/dist/jsQR.js";

export default globalThis.jsQR;
