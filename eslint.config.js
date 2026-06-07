import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        AudioWorkletProcessor: 'readonly',
        currentFrame: 'readonly',
        currentTime: 'readonly',
        registerProcessor: 'readonly'
      }
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }]
    }
  },
  {
    files: ['public/**/*.js', 'sw.js'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        AudioWorkletProcessor: 'readonly',
        Headers: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
        caches: 'readonly',
        fetch: 'readonly',
        registerProcessor: 'readonly',
        sampleRate: 'readonly',
        self: 'readonly'
      }
    }
  }
);
