import { defineConfig } from 'vite'
import { cdnConfig } from '../../scripts/vite-lib.mjs'

export default defineConfig(cdnConfig({ name: 'woocommerce' }))
