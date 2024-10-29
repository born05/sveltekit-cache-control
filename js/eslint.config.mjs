import js from '@eslint/js';
import ts from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default [js.configs.recommended, ...ts.configs.recommended, prettier];
