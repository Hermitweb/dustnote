/**
 * Preferences Slice — 主题/字体/密度/语言/自动锁定
 */

import type { StateCreator } from 'zustand';
import type { StoreState } from '../store';
import type { Preferences, ThemeId, Mode } from '../store-types';
import { loadPrefs, savePrefs } from '../store-types';
import { applyTheme, applyTypography } from '../theme';
import i18n from '../i18n';
import { toast } from '../toast';
import { api } from '../store-helpers';

export interface PrefsSlice {
  preferences: Preferences;
  setPreferences: (p: Partial<Preferences>) => void;
  setTheme: (theme: ThemeId) => void;
  setMode: (mode: Mode) => void;
  setLanguage: (lang: 'zh-CN' | 'en') => void;
}

export const createPrefsSlice: StateCreator<StoreState, [], [], PrefsSlice> = (set, get) => ({
  preferences: loadPrefs(),

  setPreferences(p: Partial<Preferences>): void {
    const next = { ...get().preferences, ...p };
    savePrefs(next);
    set({ preferences: next } as Partial<StoreState>);
    if (p.theme) applyTheme(p.theme, next.mode);
    if (p.mode) applyTheme(next.theme, p.mode);
    if (p.font || p.density) {
      applyTypography(p.font ?? next.font, p.density ?? next.density);
    }
    if (p.language) {
      localStorage.setItem('dustnote_language', p.language);
      void i18n.changeLanguage(p.language);
    }

    const { mode, repository } = get();
    if (mode === 'standalone' && repository) {
      void repository.setPreferences(p).catch(() => undefined);
    } else {
      void api()
        .patch('/preferences', p)
        .catch(() => {
          toast.error(i18n.t('settings.save_fail'));
        });
    }
  },

  setTheme(theme: ThemeId): void {
    get().setPreferences({ theme });
  },
  setMode(mode: Mode): void {
    get().setPreferences({ mode });
  },
  setLanguage(language: 'zh-CN' | 'en'): void {
    get().setPreferences({ language });
  },
});
