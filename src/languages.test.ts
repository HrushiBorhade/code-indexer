import { describe, it, expect } from 'vitest';
import {
  LANGUAGE_MAP,
  AST_LANGUAGES,
  TEXT_LANGUAGES,
  getLanguage,
  getSupportedExtensions,
} from './languages.ts';

describe('languages', () => {
  describe('getLanguage', () => {
    it('returns correct entry for AST languages', () => {
      expect(getLanguage('src/index.ts')?.name).toBe('typescript');
      expect(getLanguage('app.py')?.name).toBe('python');
      expect(getLanguage('main.rs')?.name).toBe('rust');
    });

    it('returns correct entry for text languages', () => {
      expect(getLanguage('README.md')?.name).toBe('markdown');
      expect(getLanguage('data.json')?.name).toBe('json');
      expect(getLanguage('config.yaml')?.name).toBe('yaml');
    });

    it('returns undefined for unknown extensions', () => {
      expect(getLanguage('image.png')).toBeUndefined();
      expect(getLanguage('binary.exe')).toBeUndefined();
    });

    it('handles nested paths', () => {
      expect(getLanguage('src/utils/helper.ts')?.name).toBe('typescript');
    });
  });

  describe('AST_LANGUAGES', () => {
    it('contains expected languages', () => {
      expect(AST_LANGUAGES.has('typescript')).toBe(true);
      expect(AST_LANGUAGES.has('tsx')).toBe(true);
      expect(AST_LANGUAGES.has('python')).toBe(true);
      expect(AST_LANGUAGES.has('rust')).toBe(true);
    });

    it('does not contain text languages', () => {
      expect(AST_LANGUAGES.has('markdown')).toBe(false);
      expect(AST_LANGUAGES.has('json')).toBe(false);
    });
  });

  describe('TEXT_LANGUAGES', () => {
    it('contains expected languages', () => {
      expect(TEXT_LANGUAGES.has('markdown')).toBe(true);
      expect(TEXT_LANGUAGES.has('json')).toBe(true);
      expect(TEXT_LANGUAGES.has('yaml')).toBe(true);
    });
  });

  describe('no overlap between AST and TEXT', () => {
    it('sets have zero intersection', () => {
      for (const lang of AST_LANGUAGES) {
        expect(TEXT_LANGUAGES.has(lang)).toBe(false);
      }
    });
  });

  describe('getSupportedExtensions', () => {
    it('includes key extensions', () => {
      const exts = getSupportedExtensions();
      expect(exts).toContain('.ts');
      expect(exts).toContain('.py');
      expect(exts).toContain('.md');
      expect(exts).toContain('.json');
    });
  });

  describe('LANGUAGE_MAP', () => {
    it('maps all extensions from each language entry', () => {
      expect(LANGUAGE_MAP.get('.tsx')?.name).toBe('tsx');
      expect(LANGUAGE_MAP.get('.jsx')?.name).toBe('javascript');
      expect(LANGUAGE_MAP.get('.yml')?.name).toBe('yaml');
      expect(LANGUAGE_MAP.get('.gql')?.name).toBe('graphql');
    });
  });
});
