// esbuild bundles these files as text (see build.js).
declare module '*.py' {
  const text: string;
  export default text;
}

declare module '*.md' {
  const text: string;
  export default text;
}
