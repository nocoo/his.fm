import { useEffect } from 'react';
import { useBeforeUnload } from 'react-router';

let environmentNavigationConfirmed = false;
const dirtyForms = new Set<symbol>();

export function hasUnsavedChanges() {
  return dirtyForms.size > 0;
}

export function confirmEnvironmentNavigation() {
  environmentNavigationConfirmed = true;
}

export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const form = Symbol();
    dirtyForms.add(form);
    return () => {
      dirtyForms.delete(form);
    };
  }, [dirty]);
  useBeforeUnload((event) => {
    if (dirty && !environmentNavigationConfirmed) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}
