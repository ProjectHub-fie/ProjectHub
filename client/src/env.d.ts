/// <reference types="vite/client" />
// Minimal ambient declarations to silence TypeScript in the workspace
// - provide a very small `JSX.IntrinsicElements` so TSX works if React types
//   are not available to the editor/compiler in this environment
// - declare the `lucide-react` module with loose types so imports don't error

declare global {
  namespace JSX {
    interface IntrinsicElements {
      // allow any intrinsic element (div, span, section, etc.)
      [elemName: string]: any;
    }
  }
}

declare module "lucide-react" {
  import * as React from "react";
  // export any icon component (loose typing)
  export const Download: React.FC<any>;
  export const Icon: React.FC<any>;
  const _default: { [key: string]: React.FC<any> };
  export default _default;
}

// Shims for packages where @types are missing in this environment.
// These are permissive (any) to avoid blocking the editor / compiler.
declare module "estree" { const _default: any; export = _default }
declare module "mime" { const _default: any; export = _default }
declare module "pg" { const _default: any; export = _default }
declare module "uuid" { const _default: any; export = _default }
declare module "ws" { const _default: any; export = _default }

declare module "react" { const React: any; export default React; export const createElement: any }
declare module "react-dom" { const ReactDOM: any; export default ReactDOM }
declare module "node" { const _default: any; export = _default }

export {};
