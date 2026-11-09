/**
 * Which Chrome extension the SAGE app connects to.
 *
 * The extension's manifest carries a fixed public "key", so an unpacked install always gets this
 * id. It can be overridden with VITE_SAGE_EXTENSION_ID (e.g. for a Web Store build), and the
 * extension also announces its id on SAGE pages, which is remembered in localStorage.
 */
export const DEFAULT_SAGE_EXTENSION_ID = 'dglbflkoabfpgeiplgpoclicefjoaahl';
export const REQUIRED_PROTOCOL = 3;
const STORAGE_KEY = 'sage.extensionId';

export function configuredExtensionId(): string {
  const fromEnv = (import.meta as any).env?.VITE_SAGE_EXTENSION_ID as string | undefined;
  if (fromEnv && /^[a-p]{32}$/.test(fromEnv)) return fromEnv;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && /^[a-p]{32}$/.test(stored)) return stored;
  } catch {}
  return DEFAULT_SAGE_EXTENSION_ID;
}

export function rememberExtensionId(id: string): void {
  try {
    if (id === DEFAULT_SAGE_EXTENSION_ID) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, id);
  } catch {}
}
