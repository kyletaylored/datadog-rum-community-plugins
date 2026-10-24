import { defineConfig } from 'vite'
import { libConfig } from '../../scripts/vite-lib.mjs'

export default defineConfig(libConfig({ entry: 'src/index.ts', dts: true }))
